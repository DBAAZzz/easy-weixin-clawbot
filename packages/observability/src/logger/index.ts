import { getTraceId } from "../trace/index.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

function normalizeFields(fields: LogFields | undefined): LogFields {
  if (!fields) return {};
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, normalizeValue(value)]),
  );
}

function write(level: LogLevel, fields: LogFields, message: string): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    traceId: getTraceId(),
    message,
    ...normalizeFields(fields),
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function createLogger(fields: LogFields = {}): Logger {
  return {
    debug(message, nextFields) {
      write("debug", { ...fields, ...nextFields }, message);
    },
    info(message, nextFields) {
      write("info", { ...fields, ...nextFields }, message);
    },
    warn(message, nextFields) {
      write("warn", { ...fields, ...nextFields }, message);
    },
    error(message, nextFields) {
      write("error", { ...fields, ...nextFields }, message);
    },
    child(nextFields) {
      return createLogger({ ...fields, ...nextFields });
    },
  };
}
