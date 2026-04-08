const levels = ["ERROR", "WARN", "INFO"] as const;

function fmt(level: string, ctx: string, msg: string, kv?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const kvStr = kv
    ? " " + Object.entries(kv).map(([k, v]) => `${k}=${v}`).join(" ")
    : "";
  return `${ts} ${level.padEnd(5)} [${ctx}] - ${msg}${kvStr}`;
}

export const log = {
  info(msg: string, kv?: Record<string, unknown>) {
    console.log(fmt("INFO", "scraper", msg, kv));
  },
  warn(msg: string, kv?: Record<string, unknown>) {
    console.warn(fmt("WARN", "scraper", msg, kv));
  },
  error(msg: string, kv?: Record<string, unknown>) {
    console.error(fmt("ERROR", "scraper", msg, kv));
  },
};
