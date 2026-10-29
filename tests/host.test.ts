import { expect, test } from "bun:test";
import { hostRun, hostRunWithOutput, hostSpawn } from "../src/lib/host.ts";

test("host commands receive input and environment and capture both output streams", async () => {
  const result = await hostRunWithOutput(["sh", "-c", 'cat; printf "%s" "$POME_TEST_VALUE" >&2'], {
    input: "input",
    env: { POME_TEST_VALUE: "environment" },
  });
  expect(result).toEqual({ ok: true, code: 0, stdout: "input", stderr: "environment" });
});

test("host commands drain large stdout and stderr streams concurrently", async () => {
  const input = new Uint8Array(512 * 1024).fill(120);
  const result = await hostRunWithOutput(
    [
      process.execPath,
      "-e",
      "const input = await Bun.stdin.bytes(); await Promise.all([Bun.write(Bun.stdout, input), Bun.write(Bun.stderr, input)]);",
    ],
    { input },
  );
  expect(result.ok).toBe(true);
  expect(result.stdout).toBe("x".repeat(input.length));
  expect(result.stderr).toBe(result.stdout);
});

test("host commands handle missing executables, unsuccessful exits, and early stdin closure", async () => {
  expect(await hostRunWithOutput([`/pome-missing-${crypto.randomUUID()}`])).toMatchObject({ ok: false, code: 127 });
  expect(await hostRun(["sh", "-c", "exit 7"])).toBe(false);
  expect(await hostRun(["sh", "-c", "exit 0"], { input: new Uint8Array(512 * 1024) })).toBe(true);
});

test("host subprocesses can be terminated and awaited during shutdown", async () => {
  const child = hostSpawn(["sh", "-c", "printf ready; exec sleep 30"]);
  try {
    const reader = child.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    expect(new TextDecoder().decode(value)).toBe("ready");
    child.kill();
    expect(await child.exited).not.toBe(0);
    expect(child.signalCode).toBe("SIGTERM");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await child.exited;
    }
  }
});
