#!/usr/bin/env node

import process from "node:process";
import path from "node:path";
import {
  APP_DESCRIPTION,
  APP_ID,
  APP_NAME,
  MOUNT_HEALTH_CHECK_DELAY_MS,
  MOUNT_READY_ATTEMPTS,
  MOUNT_READY_DELAY_MS,
  REMOTE_NAME,
} from "./lib/constants.js";
import { commandExists, getHostMountDir, getHostUserConfigDir, hostRun, inFlatpak } from "./lib/host.js";
import {
  notifyAlreadyRunning,
  notifyMissingRclone,
  notifySignInRequired,
  notifyMountFailure,
  notifySessionExpired,
  notifySuccess,
} from "./lib/notifications.js";
import { acquireSingleInstanceLock } from "./lib/lock.js";
import {
  createMinimalRemote,
  hasRemote,
  createMountProcess,
  isMountedAndReadable,
  mountNeedsSignIn,
} from "./lib/rclone.js";
import { signIn } from "./lib/sign-in.js";
import type { MountProcess } from "./lib/types.js";
import { log, shellQuote, sleep } from "./lib/utils.js";

//
// Global state variables
//

const mountDir = await getHostMountDir();
let mountProcess: MountProcess | null = null;
let notifyMountStart = false;
let shutdownRequested = false;
let shutdownPromise: Promise<void> | null = null;

//
// Helper functions
//

function hasMountProcessExited(mountProcess: MountProcess): boolean {
  return mountProcess.exitCode !== null || mountProcess.signalCode !== null;
}

function waitForMountProcessExit(mountProcess: MountProcess): Promise<number | null> {
  if (hasMountProcessExited(mountProcess)) return Promise.resolve(mountProcess.exitCode);

  return new Promise<number | null>((resolve) => {
    mountProcess.once("error", () => resolve(127));
    mountProcess.once("close", resolve);
  });
}

async function handleShutdownSignal(): Promise<void> {
  shutdownRequested = true;

  if (!mountProcess || hasMountProcessExited(mountProcess)) return;

  // kill() only sends the signal, wait until rclone actually closes before exiting Pome
  mountProcess.kill();
  await waitForMountProcessExit(mountProcess);
}

async function handleRecoveryAction(action: string): Promise<void> {
  if (action === "signin") {
    await signIn();
  }
  if (action === "restart") {
    notifyMountStart = true;
  }
}

async function waitForMountExit(mountProcess: MountProcess): Promise<number | null> {
  // Always listen for the rclone process to end
  const exitPromise = waitForMountProcessExit(mountProcess);

  // Keep checking for process exit, failed health check, or shutdown signal
  while (!shutdownRequested) {
    // Wait for either rclone to exit or the next health check.
    const result = await Promise.race([exitPromise, sleep(MOUNT_HEALTH_CHECK_DELAY_MS).then(() => "check" as const)]);

    if (result !== "check") return result;

    // Health check: if the mount is no longer readable, kill the process and return the exit code
    if (!(await isMountedAndReadable(mountDir))) {
      log(`Mounted host rclone remote at ${mountDir}, but it is not readable.`);
      mountProcess.kill();
      return exitPromise;
    }
  }

  return exitPromise;
}

//
// Initial checks and setup
//

// Ensure only a single instance of the app is running
if (!(await acquireSingleInstanceLock())) {
  await notifyAlreadyRunning();
  process.exit(0);
}

// Ensure the app is set to autostart if running in a Flatpak
if (inFlatpak) {
  const configDir = await getHostUserConfigDir();
  const autostartDir = path.join(configDir, "autostart");
  const desktopPath = path.join(autostartDir, `${APP_ID}.desktop`);
  const desktop = [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${APP_NAME}`,
    `Comment=${APP_DESCRIPTION}`,
    `Exec=flatpak run --command=pome ${APP_ID}`,
    `Icon=${APP_ID}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");

  const autostartDirReady = await hostRun(["mkdir", "-p", autostartDir]);
  const autostartEntryReady = await hostRun(["sh", "-lc", `cat > ${shellQuote(desktopPath)} <<'EOF'\n${desktop}EOF\n`]);
  if (!(autostartDirReady && autostartEntryReady)) log(`Could not create autostart entry at ${desktopPath}.`);
}

// Check for rclone
if (!(await commandExists("rclone"))) {
  log("rclone is not installed or is not available on PATH.");
  await notifyMissingRclone();
  process.exit(1);
}

// Handle shutdown signals gracefully
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdownPromise ??= handleShutdownSignal();
    void shutdownPromise.then(() => process.exit(0));
  });
}

//
// Main loop
//

while (!shutdownRequested) {
  let mountReady = false;

  // Ensure the rclone remote exists
  if (!(await hasRemote())) {
    log(`Missing ${REMOTE_NAME} rclone remote.`);

    const minimalRemote = await createMinimalRemote();
    const action = minimalRemote ? await notifySignInRequired() : await notifyMountFailure();

    await handleRecoveryAction(action);
    continue;
  }

  // Start the rclone mount process
  mountProcess = await createMountProcess(mountDir);
  if (!mountProcess) {
    const action = await notifyMountFailure();
    await handleRecoveryAction(action);
    continue;
  }

  // Wait for the mount to be ready, or for the process to exit
  for (let attempt = 0; attempt < MOUNT_READY_ATTEMPTS; attempt += 1) {
    if (hasMountProcessExited(mountProcess)) break;

    if (await isMountedAndReadable(mountDir)) {
      mountReady = true;
      log(`Mounted host rclone remote at ${mountDir}.`);
      if (notifyMountStart) {
        await notifySuccess();
        notifyMountStart = false;
      }
      break;
    }

    await sleep(MOUNT_READY_DELAY_MS);
  }

  if (!mountReady && !hasMountProcessExited(mountProcess)) {
    log(`rclone mount did not become ready at ${mountDir}.`);
    // kill() only sends the signal, wait below until the process actually closes
    mountProcess.kill();
  }

  // Ready mounts keep health-checking, failed startups only wait for rclone to close
  const exitCode = mountReady ? await waitForMountExit(mountProcess) : await waitForMountProcessExit(mountProcess);
  log(`rclone mount exited with code ${exitCode}.`);

  // If shutdown was requested, break the loop, otherwise notify the user of the failure
  if (shutdownRequested) break;
  const action = mountNeedsSignIn(mountProcess) ? await notifySessionExpired() : await notifyMountFailure();
  await handleRecoveryAction(action);
}
