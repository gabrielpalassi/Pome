import type dbus from "dbus-next";

export interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface HostSpawnOptions {
  env?: Record<string, string | undefined>;
  input?: string | Uint8Array;
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

export interface ProcessOutput {
  stdout: string;
  stderr: string;
}

export interface PortalNotification {
  title: dbus.Variant<string>;
  body: dbus.Variant<string>;
  icon: dbus.Variant<string>;
  priority: dbus.Variant<string>;
  buttons?: dbus.Variant<Record<string, dbus.Variant<string>>[]>;
}

export type PortalOptions = Record<string, dbus.Variant>;

export type PortalBackground = dbus.ClientInterface & {
  RequestBackground(parentWindow: string, options: PortalOptions): Promise<string>;
};

export type PortalMessageBus = dbus.MessageBus & {
  name: string | null;
  _addMatch(match: string): Promise<unknown>;
  _removeMatch(match: string): Promise<unknown>;
};

export interface PortalResponseListener {
  response: Promise<boolean>;
  cleanup(): void;
}

export type RcloneProcess = Bun.ReadableSubprocess & {
  output: ProcessOutput;
  finished: Promise<number>;
};
