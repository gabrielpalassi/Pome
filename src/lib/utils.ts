import { APP_NAME } from "./constants.js";

export function log(message: string): void {
  console.log(`[${APP_NAME}] ${message}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shellQuote(value: string): string {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
