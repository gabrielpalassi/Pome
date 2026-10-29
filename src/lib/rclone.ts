import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { APP_ID, BUNDLED_RCLONE, MOUNT_FLAGS, REMOTE, REMOTE_NAME } from "./constants.js";
import {
  commandExists,
  getHostHomeDir,
  getHostUserConfigDir,
  hostRunWithOutput,
  hostRun,
  hostSpawn,
  inFlatpak,
} from "./host.js";
import { log, shellQuote } from "./utils.js";
import type { ICloudSession, RcloneProcess } from "./types.js";

let executable: string | null = null;

export function getRcloneExecutable(): string {
  if (!executable) throw new Error("rclone has not been prepared");
  return executable;
}

export async function prepareRclone(): Promise<void> {
  if (!inFlatpak) {
    if (!(await commandExists("rclone"))) throw new Error("Native development requires rclone on PATH");
    executable = "rclone";
    return;
  }

  // /app is private to the sandbox. Stage a copy the host can execute without
  // installing anything globally or downloading code at runtime.
  const binary = await readFile(BUNDLED_RCLONE);
  const digest = createHash("sha256").update(binary).digest("hex");
  const target = path.join(await getHostHomeDir(), ".var", "app", APP_ID, "data", "libexec", `rclone-${digest}`);
  const check = await hostRunWithOutput([
    "sh",
    "-c",
    'test -x "$1" && test "$(sha256sum -- "$1" | cut -d " " -f 1)" = "$2"',
    "sh",
    target,
    digest,
  ]);

  if (!check.ok) {
    const install = await hostRunWithOutput(
      [
        "sh",
        "-c",
        `
set -eu
umask 077
target=$1
digest=$2
dir=$(dirname -- "$target")
mkdir -p -- "$dir"
tmp=$(mktemp "$dir/.rclone.XXXXXX")
trap 'rm -f -- "$tmp"' EXIT
cat > "$tmp"
test "$(sha256sum -- "$tmp" | cut -d ' ' -f 1)" = "$digest"
chmod 700 "$tmp"
mv -f -- "$tmp" "$target"
trap - EXIT
`,
        "sh",
        target,
        digest,
      ],
      { input: binary },
    );
    if (!install.ok) throw new Error(`Could not stage bundled rclone: ${install.stderr.trim()}`);
  }

  const version = await hostRunWithOutput([target, "version"]);
  if (!version.ok) throw new Error(`Could not execute bundled rclone: ${version.stderr.trim()}`);
  executable = target;
  log(`Using bundled ${version.stdout.split(/\r?\n/, 1)[0]}.`);
}

export async function hasRemote(): Promise<boolean> {
  const result = await hostRunWithOutput([getRcloneExecutable(), "listremotes"]);
  return result.ok && result.stdout.split(/\r?\n/).includes(`${REMOTE_NAME}:`);
}

export async function hasSavedSession(): Promise<boolean> {
  const result = await hostRunWithOutput([getRcloneExecutable(), "config", "show", REMOTE_NAME]);
  return result.ok && /^\s*cookies\s*=.+$/m.test(result.stdout) && /^\s*trust_token\s*=.+$/m.test(result.stdout);
}

async function getRcloneConfigPath(): Promise<string> {
  // Ask rclone first to respect host-side config overrides
  const paths = await hostRunWithOutput([getRcloneExecutable(), "config", "paths"]);
  const match = paths.stdout.match(/^Config file:\s*(.+)$/m);
  return paths.ok && match?.[1] ? match[1].trim() : path.join(await getHostUserConfigDir(), "rclone", "rclone.conf");
}

async function readHostFile(filePath: string): Promise<string | null> {
  const result = await hostRunWithOutput(["sh", "-lc", '[ ! -e "$1" ] || cat -- "$1"', "sh", filePath]);

  if (!result.ok) {
    log(`Could not read host file at ${filePath}: ${result.stderr.trim() || result.stdout.trim()}`);
    return null;
  }

  return result.stdout;
}

async function writeHostFile(filePath: string, content: string): Promise<boolean> {
  const result = await hostRunWithOutput(
    [
      "sh",
      "-lc",
      `
set -eu
config_path=$1
config_dir=$(dirname -- "$config_path")
config_base=$(basename -- "$config_path")
mkdir -p -- "$config_dir"
tmp=$(mktemp "$config_dir/.\${config_base}.XXXXXX")
trap 'rm -f "$tmp"' EXIT
cat > "$tmp"
chmod 600 "$tmp" 2>/dev/null || true
if [ -e "$config_path" ]; then
  chmod --reference="$config_path" "$tmp" 2>/dev/null || true
fi
mv -f -- "$tmp" "$config_path"
trap - EXIT
`,
      "sh",
      filePath,
    ],
    { input: content },
  );

  if (!result.ok) {
    log(`Could not write host file at ${filePath}: ${result.stderr.trim() || result.stdout.trim()}`);
  }

  return result.ok;
}

