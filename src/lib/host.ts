import path from "node:path";
import { DRIVE_NAME } from "./constants.ts";
import { shellQuote } from "./utils.ts";
import type { CommandResult, HostSpawnOptions } from "./types.ts";

export const inFlatpak = await Bun.file("/.flatpak-info").exists();

export function hostSpawn(args: string[], options: HostSpawnOptions = {}) {
  // Route host work through flatpak-spawn when Pome is sandboxed.
  const cmd = inFlatpak ? ["flatpak-spawn", "--host", "--watch-bus", ...args] : args;
  const input = typeof options.input === "string" ? new TextEncoder().encode(options.input) : options.input;
  return Bun.spawn(cmd, {
    stdin: input ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, ...options.env },
  });
}

export async function hostRunWithOutput(args: string[], options: HostSpawnOptions = {}): Promise<CommandResult> {
  try {
    const child = hostSpawn(args, options);
    // Read both streams concurrently so either can exceed the pipe buffer.
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { ok: code === 0, code, stdout, stderr };
  } catch (error) {
    return { ok: false, code: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

export async function hostRun(args: string[], options: HostSpawnOptions = {}): Promise<boolean> {
  return (await hostRunWithOutput(args, options)).ok;
}

export async function getHostHomeDir(): Promise<string> {
  const result = await hostRunWithOutput(["sh", "-lc", 'printf %s "$HOME"']);
  const home = result.stdout.trim();
  if (!result.ok || !home) throw new Error("Could not resolve host home directory");
  return home;
}

export async function getHostUserConfigDir(): Promise<string> {
  const result = await hostRunWithOutput(["sh", "-lc", 'printf %s "${XDG_CONFIG_HOME:-$HOME/.config}"']);
  return result.stdout.trim() || path.join(await getHostHomeDir(), ".config");
}

export async function getHostMountDir(): Promise<string> {
  return path.join(await getHostHomeDir(), DRIVE_NAME);
}

export async function commandExists(command: string): Promise<boolean> {
  if (!inFlatpak) return Bun.which(command) !== null;

  const result = await hostRunWithOutput(["sh", "-lc", `command -v ${shellQuote(command)}`]);
  return result.ok && result.stdout.trim().length > 0;
}
