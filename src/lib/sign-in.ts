import {
  notifyMissingRemote,
  notifySignInFailure,
  notifySuccess,
  notifyUpdateSessionFailure,
} from "./notifications.js";
import { hasRemote, updateSession } from "./rclone.js";
import { log } from "./utils.js";
import type { ICloudSession } from "./types.js";

export async function signIn(): Promise<void> {
  const puppeteer = await import("puppeteer");
  const config: ICloudSession = {};

  let browser;
  try {
    // Open iCloud in a visible browser so the user can complete sign-in
    browser = await puppeteer.default.launch({
      headless: false,
      defaultViewport: null,
      timeout: 0,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = (await browser.pages())[0] ?? (await browser.newPage());

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
    await page.goto("https://www.icloud.com");

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

        const trustCookie = cookieHeader
          .split(";")
          .map((cookie) => cookie.trim())
          .find((cookie) => cookie.startsWith("X-APPLE-WEBAUTH-HSA-TRUST"));
        if (!trustCookie) return false;

        config.token = trustCookie.split("=")[1];
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
  if (!(await hasRemote())) {
    await notifyMissingRemote();
    return;
  }

  if (!(await updateSession(config))) {
    await notifyUpdateSessionFailure();
    return;
  }

  await notifySuccess();
}
