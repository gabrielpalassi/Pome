import { expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HostSpawnOptions } from "../src/lib/types.ts";

const originalHost = { ...(await import("../src/lib/host.ts")) };
const originalConstants = { ...(await import("../src/lib/constants.ts")) };

// Exercise the real staging shell commands in an isolated host home. The fixture
// is executable without rclone or iCloud credentials on the test machine.
test("bundled helper is staged, reused, repaired, upgraded, and its final output is captured", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "pome rclone "));
  const bundledFile = path.join(home, "bundled-rclone");
  let bundled = '#!/bin/sh\nprintf "rclone test v1\\n"\n';
  let failInstall = false;
  await Bun.write(bundledFile, bundled);
  mock.module(new URL("../src/lib/constants.ts", import.meta.url).href, () => ({
    ...originalConstants,
    BUNDLED_RCLONE: bundledFile,
  }));
  mock.module(new URL("../src/lib/host.ts", import.meta.url).href, () => ({
    ...originalHost,
    inFlatpak: true,
    commandExists: async () => false,
    getHostHomeDir: async () => home,
    getHostUserConfigDir: async () => path.join(home, ".config"),
    hostRun: async (args: string[]) => Bun.spawnSync(args).exitCode === 0,
    hostSpawn: (args: string[]) => Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" }),
    hostRunWithOutput: async (args: string[], options: HostSpawnOptions = {}) => {
      if (failInstall && options.input) return { ok: false, code: 1, stderr: "disk full", stdout: "" };
      const input = typeof options.input === "string" ? new TextEncoder().encode(options.input) : options.input;
      const result = Bun.spawnSync(args, { stdin: input ?? "ignore" });
      return {
        ok: result.exitCode === 0,
        code: result.exitCode,
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
      };
    },
  }));

  try {
    const { prepareRclone, getRcloneExecutable, createRcloneProcess, needsSignIn } =
      await import("../src/lib/rclone.ts");
    expect(getRcloneExecutable).toThrow(/not been prepared/);
    await prepareRclone();
    const original = getRcloneExecutable();
    expect(await Bun.file(original).text()).toBe(bundled);
    expect((await Bun.file(original).stat()).mode & 0o777).toBe(0o700);
    const inode = (await Bun.file(original).stat()).ino;

    await prepareRclone();
    expect(getRcloneExecutable()).toBe(original);
    expect((await Bun.file(original).stat()).ino).toBe(inode);

    await Bun.write(original, "damaged executable");
    await prepareRclone();
    expect(await Bun.file(original).text()).toBe(bundled);

    bundled =
      '#!/bin/sh\nif [ "$1" = mount ]; then printf "invalid session token\\n" >&2; exit 1; fi\nprintf "rclone test v2\\n"\n';
    await Bun.write(bundledFile, bundled);
    failInstall = true;
    await expect(prepareRclone()).rejects.toThrow(/disk full/);
    expect(await Bun.file(original).text()).toContain("v1");

    failInstall = false;
    await prepareRclone();
    expect(getRcloneExecutable()).not.toBe(original);
    expect(await Bun.file(getRcloneExecutable()).text()).toBe(bundled);

    const child = await createRcloneProcess(path.join(home, "mount"));
    expect(child).not.toBeNull();
    if (!child) throw new Error("Fixture rclone did not start");
    expect(await child.finished).toBe(1);
    expect(child.output.stderr).toBe("invalid session token\n");
    expect(needsSignIn(child)).toBe(true);
  } finally {
    mock.module(new URL("../src/lib/host.ts", import.meta.url).href, () => originalHost);
    mock.module(new URL("../src/lib/constants.ts", import.meta.url).href, () => originalConstants);
    await rm(home, { recursive: true, force: true });
  }
});
