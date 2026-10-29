#!/usr/bin/env node

import process from "node:process";
import {
  MOUNT_HEALTH_CHECK_INTERVAL_MS,
  MOUNT_READY_POLL_INTERVAL_MS,
  MOUNT_READY_TIMEOUT_MS,
  REMOTE_NAME,
  TRY_AGAIN_WAIT_TIME_MS,
} from "./lib/constants.js";
import { getHostMountDir, inFlatpak } from "./lib/host.js";
import {
  notifyAlreadyRunning,
  notifyRcloneUnavailable,
  notifySignInRequired,
  notifyMountFailure,
  notifySessionExpired,
  notifySignInFailure,
  notifySuccess,
  notifyUpdateSessionFailure,
} from "./lib/notifications.js";
import { acquireSingleInstanceLock } from "./lib/lock.js";
import {
  prepareRclone,
  createMinimalRemote,
  hasRemote,
  createRcloneProcess,
  isMountedAndReadable,
  needsSignIn,
} from "./lib/rclone.js";
import { ensureFlatpakAutostart } from "./lib/autostart.js";
import { signIn } from "./lib/sign-in.js";
import type { RcloneProcess } from "./lib/types.js";
import { log, sleep } from "./lib/utils.js";

//
// Global state variables
//

const mountDir = await getHostMountDir();
let rcloneProcess: RcloneProcess | null = null;
let notifyMountStart = false;
let shutdownRequested = false;
let shutdownPromise: Promise<void> | null = null;

//
// Helper functions
//

function hasRcloneProcessExited(rcloneProcess: RcloneProcess): boolean {
  return rcloneProcess.exitCode !== null || rcloneProcess.signalCode !== null;
}

function waitForRcloneProcessExit(rcloneProcess: RcloneProcess): Promise<number | null> {
  if (hasRcloneProcessExited(rcloneProcess)) return Promise.resolve(rcloneProcess.exitCode);

  return new Promise<number | null>((resolve) => {
    rcloneProcess.once("error", () => resolve(127));
    rcloneProcess.once("close", resolve);
  });
}

async function handleShutdownSignal(): Promise<void> {
  shutdownRequested = true;

  if (!rcloneProcess || hasRcloneProcessExited(rcloneProcess)) return;

  // kill() only sends the signal, wait until rclone actually closes before exiting Pome
  rcloneProcess.kill();
  await waitForRcloneProcessExit(rcloneProcess);
}

async function handleRecoveryAction(action: string): Promise<void> {
  if (action === "signin") {
    const result = await signIn();

    if (result === "sign-in-failed") await notifySignInFailure();
    if (result === "session-update-failed") await notifyUpdateSessionFailure();
    if (result === "success") notifyMountStart = true;
  }

  if (action === "restart") {
    notifyMountStart = true;
    await sleep(TRY_AGAIN_WAIT_TIME_MS);
  }
}

async function waitForMountFailureOrRcloneProcessExit(rcloneProcess: RcloneProcess): Promise<number | null> {
  // Always listen for the rclone process to end
  const exitPromise = waitForRcloneProcessExit(rcloneProcess);

  // Keep checking for process exit, failed health check, or shutdown signal
  while (!shutdownRequested) {
    // Wait for either rclone to exit or the next health check.
    const result = await Promise.race([
      exitPromise,
      sleep(MOUNT_HEALTH_CHECK_INTERVAL_MS).then(() => "check" as const),
    ]);

    if (result !== "check") return result;

    // Health check: if the mount is no longer readable, kill the process and return the exit code
    if (!(await isMountedAndReadable(mountDir))) {
      log(`Mounted host rclone remote at ${mountDir}, but it is not readable.`);
      rcloneProcess.kill();
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
if (inFlatpak) ensureFlatpakAutostart();

// Prepare the bundled host executable before any remote or mount commands.
try {
  await prepareRclone();
} catch (error) {
  log(`Could not prepare rclone: ${error instanceof Error ? error.message : String(error)}`);
  await notifyRcloneUnavailable();
  process.exit(1);
}

// Handle shutdown signals gracefully
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // Start shutdown only once, even if multiple signals arrive before it finishes
    shutdownPromise ??= handleShutdownSignal();
    shutdownPromise.then(() => process.exit(0));
  });
}

//
// Main loop
//

while (!shutdownRequested) {
  // Ensure the rclone remote exists
  if (!(await hasRemote())) {
    log(`Missing ${REMOTE_NAME} rclone remote. Attempting to create a minimal remote for sign-in.`);
    const minimalRemote = await createMinimalRemote();
    const action = minimalRemote ? await notifySignInRequired() : await notifyMountFailure();
    await handleRecoveryAction(action);
    continue;
  }

  // Start the rclone mount process
  rcloneProcess = await createRcloneProcess(mountDir);
  if (!rcloneProcess) {
    const action = await notifyMountFailure();
    await handleRecoveryAction(action);
    continue;
  }

  // Poll until the mount is ready, rclone exits, or the readiness deadline expires
  let mountReady = false;
  const mountReadyDeadline = Date.now() + MOUNT_READY_TIMEOUT_MS;
  while (!hasRcloneProcessExited(rcloneProcess) && Date.now() < mountReadyDeadline) {
    if (await isMountedAndReadable(mountDir)) {
      mountReady = true;
      log(`Mounted host rclone remote at ${mountDir}.`);
      if (notifyMountStart) {
        await notifySuccess();
        notifyMountStart = false;
      }
      break;
    }

    const remainingWaitTime = mountReadyDeadline - Date.now();
    if (remainingWaitTime <= 0) break;

    await sleep(Math.min(MOUNT_READY_POLL_INTERVAL_MS, remainingWaitTime));
  }

  if (!mountReady && !hasRcloneProcessExited(rcloneProcess)) {
    log(`rclone mount did not become ready at ${mountDir}.`);
    // kill() only sends the signal, wait below until the process actually closes
    rcloneProcess.kill();
  }

  // Ready mounts keep health-checking, failed startups only wait for rclone to close
  const exitCode = mountReady
    ? await waitForMountFailureOrRcloneProcessExit(rcloneProcess)
    : await waitForRcloneProcessExit(rcloneProcess);
  log(`rclone mount exited with code ${exitCode}.`);

  // If shutdown was requested, break the loop, otherwise notify the user of the failure
  if (shutdownRequested) break;
  const action = needsSignIn(rcloneProcess) ? await notifySessionExpired() : await notifyMountFailure();
  await handleRecoveryAction(action);
}