function updateRemoteSection(content: string, remoteName: string, updates: Record<string, string>): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();

  const sectionRe = /^\s*\[(.+)]\s*$/;
  let sectionStart: number | null = null;
  let sectionEnd = lines.length;

  // Locate the remote section and stop at the next section header.
  for (const [index, line] of lines.entries()) {
    const match = sectionRe.exec(line);
    if (!match) continue;

    if (match[1] === remoteName) {
      sectionStart = index;
      continue;
    }

    if (sectionStart !== null) {
      sectionEnd = index;
      break;
    }
  }

  // Create the section if rclone has not written it yet.
  if (sectionStart === null) {
    if (lines.length > 0 && lines.at(-1)?.trim()) lines.push("");
    lines.push(`[${remoteName}]`);
    sectionStart = lines.length - 1;
    sectionEnd = lines.length;
  }

  // Replace existing keys in place so surrounding comments and ordering survive.
  const seen = new Set<string>();
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    const key = lines[index].split("=", 1)[0].trim();
    if (key in updates) {
      lines[index] = `${key} = ${updates[key]}`;
      seen.add(key);
    }
  }

  // Add missing keys before any trailing blank separator for the section.
  let insertAt = sectionEnd;
  while (insertAt > sectionStart + 1 && !lines[insertAt - 1].trim()) {
    insertAt -= 1;
  }

  for (const [key, value] of Object.entries(updates)) {
    if (seen.has(key)) continue;

    lines.splice(insertAt, 0, `${key} = ${value}`);
    insertAt += 1;
  }

  return `${lines.join("\n")}\n`;
}

export async function createMinimalRemote(): Promise<boolean> {
  // Avoid rclone's iCloud auth flow, Pome only needs the section to exist
  const configPath = await getRcloneConfigPath();
  const escapedConfigPath = shellQuote(configPath);
  log(`Creating minimal ${REMOTE_NAME} rclone remote in ${configPath}.`);

  const result = await hostRunWithOutput([
    "sh",
    "-lc",
    [
      `mkdir -p "$(dirname ${escapedConfigPath})"`,
      `touch ${escapedConfigPath}`,
      `if ! grep -qx '\\[${REMOTE_NAME}\\]' ${escapedConfigPath}; then`,
      `printf '\\n[${REMOTE_NAME}]\\ntype = ${REMOTE_NAME}\\n' >> ${escapedConfigPath}`,
      "fi",
    ].join("\n"),
  ]);

  if (!result.ok) {
    log(`Could not create ${REMOTE_NAME}: ${result.stderr.trim() || result.stdout.trim()}`);
  }

  return hasRemote();
}

async function isMountPoint(mountDir: string): Promise<boolean> {
  if (await commandExists("mountpoint")) {
    // Fast path for healthy mounts
    if (await hostRun(["mountpoint", "-q", mountDir])) return true;
  }

  // Exact findmnt lookup still sees disconnected FUSE mounts
  const result = await hostRunWithOutput(["findmnt", "-rn", "--mountpoint", mountDir]);
  return result.ok && result.stdout.trim().length > 0;
}

async function unmountMountDir(mountDir: string): Promise<boolean> {
  // If the mount directory is not a mountpoint, we can safely proceed
  if (!(await isMountPoint(mountDir))) return true;

  log(`Unmounting existing mount at ${mountDir}.`);

  // Lazy unmounts detach dead FUSE endpoints that block mkdir/stat
  for (const args of [
    ["fusermount3", "-u", "-z", mountDir],
    ["fusermount", "-u", "-z", mountDir],
    ["umount", "-l", mountDir],
  ]) {
    const result = await hostRunWithOutput(args);
    if (result.ok) return true;

    const message = result.stderr.trim() || result.stdout.trim();
    if (message) log(`${args[0]} could not unmount ${mountDir}: ${message}`);
  }

  log(`Could not unmount existing mount at ${mountDir}.`);
  return false;
}

export async function createRcloneProcess(mountDir: string): Promise<RcloneProcess | null> {
  // Unmount any existing mount at the target directory before starting a new mount
  if (!(await unmountMountDir(mountDir))) return null;

  const mountDirReady = await hostRun(["mkdir", "-p", mountDir]);
  if (!mountDirReady) {
    log(`Could not create mount directory at ${mountDir}.`);
    return null;
  }

  const args = [getRcloneExecutable(), "mount", REMOTE, mountDir, ...MOUNT_FLAGS];
  const rcloneProcess = hostSpawn(args) as RcloneProcess;
  rcloneProcess.output = { stdout: "", stderr: "" };

  // Keep logs visible while retaining enough output to classify auth failures
  rcloneProcess.stdout?.on("data", (chunk) => {
    const text = chunk.toString();
    rcloneProcess.output.stdout += text;
    process.stdout.write(text);
  });
  rcloneProcess.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    rcloneProcess.output.stderr += text;
    process.stderr.write(text);
  });

  return rcloneProcess;
}

export function needsSignIn(rcloneProcess: RcloneProcess): boolean {
  // iCloud session expiry surfaces as backend text, not a stable exit code
  const AUTH_FAILURE_PATTERNS = [
    /invalid global session/i,
    /invalid session token/i,
    /invalid trust token/i,
    /authentication failed/i,
    /missing icloud trust token/i,
  ];

  const output = `${rcloneProcess.output.stderr}\n${rcloneProcess.output.stdout}`;
  return AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(output));
}

export async function isMountedAndReadable(mountDir: string): Promise<boolean> {
  if (!(await isMountPoint(mountDir))) return false;

  // A mount can exist while FUSE reads still fail, so verify it with `ls`
  const result = await hostRunWithOutput(["sh", "-lc", `ls ${shellQuote(mountDir)} >/dev/null`]);
  return result.ok;
}

export async function updateSession({ cookies, token, appleId }: ICloudSession): Promise<boolean> {
  if (!cookies || !token) return false;

  // rclone config update continues into iCloud SRP auth and may fail with a 401 if the session is expired, so we write the config directly instead
  const configPath = await getRcloneConfigPath();
  const configContent = await readHostFile(configPath);
  if (configContent === null) return false;

  const updates: Record<string, string> = {
    type: REMOTE_NAME,
    cookies,
    trust_token: token,
  };
  if (appleId) updates.apple_id = appleId;

  const updatedConfig = updateRemoteSection(configContent, REMOTE_NAME, updates);
  if (!(await writeHostFile(configPath, updatedConfig))) return false;

  return hasSavedSession();
}
