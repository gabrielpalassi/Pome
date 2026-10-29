import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { APP_ID } from "./constants.js";
import { commandExists, getHostHomeDir, hostRunWithOutput, inFlatpak } from "./host.js";
import { log } from "./utils.js";

const BUNDLED_RCLONE = "/app/lib/pome/rclone";
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
