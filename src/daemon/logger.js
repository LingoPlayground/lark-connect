import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_LOG_TAIL = 100;
const MAX_SESSION_LOG_PREFIX_LENGTH = 96;

export function getDaemonLogDir() {
  return join(homedir(), ".local", "state", "curiosea-lark-connect");
}

function resolveLogDir(options = {}) {
  return options.logDir ?? getDaemonLogDir();
}

function sanitizeLogFileName(value) {
  const prefix = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
  return prefix.slice(0, MAX_SESSION_LOG_PREFIX_LENGTH);
}

function shortStableHash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 12);
}

export function getDaemonLogFilePath(options = {}) {
  return join(resolveLogDir(options), "daemon.jsonl");
}

export function getSessionLogFilePath(agentSessionId, options = {}) {
  return join(
    resolveLogDir(options),
    "sessions",
    `${sanitizeLogFileName(agentSessionId)}-${shortStableHash(agentSessionId)}.jsonl`,
  );
}

export function createNoopLogger() {
  return {
    write() {},
  };
}

export function createJsonlLogger(options = {}) {
  const explicitFilePath = options.filePath;
  const logDir = options.logDir;
  const now = options.now ?? (() => Date.now());
  const pid = options.pid ?? process.pid;

  function resolveFilePath(details = {}) {
    if (explicitFilePath) return explicitFilePath;
    if (details.agentSessionId) return getSessionLogFilePath(details.agentSessionId, { logDir });
    return getDaemonLogFilePath({ logDir });
  }

  return {
    write(event, details = {}) {
      const filePath = resolveFilePath(details);
      mkdirSync(dirname(filePath), { recursive: true });
      appendFileSync(
        filePath,
        `${JSON.stringify({
          timestamp: now(),
          pid,
          event,
          ...details,
        })}\n`,
        { mode: 0o600 },
      );
    },
  };
}

function normalizeTail(value) {
  const tail = Number(value ?? DEFAULT_LOG_TAIL);
  if (!Number.isInteger(tail) || tail < 1) {
    throw new Error("--tail must be a positive integer");
  }
  return tail;
}

export function readJsonlLog(options = {}) {
  const filePath =
    options.filePath ??
    (options.agentSessionId
      ? getSessionLogFilePath(options.agentSessionId, { logDir: options.logDir })
      : getDaemonLogFilePath({ logDir: options.logDir }));
  const tail = normalizeTail(options.tail);
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  return text
    .split("\n")
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter((entry) => entry.line.trim())
    .slice(-tail)
    .map((entry) => {
      try {
        return JSON.parse(entry.line);
      } catch (cause) {
        throw new Error(
          `daemon log ${filePath} contains invalid JSON on line ${entry.lineNumber}`,
          { cause },
        );
      }
    });
}
