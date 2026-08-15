import winston from "winston";
import path from "path";
import fs from "fs";
import { getRequestId } from "./requestContext";

// Ensure logs directory exists
const logDir = "logs";
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const REDACTED = "[REDACTED]";
const sensitiveKeyPattern =
  /password|passphrase|secret|token|authorization|cookie|otp|api[-_]?key|email|mail.*user|db.*user|database.*user|connection.*string|credential/i;

const serializeError = (error: any): Record<string, unknown> => ({
  name: error?.name || "Error",
  message: error?.message || String(error),
  stack: error?.stack,
  code: error?.code,
  sqlState: error?.sqlState || error?.parent?.sqlState,
  table: error?.table,
  constraint: error?.constraint || error?.index,
  fields: error?.fields,
});

export const sanitizeLogValue = (
  value: unknown,
  key = "",
  depth = 0,
): unknown => {
  if (sensitiveKeyPattern.test(key)) return REDACTED;
  if (value === null || value === undefined) return value;
  if (depth > 5) return "[MAX_DEPTH]";

  if (value instanceof Error) {
    const serialized = serializeError(value);
    const sanitized: Record<string, unknown> = {};
    for (const [errorKey, errorValue] of Object.entries(serialized)) {
      sanitized[errorKey] = sanitizeLogValue(errorValue, errorKey, depth + 1);
    }
    return sanitized;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, "", depth + 1));
  }
  if (typeof value === "object") {
    const candidate = value as Record<string, any>;
    if (candidate.name && candidate.message) {
      const serialized = serializeError(candidate);
      const sanitized: Record<string, unknown> = {};
      for (const [errorKey, errorValue] of Object.entries(serialized)) {
        sanitized[errorKey] = sanitizeLogValue(errorValue, errorKey, depth + 1);
      }
      return sanitized;
    }

    const sanitized: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(candidate)) {
      sanitized[childKey] = sanitizeLogValue(childValue, childKey, depth + 1);
    }
    return sanitized;
  }

  return value;
};

const secureMetadata = winston.format((info) => {
  const requestId = getRequestId();
  if (requestId && !info.requestId) info.requestId = requestId;

  for (const key of Object.keys(info)) {
    if (key === "level" || key === "message" || key === "timestamp") continue;
    info[key] = sanitizeLogValue(info[key], key);
  }
  return info;
});

// Custom format for console (more readable)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

// Format for files (structured JSON)
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(secureMetadata(), fileFormat),
  transports: [
    // Error log file
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
      maxsize: Number(process.env.LOG_MAX_SIZE_BYTES) || 10 * 1024 * 1024,
      maxFiles: Number(process.env.LOG_MAX_FILES) || 5,
      tailable: true,
    }),
    // Combined log file
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
      maxsize: Number(process.env.LOG_MAX_SIZE_BYTES) || 10 * 1024 * 1024,
      maxFiles: Number(process.env.LOG_MAX_FILES) || 5,
      tailable: true,
    }),
  ],
});

// Add console transport in all environments (human-readable)
logger.add(
  new winston.transports.Console({
    format: consoleFormat,
  })
);

export default logger;
