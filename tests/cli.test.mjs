import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { main } from "../src/cli.js";

const execFileAsync = promisify(execFile);

async function createConfigFilePath() {
  return join(await mkdtemp(join(tmpdir(), "lark-connect-cli-")), "config.json");
}

function createStdout() {
  let value = "";
  return {
    stdout: {
      write(chunk) {
        value += chunk;
      },
    },
    read() {
      return value;
    },
  };
}

describe("cli setup", () => {
  it("prints setup guidance when called without app credentials", async () => {
    const { stdout } = await execFileAsync("node", ["src/cli.js", "setup"]);

    assert.match(stdout, /https:\/\/open\.feishu\.cn\/app/);
    assert.match(stdout, /--app-id cli_xxx/);
    assert.match(stdout, /--app-secret/);
    assert.doesNotMatch(stdout, /--chat-id/);
  });

  it("runs when invoked through an npm bin symlink", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "lark-connect-bin-"));
    const binDir = join(tempRoot, ".bin");
    const binPath = join(binDir, "curiosea-lark-connect");
    await mkdir(binDir);
    await symlink(join(process.cwd(), "src", "cli.js"), binPath);

    const { stdout } = await execFileAsync(binPath, ["setup"]);

    assert.match(stdout, /https:\/\/open\.feishu\.cn\/app/);
    assert.match(stdout, /--app-id cli_xxx/);
  });

  it("writes app credentials to local config without a chat id", async () => {
    const configFile = await createConfigFilePath();
    const output = createStdout();

    await main(["setup", "--app-id", "cli_test", "--app-secret", "secret"], {
      env: { LARK_CONNECT_CONFIG_FILE: configFile },
      stdout: output.stdout,
    });

    assert.deepEqual(JSON.parse(output.read()), {
      configFile,
      appId: "cli_test",
      appSecretConfigured: true,
    });

    const shown = createStdout();
    await main(["config", "show"], {
      env: { LARK_CONNECT_CONFIG_FILE: configFile },
      stdout: shown.stdout,
    });
    assert.deepEqual(JSON.parse(shown.read()), {
      configFile,
      appId: "cli_test",
      appSecretConfigured: true,
    });
  });

  it("rejects chat id during app setup", async () => {
    const configFile = await createConfigFilePath();

    await assert.rejects(
      () =>
        main(
          [
            "setup",
            "--app-id",
            "cli_test",
            "--app-secret",
            "secret",
            "--chat-id",
            "oc_should_not_persist",
          ],
          {
            env: { LARK_CONNECT_CONFIG_FILE: configFile },
            stdout: createStdout().stdout,
          },
        ),
      /chatId is bound per agent session/,
    );
    assert.equal(existsSync(configFile), false);
  });
});

describe("cli config", () => {
  it("prints the config path and clears saved config", async () => {
    const configFile = await createConfigFilePath();
    await main(["setup", "--app-id", "cli_test", "--app-secret", "secret"], {
      env: { LARK_CONNECT_CONFIG_FILE: configFile },
      stdout: createStdout().stdout,
    });

    const pathOutput = createStdout();
    await main(["config", "path"], {
      env: { LARK_CONNECT_CONFIG_FILE: configFile },
      stdout: pathOutput.stdout,
    });
    assert.equal(pathOutput.read().trim(), configFile);

    const clearOutput = createStdout();
    await main(["config", "clear"], {
      env: { LARK_CONNECT_CONFIG_FILE: configFile },
      stdout: clearOutput.stdout,
    });
    assert.deepEqual(JSON.parse(clearOutput.read()), { configFile, cleared: true });
    assert.equal(existsSync(configFile), false);
  });
});

describe("cli listen", () => {
  it("exits explicitly after printing a debug one-shot mention", async () => {
    let stdout = "";
    let exitCode;
    const configFile = await createConfigFilePath();
    await main(["setup", "--app-id", "cli_test", "--app-secret", "secret"], {
      env: { LARK_CONNECT_CONFIG_FILE: configFile },
      stdout: createStdout().stdout,
    });

    await main(
      [
        "debug",
        "listen-once",
        "--chat-id",
        "oc_test",
      ],
      {
        env: { LARK_CONNECT_CONFIG_FILE: configFile },
        listenOnceImpl: async () => ({
          messageId: "om_1",
          chatId: "oc_test",
          mentionedBot: true,
        }),
        stdout: {
          write(chunk) {
            stdout += chunk;
          },
        },
        exit(code) {
          exitCode = code;
        },
      },
    );

    assert.deepEqual(JSON.parse(stdout), {
      messageId: "om_1",
      chatId: "oc_test",
      mentionedBot: true,
    });
    assert.equal(exitCode, 0);
  });
});

