import { notifySignInFailure, notifySuccess, notifyUpdateSessionFailure } from "./notifications.js";
import { updateSession } from "./rclone.js";
import { log } from "./utils.js";
import type { ICloudSession } from "./types.js";
import type { Page } from "puppeteer-core";
import { CHROME_EXECUTABLE_PATH, ICLOUD_URL, LOCAL_CHROME_EXECUTABLE_CANDIDATES } from "./constants.js";
import { hostRunWithOutput, inFlatpak } from "./host.js";

async function maximizeWindow(page: Page): Promise<void> {
  try {
    const client = await page.createCDPSession();
    const { windowId } = await client.send("Browser.getWindowForTarget");
    await client.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "maximized" },
    });
  } catch (error: unknown) {
    log(`Could not maximize sign-in window: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function splitCookieHeader(cookieHeader: string): string[] {
  const cookies: string[] = [];
  let cookie = "";
  let quoted = false;

  for (const character of cookieHeader) {
    if (character === '"') quoted = !quoted;

    if (character === ";" && !quoted) {
      cookies.push(cookie.trim());
      cookie = "";
      continue;
    }

    cookie += character;
  }

  if (cookie.trim()) cookies.push(cookie.trim());
  return cookies;
}

function getCookieValue(cookie: string): string {
  const separator = cookie.indexOf("=");
  return separator === -1 ? "" : cookie.slice(separator + 1);
}

async function resolveChromeExecutablePath(): Promise<string> {
  const configuredPath = process.env.POME_CHROME_EXECUTABLE_PATH?.trim();
  if (configuredPath) return configuredPath;

  if (inFlatpak) return CHROME_EXECUTABLE_PATH;

  for (const command of LOCAL_CHROME_EXECUTABLE_CANDIDATES) {
    const result = await hostRunWithOutput(["sh", "-lc", `command -v ${command}`]);
    const executablePath = result.stdout.trim();
    if (result.ok && executablePath) return executablePath;
  }

  throw new Error("Could not find Chrome or Chromium. Set POME_CHROME_EXECUTABLE_PATH to the browser executable.");
}

export async function signIn(): Promise<void> {
  const puppeteer = await import("puppeteer-core");
  const config: ICloudSession = {};

  let browser;
  try {
    const executablePath = await resolveChromeExecutablePath();
    const args = ["--ozone-platform=wayland", "--start-maximized", `--app=${ICLOUD_URL}`];

    if (inFlatpak) {
      // Required for the bundled Chromium in Flatpak: without it, launch fails with "No usable sandbox"
      args.unshift("--no-sandbox");
    }

    // Open iCloud in a visible browser so the user can complete sign-in
    browser = await puppeteer.default.launch({
      executablePath,
      headless: false,
      defaultViewport: null,
      timeout: 0,
      args,
    });

    const page = (await browser.pages())[0] ?? (await browser.newPage());
    await maximizeWindow(page);

    // Force iCloud to issue a longer-lived trust token
    page.on("request", async (request) => {
      if (request.isInterceptResolutionHandled()) return;

      if (!request.url().includes("/accountLogin")) {
        request.continue();
        return;
      }

      const bodyRaw = await request.fetchPostData();
      if (!bodyRaw) {
        request.continue();
        return;
      }

      try {
        const bodyJson = JSON.parse(bodyRaw);
        request.continue({
          postData: JSON.stringify({ ...bodyJson, extended_login: true }),
        });
      } catch {
        request.continue();
      }
    });

    // Capture the Apple ID from the login response when iCloud includes it
    page.on("response", async (response) => {
      if (!response.url().includes("/accountLogin")) return;

      try {
        const bodyJson = await response.json();
        if (typeof bodyJson?.dsInfo?.appleId === "string") {
          config.appleId = bodyJson.dsInfo.appleId;
        }
      } catch {
        // Some accountLogin responses are redirects or empty challenge bodies
      }
    });

    await page.setRequestInterception(true);
    await page.bringToFront();

    const signInButton = await page.waitForSelector(".sign-in-button", {
      timeout: 0,
    });
    if (!signInButton) {
      throw new Error("Could not find the iCloud sign-in button.");
    }
    await signInButton.click();

    // Wait until the trusted session cookies are present on a request
    await page.waitForRequest(
      (request) => {
        const cookieHeader = request.headers().cookie;
        if (!cookieHeader) return false;

        const trustCookie = splitCookieHeader(cookieHeader).find((cookie) =>
          cookie.startsWith("X-APPLE-WEBAUTH-HSA-TRUST"),
        );
        if (!trustCookie) return false;

        config.token = getCookieValue(trustCookie);
        config.cookies = cookieHeader;
        return true;
      },
      { timeout: 0 },
    );
  } catch (error: unknown) {
    log(`Failed to get iCloud login tokens: ${error instanceof Error ? error.message : String(error)}`);
    await notifySignInFailure();
    return;
  } finally {
    if (browser) await browser.close();
  }

  // Save the captured session into the rclone remote
  if (!(await updateSession(config))) {
    await notifyUpdateSessionFailure();
    return;
  }

  await notifySuccess();
}
