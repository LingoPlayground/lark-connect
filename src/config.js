import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const FEISHU_APP_URL_RE = /https:\/\/open\.feishu\.cn\/app\/([^/\s]+)\/baseinfo/;

export const DEFAULT_DAEMON_HOST = "127.0.0.1";
export const DEFAULT_DAEMON_PORT = 51745;
export const DEFAULT_DAEMON_IDLE_TIMEOUT_MS = 3_600_000;
export const CONFIG_FILE_ENV = "LARK_CONNECT_CONFIG_FILE";

function parseIntegerOption(value, fallback, name, options = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  const min = options.min ?? 1;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function normalizeAppId(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const match = FEISHU_APP_URL_RE.exec(raw);
  return match ? match[1] : raw;
}

export function buildFeishuAppBaseInfoUrl(appIdOrUrl) {
  const appId = normalizeAppId(appIdOrUrl);
  if (!appId) {
    throw new Error("app id is required");
  }
  return `https://open.feishu.cn/app/${appId}/baseinfo`;
}

export function getConfigFilePath(env = process.env) {
  const explicit = String(env[CONFIG_FILE_ENV] ?? "").trim();
  if (explicit) return explicit;
  return join(homedir(), ".config", "curiosea-lark-connect", "config.json");
}

function normalizeSavedConfig(input = {}) {
  const appId = normalizeAppId(input.appId ?? "");
  const appSecret = String(input.appSecret ?? "").trim();
  const config = {};
  if (appId) config.appId = appId;
  if (appSecret) config.appSecret = appSecret;
  return config;
}

export function readSavedConfig(options = {}) {
  const configFile = options.configFile ?? getConfigFilePath(options.env ?? process.env);
  let text;
  try {
    text = readFileSync(configFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }

  return normalizeSavedConfig(JSON.parse(text));
}

export function writeSavedConfig(input, options = {}) {
  const saved = normalizeSavedConfig(input);
  if (!saved.appId) throw new Error("appId is required");
  if (!saved.appSecret) throw new Error("appSecret is required");

  const configFile = options.configFile ?? getConfigFilePath(options.env ?? process.env);
  mkdirSync(dirname(configFile), { recursive: true });
  writeFileSync(configFile, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  chmodSync(configFile, 0o600);
  return saved;
}

export function clearSavedConfig(options = {}) {
  const configFile = options.configFile ?? getConfigFilePath(options.env ?? process.env);
  rmSync(configFile, { force: true });
}

export function describeSavedConfig(options = {}) {
  const env = options.env ?? process.env;
  const configFile = options.configFile ?? getConfigFilePath(env);
  const saved = readSavedConfig({ configFile });
  return {
    configFile,
    appId: saved.appId ?? null,
    appSecretConfigured: Boolean(saved.appSecret),
  };
}

export function resolveConfig(explicit = {}, env = process.env, savedConfig = {}) {
  const appId = normalizeAppId(
    explicit.appId ?? explicit.appUrl ?? env.FEISHU_APP_ID ?? savedConfig.appId ?? "",
  );
  const appSecret = String(
    explicit.appSecret ?? env.FEISHU_APP_SECRET ?? savedConfig.appSecret ?? "",
  ).trim();
  const chatId = String(explicit.chatId ?? env.FEISHU_CHAT_ID ?? "").trim();
  const daemonHost = String(
    explicit.daemonHost ?? env.LARK_CONNECT_DAEMON_HOST ?? DEFAULT_DAEMON_HOST,
  ).trim();
  const daemonPort = parseIntegerOption(
    explicit.daemonPort ?? env.LARK_CONNECT_DAEMON_PORT,
    DEFAULT_DAEMON_PORT,
    "daemon port",
    { min: 0, max: 65_535 },
  );
  const daemonIdleTimeoutMs = parseIntegerOption(
    explicit.daemonIdleTimeoutMs ?? env.LARK_CONNECT_DAEMON_IDLE_TIMEOUT_MS,
    DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
    "daemon idle timeout",
  );

  return {
    appId,
    appSecret,
    chatId,
    appBaseInfoUrl: appId ? buildFeishuAppBaseInfoUrl(appId) : "",
    daemonHost,
    daemonPort,
    daemonIdleTimeoutMs,
  };
}

export function describeConfigStatus(config) {
  return {
    appId: config.appId || null,
    chatId: config.chatId || null,
    appBaseInfoUrl: config.appBaseInfoUrl || null,
    checks: {
      appId: Boolean(config.appId),
      appSecret: Boolean(config.appSecret),
      chatId: Boolean(config.chatId),
    },
  };
}
