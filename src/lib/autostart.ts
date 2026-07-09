import dbus from "dbus-next";
import { APP_NAME, AUTOSTART_RESPONSE_TIMEOUT_MS } from "./constants.js";
import { notifyAutostartFailure } from "./notifications.js";
import { log } from "./utils.js";
import type { PortalBackground, PortalMessageBus, PortalOptions, PortalResponseListener } from "./types.js";

function createHandleToken(): string {
  return `pome_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getRequestPath(bus: PortalMessageBus, handleToken: string): string {
  if (!bus.name) throw new Error("DBus session bus has no unique name");

  // Portal request paths include the caller bus name
  const sender = bus.name.slice(1).replaceAll(".", "_");
  return `/org/freedesktop/portal/desktop/request/${sender}/${handleToken}`;
}

async function listenForPortalResponse(bus: PortalMessageBus, requestPath: string): Promise<PortalResponseListener> {
  // Match only the response for this request
  const matchRule = [
    "type='signal'",
    "sender='org.freedesktop.portal.Desktop'",
    "interface='org.freedesktop.portal.Request'",
    `path='${requestPath}'`,
    "member='Response'",
  ].join(",");

  await bus._addMatch(matchRule);

  // Keep cleanup idempotent because timeout, response, and finally can all race
  let cleanupDone = false;
  let finish: (granted: boolean) => void = () => undefined;

  function cleanup(): void {
    if (cleanupDone) return;
    cleanupDone = true;
    bus.off("message", onMessage);
    void bus._removeMatch(matchRule);
  }

  const response = new Promise<boolean>((resolve) => {
    let finished = false;
    const timeout = setTimeout(() => finish(false), AUTOSTART_RESPONSE_TIMEOUT_MS);

    // Response code 0 means success
    finish = (granted: boolean): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      cleanup();
      resolve(granted);
    };
  });

  // Resolve when the portal answers
  function onMessage(message: dbus.Message): void {
    if (
      message.path !== requestPath ||
      message.interface !== "org.freedesktop.portal.Request" ||
      message.member !== "Response"
    ) {
      return;
    }

    const [responseCode] = message.body as [number, PortalOptions];
    finish(responseCode === 0);
  }

  bus.on("message", onMessage);
  return { response, cleanup };
}

export async function ensureFlatpakAutostart(): Promise<void> {
  const { Variant } = dbus;
  const bus = dbus.sessionBus() as PortalMessageBus;
  let responseListener: PortalResponseListener | null = null;

  try {
    // Prepare the portal call and response listener
    const object = await bus.getProxyObject("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop");
    const background = object.getInterface<PortalBackground>("org.freedesktop.portal.Background");
    const handleToken = createHandleToken();
    const requestPath = getRequestPath(bus, handleToken);
    responseListener = await listenForPortalResponse(bus, requestPath);

    // Ask the portal to enable background autostart
    const handle = await background.RequestBackground("", {
      handle_token: new Variant("s", handleToken),
      reason: new Variant("s", `${APP_NAME} keeps iCloud Drive connected after login.`),
      autostart: new Variant("b", true),
      background: new Variant("b", true),
      commandline: new Variant("as", ["pome"]),
    });

    // Older portals may return a different request path than the one we predicted
    if (handle !== requestPath) {
      log(`Background portal returned unexpected request handle: ${handle}`);
      responseListener.cleanup();
      responseListener = await listenForPortalResponse(bus, handle);
    }

    // Notify only when the portal denies, cancels, or times out
    const autostartGranted = await responseListener.response;
    if (!autostartGranted) {
      log("Background portal did not grant autostart.");
      await notifyAutostartFailure();
    }
  } catch (error: unknown) {
    log(`Background portal failed: ${error instanceof Error ? error.message : String(error)}`);
    await notifyAutostartFailure();
  } finally {
    responseListener?.cleanup();
    bus.disconnect();
  }
}
