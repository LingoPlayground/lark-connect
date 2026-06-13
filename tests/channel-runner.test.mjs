import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createDaemonRuntime } from "../src/daemon/runtime.js";
import { createLarkChannelRunner } from "../src/lark/channel-runner.js";

function createFakeChannel() {
  const handlers = new Map();
  return {
    connected: false,
    disconnected: false,
    unsubscribeCalled: false,
    on(name, handler) {
      handlers.set(name, handler);
      return () => {
        this.unsubscribeCalled = true;
        handlers.delete(name);
      };
    },
    async connect() {
      this.connected = true;
    },
    async disconnect() {
      this.disconnected = true;
    },
    emit(name, payload) {
      handlers.get(name)?.(payload);
    },
  };
}

describe("lark channel runner", () => {
  it("connects a lark channel and forwards mention events into the daemon runtime", async () => {
    const channel = createFakeChannel();
    const runtime = createDaemonRuntime();
    runtime.bindSession({
      chatId: "oc_target",
      agentKind: "codex",
      agentSessionId: "thread_a",
      workspace: "/workspace/app",
    });

    const runner = createLarkChannelRunner(
      { appId: "cli_test", appSecret: "secret", chatId: "oc_target" },
      {
        runtime,
        channelFactory: () => channel,
      },
    );

    await runner.start();
    channel.emit("message", {
      messageId: "om_1",
      chatId: "oc_target",
      content: "Please tighten the title spacing",
      mentionedBot: true,
      rootId: "om_root",
    });

    assert.equal(channel.connected, true);
    assert.deepEqual(
      runtime.pollMessages("thread_a").map((message) => message.larkMessageId),
      ["om_1"],
    );

    await runner.stop();
    assert.equal(channel.unsubscribeCalled, true);
    assert.equal(channel.disconnected, true);
  });

  it("does not require a global chat id for daemon listening", async () => {
    const channel = createFakeChannel();
    const runtime = createDaemonRuntime();
    runtime.bindSession({
      chatId: "oc_bound",
      agentKind: "codex",
      agentSessionId: "thread_a",
      workspace: "/workspace/app",
    });

    const runner = createLarkChannelRunner(
      { appId: "cli_test", appSecret: "secret", chatId: "" },
      {
        runtime,
        channelFactory: () => channel,
      },
    );

    await runner.start();
    channel.emit("message", {
      messageId: "om_bound",
      chatId: "oc_bound",
      content: "Please review this",
      mentionedBot: true,
    });
    channel.emit("message", {
      messageId: "om_unbound",
      chatId: "oc_unbound",
      content: "Ignore this",
      mentionedBot: true,
    });

    assert.deepEqual(
      runtime.pollMessages("thread_a").map((message) => message.larkMessageId),
      ["om_bound"],
    );

    await runner.stop();
  });
});
