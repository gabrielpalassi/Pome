import dbus from "dbus-next";
import { APP_ID, APP_NAME, DRIVE_NAME, NOTIFICATION_ACTION_TIMEOUT_MS, NOTIFICATION_ICON } from "./constants.js";
import { log } from "./utils.js";
import type { PortalNotification, NotificationOptions } from "./types.js";

async function notify(
  title: string,
  body: string,
  { critical = false, actions = [] }: NotificationOptions = {},
): Promise<string> {
  try {
    const { Variant } = dbus;
    const bus = dbus.sessionBus();
    const object = await bus.getProxyObject("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop");
    const notifications = object.getInterface("org.freedesktop.portal.Notification");

    // Build the notification payload
    const hasActions = actions.length > 0;
    const notificationId = `${APP_ID}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    const notification: PortalNotification = {
      title: new Variant("s", title),
      body: new Variant("s", body),
      icon: new Variant("s", NOTIFICATION_ICON),
      priority: new Variant("s", critical ? "urgent" : "normal"),
    };

    if (hasActions) {
      notification.buttons = new Variant(
        "aa{sv}",
        actions.map((action) => ({
          label: new Variant("s", action.label),
          action: new Variant("s", action.id),
        })),
      );
    }

    // Listen for button clicks when the notification has actions
    let cleanup = (): void => bus.disconnect();
    const actionPromise = hasActions
      ? new Promise<string>((resolve) => {
          let finished = false;
          const timeout = setTimeout(() => finish(""), NOTIFICATION_ACTION_TIMEOUT_MS);

          function finish(action: string): void {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            notifications.off("ActionInvoked", onActionInvoked);
            bus.disconnect();
            resolve(action);
          }

          function onActionInvoked(id: string, action: string): void {
            if (id !== notificationId) return;
            finish(action);
          }

          cleanup = () => finish("");
          notifications.on("ActionInvoked", onActionInvoked);
        })
      : Promise.resolve("");

    // Send the notification, then keep the bus open only if an action can arrive
    try {
      await notifications.AddNotification(notificationId, notification);
    } catch (error) {
      cleanup();
      throw error;
    }

    if (!hasActions) cleanup();

    return actionPromise;
  } catch (error: unknown) {
    log(`Notification portal failed: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

export async function notifyMissingRclone(): Promise<void> {
  await notify(
    `${APP_NAME} needs a file sync helper`,
    `Install rclone on this computer, then open ${APP_NAME} again.`,
    { critical: true },
  );
}

export async function notifyMountFailure(): Promise<string> {
  return notify(
    `Can't connect to ${DRIVE_NAME}`,
    `Try again now, or sign in if your ${DRIVE_NAME} session has expired.`,
    {
      critical: true,
      actions: [
        { id: "restart", label: "Try Again" },
        { id: "signin", label: "Sign In" },
      ],
    },
  );
}

export async function notifyMissingRemote(): Promise<string> {
  return notify(
    `${DRIVE_NAME} needs sign in`,
    `${APP_NAME} prepared your ${DRIVE_NAME} connection. Sign in to finish setup.`,
    {
      critical: true,
      actions: [{ id: "signin", label: "Sign In" }],
    },
  );
}

export async function notifySignInFailure(): Promise<void> {
  await notify(`Couldn't sign in to ${DRIVE_NAME}`, `${APP_NAME} could not complete the ${DRIVE_NAME} sign-in.`, {
    critical: true,
  });
}

export async function notifyUpdateSessionFailure(): Promise<void> {
  await notify(`Couldn't update ${DRIVE_NAME}`, `${APP_NAME} could not save the ${DRIVE_NAME} session.`, {
    critical: true,
  });
}

export async function notifySuccess(): Promise<void> {
  await notify(`${DRIVE_NAME} is connected`, `${APP_NAME} successfully connected to ${DRIVE_NAME}.`);
}
