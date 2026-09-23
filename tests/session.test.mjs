import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("../plugins/lark-connect/skills/lark-chat-session/scripts/session.mjs", import.meta.url);

function withState(run) {
  const stateHome = mkdtempSync(join(tmpdir(), "lark-connect-session-"));
  const call = (...args) => {
    const result = spawnSync(process.execPath, [script.pathname, ...args], {
      env: { ...process.env, XDG_STATE_HOME: stateHome },
      encoding: "utf8",
    });
    assert.ok(result.stdout, result.stderr);
    return { exitCode: result.status, body: JSON.parse(result.stdout) };
  };
  try {
    run(call, stateHome);
  } finally {
    rmSync(stateHome, { recursive: true, force: true });
  }
}

const startArgs = [
  "start", "--profile", "work", "--as", "user", "--chat-id", "oc_chat",
  "--runtime", "codex", "--session-id", "thread-1",
];

describe("plugin session checkpoint", () => {
  it("starts a binding and writes only private checkpoint data", () => {
    withState((call, stateHome) => {
      assert.deepEqual(call("status"), { exitCode: 0, body: { ok: true, connections: [] } });
      mkdirSync(join(stateHome, "lark-connect"), { mode: 0o755 });
      const started = call(...startArgs);
      assert.equal(started.exitCode, 0);
      assert.equal(started.body.connection.profile, "work");
      assert.equal(started.body.connection.as, "user");
      assert.equal(started.body.connection.chatId, "oc_chat");
      assert.equal(started.body.connection.sessionId, "thread-1");
      assert.ok(started.body.connection.generation);
      assert.ok(Date.parse(started.body.connection.scanThrough));
      assert.deepEqual(call("status", "--session-id", "thread-1").body, started.body);
      assert.deepEqual(call("status").body.connections, [started.body.connection]);

      const directory = join(stateHome, "lark-connect");
      const file = join(directory, "connections.json");
      assert.equal(statSync(directory).mode & 0o777, 0o700);
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(readFileSync(file, "utf8").includes("secret"), false);
    });
  });

  it("keeps different chats independent and rejects a second owner of one chat or session", () => {
    withState((call) => {
      const first = call(...startArgs).body.connection;
      const secondArgs = ["start", "--profile", "work", "--as", "bot", "--chat-id", "oc_other", "--runtime", "codex", "--session-id", "thread-2"];
      const second = call(...secondArgs).body.connection;
      assert.equal(second.chatId, "oc_other");
      assert.equal(call("status").body.connections.length, 2);
      assert.equal(call("status", "--chat-id", "oc_other").body.connection.sessionId, "thread-2");
      assert.equal(call(...secondArgs.slice(0, -1), "thread-3").body.code, "CHAT_ALREADY_BOUND");
      assert.equal(call("start", "--profile", "work", "--as", "bot", "--chat-id", "oc_third", "--runtime", "codex", "--session-id", "thread-1").body.code, "SESSION_ALREADY_BOUND");
      assert.equal(call("start", "--profile", "work", "--as", "bot", "--chat-id", "oc_other", "--runtime", "codex", "--session-id", "thread-1", "--replace").body.code, "MULTIPLE_CONFLICTS");
      assert.equal(call("status", "--session-id", "thread-1").body.connection.generation, first.generation);

      const later = new Date().toISOString();
      assert.equal(call("checkpoint", "--session-id", first.sessionId, "--generation", first.generation, "--through", later).body.scanThrough, later);
      assert.equal(call("status", "--session-id", "thread-2").body.connection.scanThrough, second.scanThrough);
      assert.equal(call("stop", "--session-id", first.sessionId, "--generation", first.generation).body.status, "stopped");
      assert.equal(call("status", "--session-id", "thread-1").body.status, "stopped");
      assert.equal(call("status", "--session-id", "thread-2").body.connection.generation, second.generation);
    });
  });

  it("requires explicit replacement and rejects stale session operations", () => {
    withState((call) => {
      const first = call(...startArgs).body.connection;
      assert.equal(call(...startArgs).body.code, "CHAT_ALREADY_BOUND");
      const second = call(...startArgs, "--replace").body.connection;
      assert.notEqual(second.generation, first.generation);
      assert.equal(call("checkpoint", "--session-id", first.sessionId, "--generation", first.generation, "--through", new Date().toISOString()).body.code, "STALE_SESSION");
      assert.equal(call("stop", "--session-id", first.sessionId, "--generation", first.generation).body.code, "STALE_SESSION");
      assert.equal(call("status", "--session-id", first.sessionId).body.connection.generation, second.generation);
    });
  });

  it("advances only valid scan positions and stops the current binding", () => {
    withState((call) => {
      const connection = call(...startArgs).body.connection;
      const args = ["--session-id", connection.sessionId, "--generation", connection.generation];
      const later = new Date().toISOString();
      assert.equal(call("checkpoint", ...args, "--through", later).body.scanThrough, later);
      const earlier = new Date(Date.parse(connection.scanThrough) - 1).toISOString();
      assert.equal(call("checkpoint", ...args, "--through", earlier).body.code, "CHECKPOINT_REGRESSION");
      assert.equal(call("checkpoint", ...args, "--through", "invalid").body.code, "INVALID_INPUT");
      assert.equal(call("stop", ...args).body.status, "stopped");
      assert.deepEqual(call("status").body, { ok: true, connections: [] });
    });
  });

  it("recovers a stale lock left by an interrupted process", () => {
    withState((call, stateHome) => {
      const connection = call(...startArgs).body.connection;
      const lock = join(stateHome, "lark-connect", "connections.lock");
      mkdirSync(lock);
      const old = new Date(Date.now() - 120_000);
      utimesSync(lock, old, old);
      assert.equal(
        call("stop", "--session-id", connection.sessionId, "--generation", connection.generation).body.status,
        "stopped",
      );
    });
  });
});
