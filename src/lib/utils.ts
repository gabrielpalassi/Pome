import { APP_NAME } from "./constants.ts";

export function log(message: string): void {
  console.log(`[${APP_NAME}] ${message}`);
}

export function shellQuote(value: string): string {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
