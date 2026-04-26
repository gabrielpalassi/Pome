import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { DRIVE_DIR } from "./constants.js";
import { shellQuote } from "./utils.js";
import type { CommandResult, HostSpawnOptions } from "./types.js";

export const inFlatpak = fs.existsSync("/.flatpak-info");

export function hostSpawn(args: string[], options: HostSpawnOptions = {}) {
  const [command, commandArgs] = inFlatpak ? ["flatpak-spawn", ["--host", ...args]] : [args[0], args.slice(1)];
  return spawn(command, commandArgs, {
    stdio: options.stdio ?? "pipe",
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

export function hostRunWithOutput(args: string[], options: HostSpawnOptions = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const childProcess = hostSpawn(args, options);
    let stdout = "";
    let stderr = "";

    childProcess.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    childProcess.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    childProcess.on("error", (error) => {
      resolve({ ok: false, code: 127, stdout, stderr: error.message });
    });
    childProcess.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

export function hostRun(args: string[], options: HostSpawnOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const child = hostSpawn(args, options);
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function getHostHomeDir(): Promise<string> {
  const result = await hostRunWithOutput(["sh", "-lc", 'getent passwd "$USER" | cut -d: -f6']);
  const home = result.stdout.trim();
  return home || os.homedir();
}

export async function getHostUserConfigDir(): Promise<string> {
  const result = await hostRunWithOutput(["sh", "-lc", 'printf %s "${XDG_CONFIG_HOME:-$HOME/.config}"']);
  return result.stdout.trim() || path.join(await getHostHomeDir(), ".config");
}

export async function getHostMountDir(): Promise<string> {
  return path.join(await getHostHomeDir(), DRIVE_DIR);
}

export async function commandExists(command: string): Promise<boolean> {
  const result = await hostRunWithOutput(["sh", "-lc", `command -v ${shellQuote(command)}`]);
  return result.ok && result.stdout.trim().length > 0;
}
