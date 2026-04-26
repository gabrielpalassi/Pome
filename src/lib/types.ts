import type { ChildProcess } from "node:child_process";
import type dbus from "dbus-next";

export interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface HostSpawnOptions {
  stdio?: "pipe" | "inherit" | "ignore";
  env?: NodeJS.ProcessEnv;
}

export interface NotificationOptions {
  critical?: boolean;
  actions?: {
    id: string;
    label: string;
  }[];
}

export interface ICloudSession {
  cookies?: string;
  token?: string;
  appleId?: string;
}

export interface PortalNotification {
  title: dbus.Variant<string>;
  body: dbus.Variant<string>;
  icon: dbus.Variant<string>;
  priority: dbus.Variant<string>;
  buttons?: dbus.Variant<Record<string, dbus.Variant<string>>[]>;
}

export type MountProcess = ChildProcess;
