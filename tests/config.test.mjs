import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildFeishuAppBaseInfoUrl,
  clearSavedConfig,
  getConfigFilePath,
  normalizeAppId,
  readSavedConfig,
  resolveConfig,
  writeSavedConfig,
} from "../src/config.js";

describe("buildFeishuAppBaseInfoUrl", () => {
  it("builds the Feishu app base info URL from an app id", () => {
    assert.equal(
      buildFeishuAppBaseInfoUrl("cli_test_app"),
      "https://open.feishu.cn/app/cli_test_app/baseinfo",
    );
  });
});

describe("normalizeAppId", () => {
  it("extracts app id from a Feishu app backend URL", () => {
    assert.equal(
      normalizeAppId("https://open.feishu.cn/app/cli_test_app/baseinfo"),
      "cli_test_app",
    );
  });

  it("trims plain app ids", () => {
    assert.equal(normalizeAppId("  cli_test_app  "), "cli_test_app");
  });
});

describe("resolveConfig", () => {
  it("prefers explicit values over environment values", () => {
    const config = resolveConfig(
      { appId: "cli_explicit", appSecret: "explicit-secret", chatId: "oc_explicit" },
      {
        FEISHU_APP_ID: "cli_env",
        FEISHU_APP_SECRET: "env-secret",
        FEISHU_CHAT_ID: "oc_env",
      },
    );

    assert.deepEqual(config, {
      appId: "cli_explicit",
      appSecret: "explicit-secret",
      chatId: "oc_explicit",
      appBaseInfoUrl: "https://open.feishu.cn/app/cli_explicit/baseinfo",
      daemonHost: "127.0.0.1",
      daemonPort: 51745,
      daemonIdleTimeoutMs: 3_600_000,
    });
  });

  it("uses environment values when explicit values are absent", () => {
    const config = resolveConfig(
      {},
      {
        FEISHU_APP_ID: "cli_env",
        FEISHU_APP_SECRET: "env-secret",
        FEISHU_CHAT_ID: "oc_env",
      },
    );

    assert.equal(config.appId, "cli_env");
    assert.equal(config.appSecret, "env-secret");
    assert.equal(config.chatId, "oc_env");
  });

  it("uses saved app credentials below environment values and explicit values", () => {
    const saved = {
      appId: "cli_saved",
      appSecret: "saved-secret",
    };

    const fromSaved = resolveConfig({}, {}, saved);
    assert.equal(fromSaved.appId, "cli_saved");
    assert.equal(fromSaved.appSecret, "saved-secret");
    assert.equal(fromSaved.chatId, "");

    const fromEnv = resolveConfig(
      {},
      {
        FEISHU_APP_ID: "cli_env",
        FEISHU_APP_SECRET: "env-secret",
      },
      saved,
    );
    assert.equal(fromEnv.appId, "cli_env");
    assert.equal(fromEnv.appSecret, "env-secret");

    const fromExplicit = resolveConfig(
      { appId: "cli_explicit", appSecret: "explicit-secret" },
      {
        FEISHU_APP_ID: "cli_env",
        FEISHU_APP_SECRET: "env-secret",
      },
      saved,
    );
    assert.equal(fromExplicit.appId, "cli_explicit");
    assert.equal(fromExplicit.appSecret, "explicit-secret");
  });

  it("resolves daemon settings from explicit values and environment values", () => {
    const explicit = resolveConfig({
      daemonHost: "127.0.0.2",
      daemonPort: "6000",
      daemonIdleTimeoutMs: "5000",
    });
    assert.equal(explicit.daemonHost, "127.0.0.2");
    assert.equal(explicit.daemonPort, 6000);
    assert.equal(explicit.daemonIdleTimeoutMs, 5000);

    const fromEnv = resolveConfig(
      {},
      {
        LARK_CONNECT_DAEMON_HOST: "127.0.0.3",
        LARK_CONNECT_DAEMON_PORT: "7000",
        LARK_CONNECT_DAEMON_IDLE_TIMEOUT_MS: "9000",
      },
    );
    assert.equal(fromEnv.daemonHost, "127.0.0.3");
    assert.equal(fromEnv.daemonPort, 7000);
    assert.equal(fromEnv.daemonIdleTimeoutMs, 9000);
  });
});

describe("saved config", () => {
  it("stores app credentials without a chat id and uses private file permissions", () => {
    const configFile = join(mkdtempSync(join(tmpdir(), "lark-connect-config-")), "config.json");

    const saved = writeSavedConfig(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_should_not_persist",
      },
      { configFile },
    );

    assert.deepEqual(saved, {
      appId: "cli_test",
      appSecret: "secret",
    });
    assert.deepEqual(readSavedConfig({ configFile }), saved);
    assert.deepEqual(JSON.parse(readFileSync(configFile, "utf8")), saved);
    assert.equal(statSync(configFile).mode & 0o777, 0o600);
  });

  it("resolves the config file path and clears saved config", () => {
    const configFile = join(mkdtempSync(join(tmpdir(), "lark-connect-config-")), "config.json");
    assert.equal(getConfigFilePath({ LARK_CONNECT_CONFIG_FILE: configFile }), configFile);

    writeSavedConfig({ appId: "cli_test", appSecret: "secret" }, { configFile });
    assert.equal(existsSync(configFile), true);

    clearSavedConfig({ configFile });
    assert.equal(existsSync(configFile), false);
    assert.deepEqual(readSavedConfig({ configFile }), {});
  });
});
