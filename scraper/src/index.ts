import { Redis } from "ioredis";
import { config } from "./config.js";
import { GoClient } from "./api/go-client.js";
import { Runner } from "./worker/runner.js";
import { log } from "./utils/logger.js";

async function main(): Promise<void> {
  log.info("starting scraper service");

  // 1. Connect Redis
  const redis = new Redis({
    host: config.redisHost,
    port: config.redisPort,
    maxRetriesPerRequest: null, // required for blocking commands
  });

  redis.on("error", (err: Error) => {
    log.error("redis connection error", { error: String(err) });
  });

  log.info("redis connected", {
    host: config.redisHost,
    port: config.redisPort,
  });

  // 2. Authenticate with Go API
  const api = new GoClient();
  await api.login();

  // 3. Start worker loop
  const runner = new Runner(redis, api);

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received, shutting down`);
    runner.stop();
    await redis.quit();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await runner.start();
}

main().catch((err) => {
  log.error("fatal startup error", { error: String(err) });
  process.exit(1);
});
