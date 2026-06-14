import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  createJsonlLogger,
  getDaemonLogFilePath,
  getSessionLogFilePath,
  readJsonlLog,
} from "../src/daemon/logger.js";

describe("daemon logger", () => {
  it("writes structured JSONL entries and reads a tail", async () => {
    const logFile = join(await mkdtemp(join(tmpdir(), "lark-connect-logger-")), "daemon.jsonl");
    const logger = createJsonlLogger({
      filePath: logFile,
      now: () => 123_456,
      pid: 42,
    });

    await logger.write("binding_created", {
      agentSessionId: "thread_a",
    });
    await logger.write("wait_timeout", {
      agentSessionId: "thread_a",
      deliverySource: "mcp_wait",
    });

    const fileEntries = (await readFile(logFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    assert.deepEqual(fileEntries, [
      {
        timestamp: 123_456,
        pid: 42,
        event: "binding_created",
        agentSessionId: "thread_a",
      },
      {
        timestamp: 123_456,
        pid: 42,
        event: "wait_timeout",
        agentSessionId: "thread_a",
        deliverySource: "mcp_wait",
      },
    ]);
    assert.deepEqual(await readJsonlLog({ filePath: logFile, tail: 1 }), [fileEntries[1]]);
  });

  it("uses an application state path for the default daemon log", () => {
    assert.match(
      getDaemonLogFilePath(),
      /curiosea-lark-connect\/daemon\.jsonl$/,
    );
  });

  it("routes session events to a per-session log file", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "lark-connect-session-logs-"));
    const logger = createJsonlLogger({
      logDir,
      now: () => 123_456,
      pid: 42,
    });

    await logger.write("daemon_started", { port: 51745 });
    await logger.write("wait_timeout", {
      agentSessionId: "thread/a:b",
      deliverySource: "mcp_wait",
    });

    assert.deepEqual(
      await readJsonlLog({ filePath: getDaemonLogFilePath({ logDir }) }),
      [
        {
          timestamp: 123_456,
          pid: 42,
          event: "daemon_started",
          port: 51745,
        },
      ],
    );
    assert.deepEqual(
      await readJsonlLog({
        filePath: getSessionLogFilePath("thread/a:b", { logDir }),
      }),
      [
        {
          timestamp: 123_456,
          pid: 42,
          event: "wait_timeout",
          agentSessionId: "thread/a:b",
          deliverySource: "mcp_wait",
        },
      ],
    );
    assert.match(
      getSessionLogFilePath("thread/a:b", { logDir }),
      /thread_a_b-[a-f0-9]{12}\.jsonl$/,
    );
    assert.notEqual(
      getSessionLogFilePath("thread/a:b", { logDir }),
      getSessionLogFilePath("thread_a_b", { logDir }),
    );
  });

  it("keeps long session log file names bounded", () => {
    const longSessionId = "thread_".repeat(100);
    assert.ok(basename(getSessionLogFilePath(longSessionId)).length < 140);
  });

  it("reports the file and line number for invalid JSONL entries", async () => {
    const logFile = join(await mkdtemp(join(tmpdir(), "lark-connect-bad-log-")), "daemon.jsonl");
    await writeFile(
      logFile,
      [
        JSON.stringify({ event: "valid" }),
        "{",
        "",
      ].join("\n"),
    );

    assert.throws(
      () => readJsonlLog({ filePath: logFile }),
      new RegExp(`${logFile}.*line 2`),
    );
  });

  it("returns an empty list when the requested log file does not exist", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "lark-connect-missing-log-"));

    assert.deepEqual(readJsonlLog({ logDir }), []);
    assert.deepEqual(readJsonlLog({ logDir, agentSessionId: "thread_missing" }), []);
  });
});
