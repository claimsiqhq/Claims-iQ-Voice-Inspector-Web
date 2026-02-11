/**
 * Client-side structured logger. Logs to console in development.
 * Use logger.error/warn/info/debug instead of console.* for consistency.
 */

const isDev = import.meta.env.DEV;

export const logger = {
  error(category: string, message: string, data?: unknown) {
    if (isDev) console.error(`[${category}]`, message, data);
    else if (typeof window !== "undefined" && (window as unknown as { __logErrors?: boolean }).__logErrors) {
      console.error(`[${category}]`, message, data);
    }
  },
  warn(category: string, message: string, data?: unknown) {
    if (isDev) console.warn(`[${category}]`, message, data);
  },
  info(category: string, message: string, data?: unknown) {
    if (isDev) console.info(`[${category}]`, message, data);
  },
  debug(category: string, message: string, data?: unknown) {
    if (isDev) console.debug(`[${category}]`, message, data);
  },
};
