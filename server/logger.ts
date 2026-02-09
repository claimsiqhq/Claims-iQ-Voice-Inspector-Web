import fs from "fs";
import path from "path";

const LOGS_DIR = path.resolve(process.cwd(), "Logs");

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

const writeQueue: Map<string, string[]> = new Map();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 500;

function getTimestamp(): string {
  return new Date().toISOString();
}

function getDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatMessage(level: LogLevel, category: string, message: string, data?: any): string {
  const timestamp = getTimestamp();
  let line = `[${timestamp}] [${level}] [${category}] ${message}`;
  if (data !== undefined) {
    try {
      const serialized = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      line += `\n  Data: ${serialized}`;
    } catch {
      line += `\n  Data: [unserializable]`;
    }
  }
  return line;
}

function enqueue(filename: string, content: string) {
  const existing = writeQueue.get(filename);
  if (existing) {
    existing.push(content);
  } else {
    writeQueue.set(filename, [content]);
  }
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushAll();
  }, FLUSH_INTERVAL_MS);
}

function flushAll() {
  const entries = Array.from(writeQueue.entries());
  writeQueue.clear();
  for (const [filename, lines] of entries) {
    const filePath = path.join(LOGS_DIR, filename);
    const batch = lines.join("\n") + "\n";
    fs.appendFile(filePath, batch, (err) => {
      if (err) console.error("Logger write failed:", err);
    });
  }
}

function writeLog(level: LogLevel, category: string, message: string, data?: any) {
  const formatted = formatMessage(level, category, message, data);
  const dateStamp = getDateStamp();

  enqueue(`app_${dateStamp}.log`, formatted);

  if (category === "VOICE_TOOL" || category === "VOICE_SESSION") {
    enqueue(`voice_${dateStamp}.log`, formatted);
  }

  if (level === "ERROR") {
    enqueue(`errors_${dateStamp}.log`, formatted);
  }

  if (category === "API") {
    enqueue(`api_${dateStamp}.log`, formatted);
  }
}

export const logger = {
  info(category: string, message: string, data?: any) {
    writeLog("INFO", category, message, data);
  },
  warn(category: string, message: string, data?: any) {
    writeLog("WARN", category, message, data);
    console.warn(`[${category}] ${message}`);
  },
  error(category: string, message: string, data?: any) {
    writeLog("ERROR", category, message, data);
    console.error(`[${category}] ${message}`, data || "");
  },
  debug(category: string, message: string, data?: any) {
    writeLog("DEBUG", category, message, data);
  },

  voiceToolCall(toolName: string, args: any) {
    writeLog("INFO", "VOICE_TOOL", `▶ ${toolName}`, args);
  },
  voiceToolResult(toolName: string, result: any) {
    writeLog("INFO", "VOICE_TOOL", `◀ ${toolName}`, result);
  },
  voiceToolError(toolName: string, error: any) {
    const errMsg = error instanceof Error ? error.message : String(error);
    writeLog("ERROR", "VOICE_TOOL", `✖ ${toolName}: ${errMsg}`, error?.stack);
  },
  voiceSession(action: string, data?: any) {
    writeLog("INFO", "VOICE_SESSION", action, data);
  },

  apiError(method: string, path: string, error: any) {
    const errMsg = error instanceof Error ? error.message : String(error);
    writeLog("ERROR", "API", `${method} ${path}: ${errMsg}`, error?.stack);
  },
  apiRequest(method: string, path: string, data?: any) {
    writeLog("INFO", "API", `${method} ${path}`, data);
  },
};
