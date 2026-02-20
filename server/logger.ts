import pino from "pino";

const resolvedLevel =
  process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === "production" ? "info" : "debug");

const pinoInstance = pino({
  level: resolvedLevel,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

function logAt(level: "info" | "warn" | "error" | "debug", ...args: unknown[]) {
  if (typeof args[0] === "string" && typeof args[1] === "string") {
    const [category, message, data] = args;
    pinoInstance[level]({ category, data }, message);
    return;
  }
  if (typeof args[0] === "string") {
    const [message, data] = args;
    pinoInstance[level]({ data }, message);
    return;
  }
  pinoInstance[level]({ data: args[0] }, "log");
}

export const logger = {
  info: (...args: unknown[]) => logAt("info", ...args),
  warn: (...args: unknown[]) => logAt("warn", ...args),
  error: (...args: unknown[]) => logAt("error", ...args),
  debug: (...args: unknown[]) => logAt("debug", ...args),
  voiceToolCall: (tool: string, payload?: unknown) => {
    pinoInstance.info({ tool, payload }, "Voice tool call");
  },
  voiceToolResult: (tool: string, result?: unknown) => {
    pinoInstance.info({ tool, result }, "Voice tool result");
  },
  voiceToolError: (tool: string, error?: unknown) => {
    pinoInstance.error({ tool, error }, "Voice tool error");
  },
  voiceSession: (event: string, data?: unknown) => {
    pinoInstance.info({ event, data }, "Voice session");
  },
  apiError: (method: string, path: string, error?: unknown) => {
    pinoInstance.error({ method, path, error }, "API error");
  },
  apiRequest: (method: string, path: string, statusCode: number, durationMs?: number) => {
    pinoInstance.info({ method, path, statusCode, durationMs }, "API request");
  },
};

export default pinoInstance;
