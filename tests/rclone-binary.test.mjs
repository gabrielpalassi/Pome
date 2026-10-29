import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mock, test } from "node:test";

// Exercise the real staging shell commands in an isolated host home. The fixture
// is executable without rclone or iCloud credentials on the test machine.
test("bundled helper is staged, reused, repaired, and upgraded", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "pome rclone "));
  let bundled = Buffer.from('#!/bin/sh\nprintf "rclone test v1\\n"\n');
  let failInstall = false;
  mock.module("node:fs/promises", { namedExports: { readFile: async () => bundled } });
  mock.module(new URL("../dist/lib/host.js", import.meta.url).href, {
    namedExports: {
      inFlatpak: true,
      commandExists: async () => false,
      getHostHomeDir: async () => home,
      getHostUserConfigDir: async () => path.join(home, ".config"),
      hostRun: async () => {
        throw new Error("Unexpected hostRun during binary preparation");
      },
      hostSpawn: () => {
        throw new Error("Unexpected hostSpawn during binary preparation");
      },
      hostRunWithOutput: async (args, options = {}) => {
        if (failInstall && options.input) return { ok: false, stderr: "disk full", stdout: "" };
        const result = spawnSync(args[0], args.slice(1), { input: options.input, encoding: "utf8" });
        return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
      },
    },
  });

  try {
    const { prepareRclone, getRcloneExecutable } = await import("../dist/lib/rclone.js");
    assert.throws(getRcloneExecutable, /not been prepared/);
    await prepareRclone();
    const original = getRcloneExecutable();
    assert.equal(await readFile(original, "utf8"), bundled.toString());
    assert.equal((await stat(original)).mode & 0o777, 0o700);
    const inode = (await stat(original)).ino;

    await prepareRclone();
    assert.equal(getRcloneExecutable(), original);
    assert.equal((await stat(original)).ino, inode);

    await writeFile(original, "damaged executable");
    await prepareRclone();
    assert.equal(await readFile(original, "utf8"), bundled.toString());

    bundled = Buffer.from('#!/bin/sh\nprintf "rclone test v2\\n"\n');
    failInstall = true;
    await assert.rejects(prepareRclone(), /disk full/);
    assert.equal((await readFile(original, "utf8")).includes("v1"), true);

    failInstall = false;
    await prepareRclone();
    assert.notEqual(getRcloneExecutable(), original);
    assert.equal(await readFile(getRcloneExecutable(), "utf8"), bundled.toString());
  } finally {
    mock.restoreAll();
    await rm(home, { recursive: true, force: true });
  }
});
