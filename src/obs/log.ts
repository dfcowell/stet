export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const ORDER: Record<LogLevel, number> = { silent: -1, error: 0, warn: 1, info: 2, debug: 3 };

export type Fields = Record<string, unknown>;

export interface Logger {
  readonly level: LogLevel;
  error(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  debug(msg: string, fields?: Fields): void;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "string") return /[\s"]/.test(v) ? JSON.stringify(v) : v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function formatFields(fields?: Fields): string {
  if (!fields) return "";
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${formatValue(v)}`);
  return parts.length ? " " + parts.join(" ") : "";
}

export function parseLogLevel(raw: string | undefined): LogLevel {
  const v = (raw ?? "").toLowerCase();
  return v in ORDER ? (v as LogLevel) : "info";
}

export function createLogger(opts?: { level?: LogLevel; sink?: (line: string) => void }): Logger {
  const level = opts?.level ?? "info";
  const sink = opts?.sink ?? ((line: string) => process.stderr.write(line + "\n"));
  const threshold = ORDER[level];

  function emit(lvl: LogLevel, msg: string, fields?: Fields): void {
    if (ORDER[lvl] > threshold) return;
    const ts = new Date().toISOString();
    sink(`${ts} ${lvl.toUpperCase().padEnd(5)} ${msg}${formatFields(fields)}`);
  }

  return {
    level,
    error: (m, f) => emit("error", m, f),
    warn: (m, f) => emit("warn", m, f),
    info: (m, f) => emit("info", m, f),
    debug: (m, f) => emit("debug", m, f),
  };
}

// Process-wide logger configured from LOG_LEVEL (default: info).
export const log = createLogger({ level: parseLogLevel(process.env.LOG_LEVEL) });
