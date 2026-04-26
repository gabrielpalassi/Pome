import dbus from "dbus-next";
import { APP_ID, BACKGROUND_REQUEST_TIMEOUT_MS, DRIVE_NAME } from "./constants.js";
import { log } from "./utils.js";

export async function requestBackgroundAutostart(): Promise<boolean> {
  const { Variant } = dbus;
  const bus = dbus.sessionBus();

  try {
    // Ask the background portal to enable autostart
    const object = await bus.getProxyObject("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop");
    const background = object.getInterface("org.freedesktop.portal.Background");
    const handle = await background.RequestBackground("", {
      reason: new Variant("s", `Keep ${DRIVE_NAME} connected when you log in.`),
      autostart: new Variant("b", true),
      commandline: new Variant("as", ["flatpak", "run", "--command=pome", APP_ID]),
    });

    // Listen for the async portal response
    const requestObject = await bus.getProxyObject("org.freedesktop.portal.Desktop", handle);
    const request = requestObject.getInterface("org.freedesktop.portal.Request");

    const autostartEnabled = await new Promise<boolean>((resolve) => {
      let finished = false;
      const timeout = setTimeout(() => finish(false), BACKGROUND_REQUEST_TIMEOUT_MS);

      function finish(enabled: boolean): void {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        request.off("Response", onResponse);
        bus.disconnect();
        resolve(enabled);
      }

      function onResponse(response: number, results: Record<string, dbus.Variant<boolean>>): void {
        if (response !== 0) {
          finish(false);
          return;
        }

        finish(results.autostart?.value === true);
      }

      request.on("Response", onResponse);
    });

    return autostartEnabled;
  } catch (error: unknown) {
    bus.disconnect();
    log(`Background portal failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
