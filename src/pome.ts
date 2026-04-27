#!/usr/bin/env node

import process from "node:process";
import path from "node:path";
import {
  APP_DESCRIPTION,
  APP_ID,
  APP_NAME,
  MOUNT_READY_ATTEMPTS,
  MOUNT_READY_DELAY_MS,
  REMOTE_NAME,
} from "./lib/constants.js";
import { commandExists, getHostMountDir, getHostUserConfigDir, hostRun, inFlatpak } from "./lib/host.js";
import { notifyMissingRclone, notifyMissingRemote, notifyMountFailure, notifySuccess } from "./lib/notifications.js";
import { acquireSingleInstanceLock } from "./lib/lock.js";
import { createMinimalRemote, hasRemote, createMountProcess, isMounted } from "./lib/rclone.js";
import { signIn } from "./lib/sign-in.js";
import type { MountProcess } from "./lib/types.js";
import { log, shellQuote, sleep } from "./lib/utils.js";

// Ensure only a single instance of the app is running
if (!acquireSingleInstanceLock()) process.exit(0);

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
