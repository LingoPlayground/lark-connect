#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
const directory = join(stateHome, "lark-connect");
const file = join(directory, "connections.json");
const lock = join(directory, "connections.lock");

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
  const allowed = new Set(action === "status" ? ["--session-id", "--chat-id"] : required);
  if (Object.keys(options).some((key) => key !== "replace" && !allowed.has(key))) {
    throw new SessionError("INVALID_INPUT", `Unexpected argument for ${action}`);
  }
  if (action === "status" && options["--session-id"] && options["--chat-id"]) {
    throw new SessionError("INVALID_INPUT", "Choose one status filter");
  }
  if (action === "start" && (!["bot", "user"].includes(options["--as"]) || !["codex", "claude-code"].includes(options["--runtime"]))) {
    throw new SessionError("INVALID_INPUT", "Identity must be bot or user; runtime must be codex or claude-code");
  }
  return { action, options };
}

function readRegistry() {
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    if (state.schemaVersion !== 2 || !Array.isArray(state.connections)) {
      throw new Error("Invalid registry state");
    }
    const chats = new Set();
    const sessions = new Set();
    for (const connection of state.connections) {
      if (connection.status !== "active" || !connection.profile || !["bot", "user"].includes(connection.as)
        || !connection.chatId || !["codex", "claude-code"].includes(connection.runtime)
        || !connection.sessionId || !connection.generation || !Number.isFinite(Date.parse(connection.scanThrough))
        || chats.has(connection.chatId) || sessions.has(connection.sessionId)) {
        throw new Error("Invalid connection state");
      }
      chats.add(connection.chatId);
      sessions.add(connection.sessionId);
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return { schemaVersion: 2, connections: [] };
    throw new SessionError("STATE_CORRUPT", "The connection checkpoint cannot be read safely");
  }
}

function writeRegistry(registry) {
  const temporary = join(directory, `connection.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(registry)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function currentConnection(registry, options) {
  const connection = registry.connections.find((item) => item.sessionId === options["--session-id"]);
  if (!connection || connection.generation !== options["--generation"]) {
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
    const registry = readRegistry();
    if (action === "start") {
      const chatOwner = registry.connections.find((item) => item.chatId === options["--chat-id"]);
      const sessionOwner = registry.connections.find((item) => item.sessionId === options["--session-id"]);
      if (chatOwner && sessionOwner && chatOwner !== sessionOwner) {
        throw new SessionError("MULTIPLE_CONFLICTS", "The chat and session belong to different connections; stop them separately");
      }
      if ((chatOwner || sessionOwner) && !options.replace) {
        const owner = chatOwner || sessionOwner;
        const code = chatOwner ? "CHAT_ALREADY_BOUND" : "SESSION_ALREADY_BOUND";
        throw new SessionError(code, `Chat ${owner.chatId} is already bound to ${owner.runtime} session ${owner.sessionId}`);
      }
      if (chatOwner || sessionOwner) registry.connections.splice(registry.connections.indexOf(chatOwner || sessionOwner), 1);
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
      registry.connections.push(connection);
      writeRegistry(registry);
      return { ok: true, connection };
    }
    const connection = currentConnection(registry, options);
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
      writeRegistry(registry);
      return { ok: true, scanThrough: through };
    }
    registry.connections.splice(registry.connections.indexOf(connection), 1);
    writeRegistry(registry);
    return { ok: true, status: "stopped" };
  } finally {
    rmdirSync(lock);
  }
}

try {
  const { action, options } = parseArguments(process.argv.slice(2));
  const registry = action === "status" ? readRegistry() : null;
  const result = action === "status"
    ? (options["--session-id"] || options["--chat-id"]
      ? (() => {
        const connection = registry.connections.find((item) => item.sessionId === options["--session-id"] || item.chatId === options["--chat-id"]);
        return connection ? { ok: true, connection } : { ok: true, status: "stopped" };
      })()
      : { ok: true, connections: registry.connections })
    : mutate(action, options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: error.code || "SESSION_ERROR", message: error.message })}\n`);
  process.exitCode = 1;
}