describe("cli doctor", () => {
  it("uses saved app credentials for live checks", async () => {
    const configFile = await createConfigFilePath();
    let observedConfig;
    const output = createStdout();
    await main(["setup", "--app-id", "cli_test", "--app-secret", "secret"], {
      env: { LARK_CONNECT_CONFIG_FILE: configFile },
      stdout: createStdout().stdout,
    });

    await main(["doctor", "--live"], {
      env: { LARK_CONNECT_CONFIG_FILE: configFile },
      runLiveDoctorImpl: async (config) => {
        observedConfig = config;
        return { ok: true };
      },
      stdout: output.stdout,
    });

    assert.equal(observedConfig.appId, "cli_test");
    assert.equal(observedConfig.appSecret, "secret");
    assert.equal(observedConfig.chatId, "");
    assert.deepEqual(JSON.parse(output.read()), { ok: true });
  });
});

describe("cli daemon", () => {
  it("starts the daemon with resolved config and waits until it closes", async () => {
    let stdout = "";
    let waited = false;
    let observedConfig;
    let exitCode;
    const configFile = await createConfigFilePath();
    await main(["setup", "--app-id", "cli_test", "--app-secret", "secret"], {
      env: { LARK_CONNECT_CONFIG_FILE: configFile },
      stdout: createStdout().stdout,
    });

    await main(
      [
        "daemon",
        "start",
        "--daemon-port",
        "6000",
        "--daemon-idle-timeout-ms",
        "5000",
      ],
      {
        env: { LARK_CONNECT_CONFIG_FILE: configFile },
        startDaemonImpl: async (config) => {
          observedConfig = config;
          return {
            address: { host: "127.0.0.2", port: 6000 },
            async waitUntilClosed() {
              waited = true;
            },
          };
        },
        stdout: {
          write(chunk) {
            stdout += chunk;
          },
        },
        exit(code) {
          exitCode = code;
        },
      },
    );

    assert.equal(observedConfig.appId, "cli_test");
    assert.equal(observedConfig.appSecret, "secret");
    assert.equal(observedConfig.chatId, "");
    assert.equal(observedConfig.daemonHost, "127.0.0.1");
    assert.equal(observedConfig.daemonPort, 6000);
    assert.equal(observedConfig.daemonIdleTimeoutMs, 5000);
    assert.deepEqual(JSON.parse(stdout), {
      state: "started",
      address: { host: "127.0.0.2", port: 6000 },
    });
    assert.equal(waited, true);
    assert.equal(exitCode, 0);
  });

  it("prints daemon status through the local client", async () => {
    let stdout = "";
    let observedOptions;

    await main(["daemon", "status", "--daemon-port", "6000"], {
      createDaemonHttpClientImpl: (options) => {
        observedOptions = options;
        return {
          status: async () => ({ bindings: [], sessions: [] }),
        };
      },
      stdout: {
        write(chunk) {
          stdout += chunk;
        },
      },
    });

    assert.equal(observedOptions.host, "127.0.0.1");
    assert.equal(observedOptions.port, 6000);
    assert.deepEqual(JSON.parse(stdout), { bindings: [], sessions: [] });
  });

  it("stops the daemon through the local client", async () => {
    let stdout = "";
    let shutdownCalled = false;

    await main(["daemon", "stop"], {
      createDaemonHttpClientImpl: () => ({
        shutdown: async () => {
          shutdownCalled = true;
          return { state: "stopping" };
        },
      }),
      stdout: {
        write(chunk) {
          stdout += chunk;
        },
      },
    });

    assert.equal(shutdownCalled, true);
    assert.deepEqual(JSON.parse(stdout), { state: "stopping" });
  });
});
