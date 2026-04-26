import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { APP_ID } from "./constants.js";
import { log } from "./utils.js";

export function acquireSingleInstanceLock(): boolean {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  const lockPath = path.join(runtimeDir, `${APP_ID}.lock`);
  let staleLockRemoved = false;

  while (true) {
    // Try to create the lock atomically
    try {
      const lockHandle = fs.openSync(lockPath, "wx");
      fs.writeFileSync(lockHandle, String(process.pid));
      process.on("exit", () => {
        try {
          fs.closeSync(lockHandle);
          fs.rmSync(lockPath, { force: true });
        } catch {
          // Best effort cleanup only
        }
      });
      return true;
    } catch (error: unknown) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "EEXIST") throw error;
    }

    // Recover if the lock belongs to a process that no longer exists
    const oldPid = Number.parseInt(fs.readFileSync(lockPath, "utf8"), 10);
    if (oldPid && oldPid !== process.pid) {
      try {
        process.kill(oldPid, 0);
      } catch {
        if (staleLockRemoved) throw new Error(`Unable to acquire lock at ${lockPath}`);

        staleLockRemoved = true;
        fs.rmSync(lockPath, { force: true });
        continue;
      }
    }

    // A live process owns the lock
    log("Pome is already running.");
    return false;
  }
}
