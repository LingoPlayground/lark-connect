import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_LOG_TAIL = 100;

export function getDaemonLogFilePath() {
  return join(homedir(), ".local", "state", "curiosea-lark-connect", "daemon.jsonl");
}

export function createNoopLogger() {
  return {
    write() {},
  };
}

export function createJsonlLogger(options = {}) {
  const filePath = options.filePath ?? getDaemonLogFilePath();
  const now = options.now ?? (() => Date.now());
  const pid = options.pid ?? process.pid;

  return {
    filePath,
    write(event, details = {}) {
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
  const filePath = options.filePath ?? getDaemonLogFilePath();
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
    .filter((line) => line.trim())
    .slice(-tail)
    .map((line) => JSON.parse(line));
}
