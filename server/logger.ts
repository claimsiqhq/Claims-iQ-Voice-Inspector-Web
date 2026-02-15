function log(level: string, source: string, message: string, meta?: unknown) {
  const ts = new Date().toISOString();
  const out = meta ? `${ts} [${level}] ${source}: ${message} ${JSON.stringify(meta)}` : `${ts} [${level}] ${source}: ${message}`;
  if (level === "error") console.error(out);
  else console.log(out);
}

export const logger = {
  info: (source: string, message: string, meta?: unknown) => log("info", source, message, meta),
  warn: (source: string, message: string, meta?: unknown) => log("warn", source, message, meta),
  error: (source: string, message: string, meta?: unknown) => log("error", source, message, meta),
  apiError: (method: string, path: string, err: unknown) =>
    log("error", "api", `${method} ${path} failed`, { err: String(err) }),
};
