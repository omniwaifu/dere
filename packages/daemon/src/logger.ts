/**
 * Structured logging for the daemon.
 *
 * Dev mode: Colorful, human-readable output
 * Production: JSON for log aggregators
 */

import * as Sentry from "@sentry/bun";

// ============================================================================
// Types
// ============================================================================

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

type LogEntry = {
  time: string;
  level: LogLevel;
  module: string;
  msg: string;
  context?: LogContext;
};

// ============================================================================
// Configuration
// ============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m", // gray
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};

const MODULE_COLORS: Record<string, string> = {
  daemon: "\x1b[34m", // blue
  swarm: "\x1b[35m", // magenta
  agent: "\x1b[35m", // magenta
  session: "\x1b[32m", // green
  emotion: "\x1b[33m", // yellow
  memory: "\x1b[36m", // cyan
  recall: "\x1b[36m", // cyan
  ambient: "\x1b[38;5;208m", // orange
  missions: "\x1b[34m", // blue
  summary: "\x1b[32m", // green
  context: "\x1b[90m", // gray
  graph: "\x1b[35m", // magenta
  events: "\x1b[38;5;141m", // purple/lavender
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// Environment detection
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MIN_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL as LogLevel] ?? LOG_LEVELS.debug;

// ============================================================================
// Formatting
// ============================================================================

function formatTime(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const time = now.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${month}/${day} ${time}`;
}

function formatISOTime(): string {
  return new Date().toISOString();
}

function formatContextValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return String(value);
  return JSON.stringify(value);
}

function formatContext(context: LogContext): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    parts.push(`${DIM}${key}=${RESET}${formatContextValue(value)}`);
  }
  return parts.join(" ");
}

function formatDevLog(entry: LogEntry): string {
  const levelColor = LEVEL_COLORS[entry.level];
  const moduleColor = MODULE_COLORS[entry.module] ?? "\x1b[37m";
  const levelPad = entry.level.toUpperCase().padEnd(5);

  let line = `${DIM}${entry.time}${RESET} ${levelColor}${BOLD}${levelPad}${RESET} ${moduleColor}[${entry.module}]${RESET} ${entry.msg}`;

  if (entry.context && Object.keys(entry.context).length > 0) {
    line += ` ${formatContext(entry.context)}`;
  }

  return line;
}

function formatJsonLog(entry: LogEntry): string {
  const output: Record<string, unknown> = {
    time: formatISOTime(),
    level: entry.level,
    module: entry.module,
    msg: entry.msg,
  };

  if (entry.context) {
    Object.assign(output, entry.context);
  }

  return JSON.stringify(output);
}

// ============================================================================
// Logger Class
// ============================================================================

class Logger {
  private module: string;

  constructor(module: string) {
    this.module = module;
  }

  private log(level: LogLevel, msg: string, context?: LogContext): void {
    if (LOG_LEVELS[level] < MIN_LEVEL) {
      return;
    }

    const entry: LogEntry = {
      time: formatTime(),
      level,
      module: this.module,
      msg,
    };
    if (context) {
      entry.context = context;
    }

    const output = IS_PRODUCTION ? formatJsonLog(entry) : formatDevLog(entry);

    // Route to appropriate console method
    switch (level) {
      case "error":
        console.error(output);
        // Add Sentry breadcrumb for errors
        Sentry.addBreadcrumb({
          category: this.module,
          message: msg,
          level: "error",
          ...(context ? { data: context } : {}),
        });
        break;
      case "warn":
        console.warn(output);
        Sentry.addBreadcrumb({
          category: this.module,
          message: msg,
          level: "warning",
          ...(context ? { data: context } : {}),
        });
        break;
      default:
        console.log(output);
        // Only add info breadcrumbs in production to reduce noise
        if (IS_PRODUCTION && level === "info") {
          Sentry.addBreadcrumb({
            category: this.module,
            message: msg,
            level: "info",
            ...(context ? { data: context } : {}),
          });
        }
    }
  }

  debug(msg: string, context?: LogContext): void {
    this.log("debug", msg, context);
  }

  info(msg: string, context?: LogContext): void {
    this.log("info", msg, context);
  }

  warn(msg: string, context?: LogContext): void {
    this.log("warn", msg, context);
  }

  error(msg: string, context?: LogContext): void {
    this.log("error", msg, context);
  }

  /**
   * Log an error with full Sentry capture.
   * Use this for unexpected errors that should be tracked.
   */
  captureError(error: Error, context?: LogContext): void {
    this.error(error.message, { ...context, stack: error.stack });
    Sentry.captureException(error, {
      tags: { module: this.module },
      ...(context ? { extra: context } : {}),
    });
  }

  /**
   * Create a child logger with a sub-module name.
   * e.g., log.child("agent-1") creates "[swarm:agent-1]"
   */
  child(submodule: string): Logger {
    return new Logger(`${this.module}:${submodule}`);
  }
}

// ============================================================================
// Factory
// ============================================================================

const loggers = new Map<string, Logger>();

/**
 * Get or create a logger for a module.
 */
export function getLogger(module: string): Logger {
  let logger = loggers.get(module);
  if (!logger) {
    logger = new Logger(module);
    loggers.set(module, logger);
  }
  return logger;
}

// Pre-created loggers for common modules
export const log = {
  daemon: getLogger("daemon"),
  swarm: getLogger("swarm"),
  agent: getLogger("agent"),
  session: getLogger("session"),
  emotion: getLogger("emotion"),
  memory: getLogger("memory"),
  recall: getLogger("recall"),
  ambient: getLogger("ambient"),
  mission: getLogger("missions"),
  missions: getLogger("missions"),
  summary: getLogger("summary"),
  context: getLogger("context"),
  graph: getLogger("graph"),
  kg: getLogger("graph"),
  events: getLogger("events"),
};
