import { config } from "../config.js";

/** Sleep for a random duration between min and max delay. */
export function randomDelay(): Promise<void> {
  const ms =
    config.requestDelayMinMs +
    Math.random() * (config.requestDelayMaxMs - config.requestDelayMinMs);
  return new Promise((r) => setTimeout(r, ms));
}

/** Sleep for a fixed duration. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
