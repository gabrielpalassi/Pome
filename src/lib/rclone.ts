import path from "node:path";
import { MOUNT_FLAGS, REMOTE, REMOTE_NAME } from "./constants.js";
import { commandExists, getHostUserConfigDir, hostRunWithOutput, hostRun, hostSpawn } from "./host.js";
import { log, shellQuote } from "./utils.js";
import type { ICloudSession, MountProcess } from "./types.js";

export async function hasRemote(): Promise<boolean> {
  const result = await hostRunWithOutput(["rclone", "listremotes"]);
  return result.ok && result.stdout.split(/\r?\n/).includes(`${REMOTE_NAME}:`);
}

export async function hasSavedSession(): Promise<boolean> {
  const result = await hostRunWithOutput(["rclone", "config", "show", REMOTE_NAME]);
  return result.ok && /^\s*cookies\s*=.+$/m.test(result.stdout) && /^\s*trust_token\s*=.+$/m.test(result.stdout);
}

export async function createMinimalRemote(): Promise<boolean> {
  const paths = await hostRunWithOutput(["rclone", "config", "paths"]);
  const match = paths.stdout.match(/^Config file:\s*(.+)$/m);
  const configPath =
    paths.ok && match?.[1] ? match[1].trim() : path.join(await getHostUserConfigDir(), "rclone", "rclone.conf");
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

export async function createMountProcess(mountDir: string): Promise<MountProcess> {
  const mountDirReady = await hostRun(["mkdir", "-p", mountDir]);
  if (!mountDirReady) log(`Could not create mount directory at ${mountDir}.`);

  const args = ["rclone", "mount", REMOTE, mountDir, ...MOUNT_FLAGS];
  return hostSpawn(args, { stdio: "inherit" }) as MountProcess;
}

export async function isMounted(mountDir: string): Promise<boolean> {
  if (await commandExists("mountpoint")) {
    return hostRun(["mountpoint", "-q", mountDir]);
  }

  const result = await hostRunWithOutput(["findmnt", "-rn", "--target", mountDir]);
  return result.ok && result.stdout.trim().length > 0;
}

export async function updateSession({ cookies, token, appleId }: ICloudSession): Promise<boolean> {
  if (!cookies || !token) return false;

  const updateArgs = ["rclone", "config", "update", REMOTE_NAME, `cookies=${cookies}`, `trust_token=${token}`];
  if (appleId) updateArgs.push(`apple_id=${appleId}`);

  const update = await hostRunWithOutput(updateArgs);
  if (!update.ok) {
    log(`Failed to update rclone config: ${update.stderr.trim() || update.stdout.trim()}`);
  }

  return hasSavedSession();
}
