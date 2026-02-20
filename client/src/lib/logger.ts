const enabled =
  import.meta.env.DEV ||
  String(import.meta.env.VITE_CLIENT_LOGS || "").toLowerCase() === "true";

function write(level: "error" | "warn" | "info" | "debug", category: string, message: string, data?: unknown) {
  if (!enabled) return;
  const prefix = `[${category}] ${message}`;
  if (data === undefined) {
    console[level](prefix);
  } else {
    console[level](prefix, data);
  }
}

export const logger = {
  error(category: string, message: string, data?: unknown) { write("error", category, message, data); },
  warn(category: string, message: string, data?: unknown) { write("warn", category, message, data); },
  info(category: string, message: string, data?: unknown) { write("info", category, message, data); },
  debug(category: string, message: string, data?: unknown) { write("debug", category, message, data); },
};
