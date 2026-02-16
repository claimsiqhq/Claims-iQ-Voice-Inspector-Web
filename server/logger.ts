import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "body.password",
      "body.fileBase64",
      "body.token",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  transport:
    isProduction
      ? undefined
      : {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
});

export const logger = {
  info(category: string, message: string, data?: any) {
    pinoLogger.info({ category, ...(data !== undefined && { data }) }, message);
  },
  warn(category: string, message: string, data?: any) {
    pinoLogger.warn({ category, ...(data !== undefined && { data }) }, message);
  },
  error(category: string, message: string, data?: any) {
    pinoLogger.error({ category, ...(data !== undefined && { data }) }, message);
  },
  debug(category: string, message: string, data?: any) {
    pinoLogger.debug({ category, ...(data !== undefined && { data }) }, message);
  },

  voiceToolCall(toolName: string, args: any) {
    pinoLogger.info({ category: "VOICE_TOOL", toolName, args }, `▶ ${toolName}`);
  },
  voiceToolResult(toolName: string, result: any) {
    pinoLogger.info({ category: "VOICE_TOOL", toolName, result }, `◀ ${toolName}`);
  },
  voiceToolError(toolName: string, error: any) {
    const errMsg = error instanceof Error ? error.message : String(error);
    pinoLogger.error({ category: "VOICE_TOOL", toolName, err: error }, `✖ ${toolName}: ${errMsg}`);
  },
  voiceSession(action: string, data?: any) {
    pinoLogger.info({ category: "VOICE_SESSION", action, ...(data !== undefined && { data }) }, action);
  },

  apiError(method: string, path: string, error: any) {
    const errMsg = error instanceof Error ? error.message : String(error);
    pinoLogger.error({ category: "API", method, path, err: error }, `${method} ${path}: ${errMsg}`);
  },
  apiRequest(method: string, path: string, data?: any) {
    pinoLogger.info({ category: "API", method, path, ...(data !== undefined && { data }) }, `${method} ${path}`);
  },
};

export default pinoLogger;
