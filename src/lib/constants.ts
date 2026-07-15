export const APP_ID = "io.github.gabrielpalassi.Pome";
export const APP_NAME = "Pome";
export const APP_DESCRIPTION = "iCloud Drive for your Linux desktop.";
export const NOTIFICATION_ICON = `${APP_ID}.notification`;
export const REMOTE_NAME = "iclouddrive";
export const REMOTE = `${REMOTE_NAME}:`;
export const DRIVE_NAME = "iCloud Drive";
export const MOUNT_FLAGS = ["--vfs-cache-mode", "full", "--dir-cache-time", "30s"];
export const MOUNT_HEALTH_CHECK_DELAY_MS = 30 * 1000;
export const MOUNT_READY_ATTEMPTS = 10;
export const MOUNT_READY_WAIT_TIME_MS = 500;
export const TRY_AGAIN_WAIT_TIME_MS = 2 * 1000;
export const NOTIFICATION_ACTION_TIMEOUT_MS = 5 * 60 * 1000;
export const AUTOSTART_RESPONSE_TIMEOUT_MS = 30 * 1000;
export const ICLOUD_URL = "https://www.icloud.com";
export const CHROME_EXECUTABLE_PATH = "/app/lib/pome/chrome/chrome";
export const LOCAL_CHROME_EXECUTABLE_CANDIDATES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "chrome",
] as const;
