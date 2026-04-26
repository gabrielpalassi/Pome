#!/usr/bin/env node

import process from "node:process";
import { APP_NAME, MOUNT_READY_ATTEMPTS, MOUNT_READY_DELAY_MS, REMOTE_NAME } from "./lib/constants.js";
import { commandExists, getHostMountDir, inFlatpak } from "./lib/host.js";
import { notifyMissingRclone, notifyMissingRemote, notifyMountFailure, notifySuccess } from "./lib/notifications.js";
import { acquireSingleInstanceLock } from "./lib/lock.js";
import { createMinimalRemote, hasRemote, createMountProcess, isMounted } from "./lib/rclone.js";
import { signIn } from "./lib/sign-in.js";
import { requestBackgroundAutostart } from "./lib/background.js";
import type { MountProcess } from "./lib/types.js";
import { log, sleep } from "./lib/utils.js";

// Ensure only a single instance of the app is running
if (!acquireSingleInstanceLock()) process.exit(0);

// Ensure the app is set to autostart if running in a Flatpak
if (inFlatpak) {
  const autostartEnabled = await requestBackgroundAutostart();
  if (autostartEnabled) {
    log(`${APP_NAME} autostart is enabled through the background portal.`);
  } else {
    log(`${APP_NAME} autostart was not enabled by the background portal.`);
  }
}

// Check for rclone
if (!(await commandExists("rclone"))) {
  await notifyMissingRclone();
  process.exit(1);
}

const mountDir = await getHostMountDir();
let mountProcess: MountProcess | null = null;
let notifyMountStart = false;
let shutdownRequested = false;

async function handleShutdownSignal(): Promise<void> {
  shutdownRequested = true;
  if (mountProcess) mountProcess.kill();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void handleShutdownSignal().then(() => process.exit(0)));
}

async function handleRecoveryAction(action: string): Promise<void> {
  if (action === "signin") {
    await signIn();
  }
  if (action === "restart") {
    notifyMountStart = true;
  }
}

function hasMountProcessExited(mountProcess: MountProcess): boolean {
  return mountProcess.exitCode !== null || mountProcess.signalCode !== null;
}

// Main loop
while (!shutdownRequested) {
  // Ensure the rclone remote exists
  if (!(await hasRemote())) {
    log(`Missing ${REMOTE_NAME} rclone remote.`);

    const minimalRemote = await createMinimalRemote();
    const action = minimalRemote ? await notifyMissingRemote() : await notifyMountFailure();

    await handleRecoveryAction(action);
    continue;
  }

  // Start the rclone mount process
  mountProcess = await createMountProcess(mountDir);

  // Wait for the mount to be ready, or for the process to exit
  for (let attempt = 0; attempt < MOUNT_READY_ATTEMPTS; attempt += 1) {
    if (hasMountProcessExited(mountProcess)) break;

    if (await isMounted(mountDir)) {
      log(`Mounted host rclone remote at ${mountDir}.`);
      if (notifyMountStart) {
        await notifySuccess();
        notifyMountStart = false;
      }
      break;
    }

    await sleep(MOUNT_READY_DELAY_MS);
  }

  // Check if the process exited, if not, wait for it to exit
  const exitCode = hasMountProcessExited(mountProcess)
    ? mountProcess.exitCode
    : await new Promise<number | null>((resolve) => {
        mountProcess!.once("error", () => resolve(127));
        mountProcess!.once("close", resolve);
      });
  log(`rclone mount exited with code ${exitCode}.`);

  // If shutdown was requested, break the loop, otherwise notify the user of the failure
  if (shutdownRequested) break;
  const action = await notifyMountFailure();
  await handleRecoveryAction(action);
}
