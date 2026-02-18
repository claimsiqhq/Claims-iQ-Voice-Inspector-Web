import pino from "pino";

const noop = () => {};

const silentPino = pino({ level: "silent" });

export const logger = {
  info: noop as any,
  warn: noop as any,
  error: noop as any,
  debug: noop as any,
  voiceToolCall: noop as any,
  voiceToolResult: noop as any,
  voiceToolError: noop as any,
  voiceSession: noop as any,
  apiError: noop as any,
  apiRequest: noop as any,
};

export default silentPino;
