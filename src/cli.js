#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  describeConfigStatus,
  describeSavedConfig,
  getConfigFilePath,
  readSavedConfig,
  resolveConfig,
  writeSavedConfig,
  clearSavedConfig,
} from "./config.js";
import { createDaemonHttpClient } from "./daemon/http-client.js";
import { startDaemon } from "./daemon/runner.js";
import { runLiveDoctor } from "./lark/doctor.js";
import { listenOnce } from "./lark/listener.js";
import { runMcpServer } from "./mcp/server.js";

const DEFAULT_BACKGROUND_WAIT_TIMEOUT_MS = 300_000;
const MAX_BACKGROUND_WAIT_TIMEOUT_MS = 2_147_483_647;

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readRequiredOptionValue(args, name) {
  const value = readOption(args, name);
  if (String(value ?? "").trim() === "" || String(value).startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return String(value).trim();
}

function readIntegerOption(args, name, fallback, options = {}) {
  const value = readOption(args, name);
  if (value === undefined) {
    if (hasOption(args, name)) {
      throw new Error(`${name} requires a value`);
    }
    return fallback;
  }
  if (String(value).trim() === "" || String(value).startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }

  const parsed = Number(value);
  const min = options.min ?? 1;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function hasOption(args, name) {
  return args.includes(name);
}

function printHelp(stdout = process.stdout) {
  stdout.write(`curiosea-lark-connect

Usage:
  curiosea-lark-connect setup [--app-id cli_xxx --app-secret <secret>]
  curiosea-lark-connect config show
  curiosea-lark-connect config path
  curiosea-lark-connect config clear
  curiosea-lark-connect doctor [--live] [--app-id cli_xxx] [--chat-id oc_xxx]
  curiosea-lark-connect debug listen-once [--timeout-ms 120000] --chat-id oc_xxx
  curiosea-lark-connect wait --agent-session-id <id> [--timeout-ms 300000] [--daemon-port 51745]
  curiosea-lark-connect daemon start [--daemon-port 51745]
  curiosea-lark-connect daemon status [--daemon-port 51745]
  curiosea-lark-connect daemon stop [--daemon-port 51745]
  curiosea-lark-connect mcp

Wait:
  Requires a running daemon and the same agentSessionId used with lark_connect_bind_session.

Environment:
  FEISHU_APP_ID
  FEISHU_APP_SECRET
  LARK_CONNECT_DAEMON_PORT
  LARK_CONNECT_DAEMON_IDLE_TIMEOUT_MS
  LARK_CONNECT_CONFIG_FILE
`);
}

function printSetupGuidance(stdout = process.stdout) {
  stdout.write(`Open the Feishu developer console to find your app credentials:
https://open.feishu.cn/app

Then save app-level credentials locally:
curiosea-lark-connect setup --app-id cli_xxx --app-secret <secret>

Group chats are not part of app setup. Bind a chat to an agent session with lark_connect_bind_session.
`);
}

function resolveCliConfig(argv, runtime = {}) {
  const env = runtime.env ?? process.env;
  const savedConfig = readSavedConfig({ env });
  return resolveConfig({
    appId: readOption(argv, "--app-id"),
    appSecret: readOption(argv, "--app-secret"),
    chatId: readOption(argv, "--chat-id"),
    daemonPort: readOption(argv, "--daemon-port"),
    daemonIdleTimeoutMs: readOption(argv, "--daemon-idle-timeout-ms"),
  }, env, savedConfig);
}

function createDaemonClient(config, createClient) {
  return createClient({
    host: config.daemonHost,
    port: config.daemonPort,
  });
}

export async function main(argv = process.argv.slice(2), runtime = {}) {
  const command = argv[0];
  const stdout = runtime.stdout ?? process.stdout;
  const exit = runtime.exit ?? process.exit;
  const listenOnceImpl = runtime.listenOnceImpl ?? listenOnce;
  const runLiveDoctorImpl = runtime.runLiveDoctorImpl ?? runLiveDoctor;
  const runMcpServerImpl = runtime.runMcpServerImpl ?? runMcpServer;
  const startDaemonImpl = runtime.startDaemonImpl ?? startDaemon;
  const createDaemonHttpClientImpl =
    runtime.createDaemonHttpClientImpl ?? createDaemonHttpClient;

  if (!command || command === "--help" || command === "-h") {
    printHelp(stdout);
    return;
  }

  if (command === "setup") {
    if (hasOption(argv, "--chat-id")) {
      throw new Error("chatId is bound per agent session. Call lark_connect_bind_session instead.");
    }

    const appId = readOption(argv, "--app-id");
    const appSecret = readOption(argv, "--app-secret");
    if (!appId && !appSecret) {
      printSetupGuidance(stdout);
      return;
    }

    writeSavedConfig(
      {
        appId,
        appSecret,
      },
      { env: runtime.env ?? process.env },
    );
    stdout.write(
      `${JSON.stringify(describeSavedConfig({ env: runtime.env ?? process.env }), null, 2)}\n`,
    );
    return;
  }

  if (command === "config") {
    const subcommand = argv[1] ?? "show";
    const env = runtime.env ?? process.env;

    if (subcommand === "show") {
      stdout.write(`${JSON.stringify(describeSavedConfig({ env }), null, 2)}\n`);
      return;
    }

    if (subcommand === "path") {
      stdout.write(`${getConfigFilePath(env)}\n`);
      return;
    }

    if (subcommand === "clear") {
      clearSavedConfig({ env });
      stdout.write(
        `${JSON.stringify({ configFile: getConfigFilePath(env), cleared: true }, null, 2)}\n`,
      );
      return;
    }

    throw new Error("config requires show, path, or clear");
  }

  if (command === "debug") {
    const subcommand = argv[1];
    if (subcommand !== "listen-once") {
      throw new Error("debug requires listen-once");
    }
    const timeoutMs = Number(readOption(argv, "--timeout-ms") ?? 120_000);
    const config = resolveCliConfig(argv, runtime);
    const message = await listenOnceImpl(config, { timeoutMs });
    stdout.write(`${JSON.stringify(message, null, 2)}\n`);
    exit(0);
    return;
  }

  if (command === "doctor") {
    const config = resolveCliConfig(argv, runtime);
    const result = argv.includes("--live")
      ? await runLiveDoctorImpl(config)
      : describeConfigStatus(config);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "listen") {
    if (!argv.includes("--once")) {
      throw new Error("listen currently requires --once");
    }
    const timeoutMs = Number(readOption(argv, "--timeout-ms") ?? 120_000);
    const config = resolveCliConfig(argv, runtime);
    const message = await listenOnceImpl(config, { timeoutMs });
    stdout.write(`${JSON.stringify(message, null, 2)}\n`);
    exit(0);
    return;
  }

  if (command === "wait") {
    if (!hasOption(argv, "--agent-session-id")) {
      throw new Error("wait requires --agent-session-id");
    }

    const agentSessionId = readRequiredOptionValue(argv, "--agent-session-id");
    const timeoutMs = readIntegerOption(argv, "--timeout-ms", DEFAULT_BACKGROUND_WAIT_TIMEOUT_MS, {
      min: 1,
      max: MAX_BACKGROUND_WAIT_TIMEOUT_MS,
    });
    const config = resolveCliConfig(argv, runtime);
    const client = createDaemonClient(config, createDaemonHttpClientImpl);
    stdout.write(
      `${JSON.stringify(await client.waitForMessages(agentSessionId, { timeoutMs }), null, 2)}\n`,
    );
    exit(0);
    return;
  }

  if (command === "daemon") {
    const subcommand = argv[1];
    const config = resolveCliConfig(argv, runtime);

    if (subcommand === "start") {
      const daemon = await startDaemonImpl(config);
      stdout.write(
        `${JSON.stringify({ state: "started", address: daemon.address }, null, 2)}\n`,
      );
      await daemon.waitUntilClosed?.();
      exit(0);
      return;
    }

    if (subcommand === "status") {
      const client = createDaemonClient(config, createDaemonHttpClientImpl);
      stdout.write(`${JSON.stringify(await client.status(), null, 2)}\n`);
      return;
    }

    if (subcommand === "stop") {
      const client = createDaemonClient(config, createDaemonHttpClientImpl);
      stdout.write(`${JSON.stringify(await client.shutdown(), null, 2)}\n`);
      return;
    }

    throw new Error("daemon requires start, status, or stop");
  }

  if (command === "mcp") {
    await runMcpServerImpl({
      input: runtime.input ?? process.stdin,
      output: stdout,
    });
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

function isCliEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
