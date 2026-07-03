import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { DRIVE_NAME } from "./constants.js";
import { shellQuote } from "./utils.js";
import type { CommandResult, HostSpawnOptions } from "./types.js";

export const inFlatpak = fs.existsSync("/.flatpak-info");

export function hostSpawn(args: string[], options: HostSpawnOptions = {}) {
  // Route host work through flatpak-spawn when Pome is sandboxed
  const [command, commandArgs] = inFlatpak
    ? ["flatpak-spawn", ["--host", "--watch-bus", ...args]]
    : [args[0], args.slice(1)];
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

    // Keep result construction in one place so errors and exits have the same shape
    const finish = (code: number | null, error?: string): void => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr: error ?? stderr,
      });
    };

    // Collect output as text because callers inspect messages and command results
    function appendStdout(chunk: Buffer): void {
      stdout += chunk.toString();
    }

    function appendStderr(chunk: Buffer): void {
      stderr += chunk.toString();
    }

    childProcess.stdout?.on("data", appendStdout);
    childProcess.stderr?.on("data", appendStderr);
    childProcess.on("error", (error) => finish(127, error.message));
    childProcess.on("close", (code) => finish(code));

    // Pass optional command input through stdin so sensitive values stay out of process listings
    childProcess.stdin?.end(options.input);
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
  const result = await hostRunWithOutput(["sh", "-lc", `command -v ${shellQuote(command)}`]);
  return result.ok && result.stdout.trim().length > 0;
}
