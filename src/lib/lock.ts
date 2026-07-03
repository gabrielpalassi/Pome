import fs from "node:fs";
import { createConnection, createServer, type Server } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { APP_ID } from "./constants.js";
import { log } from "./utils.js";

let lockServer: Server | null = null;

function canConnectToLockSocket(lockPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    // A connectable socket means another Pome process is alive
    const socket = createConnection(lockPath);
    let resolved = false;

    const finish = (canConnect: boolean): void => {
      if (resolved) return;

      resolved = true;
      socket.destroy();
      resolve(canConnect);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT" || error.code === "ENOTSOCK") {
        finish(false);
        return;
      }

      reject(error);
    });
  });
}

function listenOnLockSocket(lockPath: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    // Binding a Unix socket gives us an atomic single-instance lock
    const server = createServer((socket) => {
      socket.end();
    });

    server.once("error", reject);
    server.listen(lockPath, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

export async function acquireSingleInstanceLock(): Promise<boolean> {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  const lockPath = path.join(runtimeDir, `${APP_ID}.sock`);

  while (true) {
    try {
      lockServer = await listenOnLockSocket(lockPath);
      lockServer.unref();
      process.on("exit", () => {
        try {
          lockServer?.close();
          lockServer = null;
          fs.rmSync(lockPath, { force: true });
        } catch {
          // Best effort cleanup only
        }
      });
      return true;
    } catch (error: unknown) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "EADDRINUSE") throw error;
    }

    // The socket path exists, but it may be stale after an unclean exit
    if (await canConnectToLockSocket(lockPath)) {
      log("Pome is already running.");
      return false;
    }

    fs.rmSync(lockPath, { force: true });
  }
}
