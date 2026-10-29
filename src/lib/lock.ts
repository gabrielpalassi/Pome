import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { APP_ID } from "./constants.ts";
import { log } from "./utils.ts";

let lockServer: Bun.UnixSocketListener<undefined> | null = null;

async function canConnectToLockSocket(lockPath: string): Promise<boolean> {
  try {
    const socket = await Bun.connect({ unix: lockPath, socket: { data() {} } });
    socket.end();
    return true;
  } catch (error) {
    const { code } = error as { code?: string };
    if (code === "ECONNREFUSED" || code === "ENOENT" || code === "ENOTSOCK") return false;
    throw error;
  }
}

export async function acquireSingleInstanceLock(): Promise<boolean> {
  const runtimeDir = Bun.env.XDG_RUNTIME_DIR || tmpdir();
  const lockPath = path.join(runtimeDir, `${APP_ID}.sock`);

  while (true) {
    try {
      // Binding a Unix socket gives us an atomic single-instance lock.
      lockServer = Bun.listen({
        unix: lockPath,
        socket: {
          open(socket) {
            socket.end();
          },
          data() {},
        },
      });
      lockServer.unref();
      process.on("exit", () => {
        // Bun removes the owned socket path when the listener stops.
        lockServer?.stop(true);
        lockServer = null;
      });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code !== "EADDRINUSE") throw error;
    }

    // The socket path exists, but it may be stale after an unclean exit.
    if (await canConnectToLockSocket(lockPath)) {
      log("Pome is already running.");
      return false;
    }

    try {
      await Bun.file(lockPath).unlink();
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
  }
}
