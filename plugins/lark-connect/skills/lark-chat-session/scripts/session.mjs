#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
const directory = join(stateHome, "lark-connect");
const file = join(directory, "connection.json");
const lock = join(directory, "connection.lock");

class SessionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parseArguments(args) {
  const [action, ...rest] = args;
  if (!["start", "status", "checkpoint", "stop"].includes(action)) {
    throw new SessionError("INVALID_INPUT", "Expected start, status, checkpoint, or stop");
  }
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--replace" && action === "start") {
      options.replace = true;
      continue;
    }
    if (!["--profile", "--as", "--chat-id", "--runtime", "--session-id", "--generation", "--through"].includes(flag) || !rest[index + 1] || rest[index + 1].startsWith("--")) {
      throw new SessionError("INVALID_INPUT", `Invalid argument: ${flag}`);
    }
    if (options[flag] !== undefined) {
      throw new SessionError("INVALID_INPUT", `Repeated argument: ${flag}`);
    }
    options[flag] = rest[++index];
  }
  const required = {
    start: ["--profile", "--as", "--chat-id", "--runtime", "--session-id"],
    status: [],
    checkpoint: ["--session-id", "--generation", "--through"],
    stop: ["--session-id", "--generation"],
  }[action];
  if (required.some((key) => !options[key])) {
    throw new SessionError("INVALID_INPUT", `Missing required arguments for ${action}`);
  }
  const allowed = new Set(required);
  if (Object.keys(options).some((key) => key !== "replace" && !allowed.has(key))) {
    throw new SessionError("INVALID_INPUT", `Unexpected argument for ${action}`);
  }
  if (action === "start" && (!["bot", "user"].includes(options["--as"]) || !["codex", "claude-code"].includes(options["--runtime"]))) {
    throw new SessionError("INVALID_INPUT", "Identity must be bot or user; runtime must be codex or claude-code");
  }
  return { action, options };
}

function readConnection() {
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    if (state.status === "stopped") return null;
    if (state.status !== "active" || !state.generation || !state.sessionId || !state.scanThrough) {
      throw new Error("Invalid connection state");
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new SessionError("STATE_CORRUPT", "The connection checkpoint cannot be read safely");
  }
}

function writeConnection(connection) {
  const temporary = join(directory, `connection.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(connection)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function currentConnection(options) {
  const connection = readConnection();
  if (!connection || connection.sessionId !== options["--session-id"] || connection.generation !== options["--generation"]) {
    throw new SessionError("STALE_SESSION", "This operation does not belong to the active connection");
  }
  return connection;
}

function mutate(action, options) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!lstatSync(directory).isDirectory()) {
    throw new SessionError("STATE_ERROR", "Connection state directory must be a real directory");
  }
  chmodSync(directory, 0o700);
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (Date.now() - statSync(lock).mtimeMs <= 60_000) {
      throw new SessionError("BUSY", "Connection checkpoint is locked by another operation");
    }
    rmdirSync(lock);
    mkdirSync(lock, { mode: 0o700 });
  }
  try {
    if (action === "start") {
      if (readConnection() && !options.replace) {
        throw new SessionError("ALREADY_BOUND", "Stop or explicitly replace the current connection first");
      }
      const connection = {
        status: "active",
        profile: options["--profile"],
        as: options["--as"],
        chatId: options["--chat-id"],
        runtime: options["--runtime"],
        sessionId: options["--session-id"],
        generation: randomUUID(),
        scanThrough: new Date().toISOString(),
      };
      writeConnection(connection);
      return { ok: true, connection };
    }
    const connection = currentConnection(options);
    if (action === "checkpoint") {
      const through = options["--through"];
      const timestamp = Date.parse(through);
      if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== through || timestamp > Date.now()) {
        throw new SessionError("INVALID_INPUT", "Checkpoint must be a current or past ISO 8601 UTC time");
      }
      if (timestamp < Date.parse(connection.scanThrough)) {
        throw new SessionError("CHECKPOINT_REGRESSION", "Checkpoint cannot move backwards");
      }
      connection.scanThrough = through;
      writeConnection(connection);
      return { ok: true, scanThrough: through };
    }
    writeConnection({ status: "stopped" });
    return { ok: true, status: "stopped" };
  } finally {
    rmdirSync(lock);
  }
}

try {
  const { action, options } = parseArguments(process.argv.slice(2));
  const connection = action === "status" ? readConnection() : null;
  const result = action === "status"
    ? (connection ? { ok: true, connection } : { ok: true, status: "stopped" })
    : mutate(action, options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: error.code || "SESSION_ERROR", message: error.message })}\n`);
  process.exitCode = 1;
}
