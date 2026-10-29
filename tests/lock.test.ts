import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { APP_ID } from "../src/lib/constants.ts";

test("the Unix socket lock recovers stale paths, excludes another process, and cleans up on exit", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pome lock "));
  const lockPath = path.join(dir, `${APP_ID}.sock`);
  const moduleUrl = new URL("../src/lib/lock.ts", import.meta.url).href;
  const acquire = `const { acquireSingleInstanceLock } = await import(${JSON.stringify(moduleUrl)}); console.log(await acquireSingleInstanceLock());`;
  const env = { ...Bun.env, XDG_RUNTIME_DIR: dir };
  let owner: Bun.PipedSubprocess | undefined;
  try {
    // A stale non-socket path must not prevent the next instance from starting.
    await Bun.write(lockPath, "stale");
    owner = Bun.spawn([process.execPath, "-e", `${acquire} await Bun.stdin.text();`], {
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = owner.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    expect(new TextDecoder().decode(value)).toContain("true");

    const contender = Bun.spawn([process.execPath, "-e", acquire], { env, stdout: "pipe", stderr: "pipe" });
    expect(await new Response(contender.stdout).text()).toContain("false");
    expect(await contender.exited).toBe(0);

    owner.stdin.end();
    expect(await owner.exited).toBe(0);
    expect(
      await Bun.file(lockPath)
        .stat()
        .catch(() => null),
    ).toBeNull();

    const next = Bun.spawn([process.execPath, "-e", acquire], { env, stdout: "pipe", stderr: "pipe" });
    expect(await new Response(next.stdout).text()).toContain("true");
    expect(await next.exited).toBe(0);
  } finally {
    if (owner && owner.exitCode === null) {
      owner.kill();
      await owner.exited;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
