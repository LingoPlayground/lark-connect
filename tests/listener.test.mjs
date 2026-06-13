import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { listenOnce } from "../src/lark/listener.js";

function createFakeChannel() {
  const handlers = new Map();
  return {
    disconnected: false,
    connected: false,
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
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

describe("listenOnce", () => {
  it("returns a normalized mention message and disconnects", async () => {
    const channel = createFakeChannel();
    const pending = listenOnce(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
      },
      {
        timeoutMs: 1000,
        channelFactory: () => channel,
      },
    );

    await Promise.resolve();
    channel.emit("message", {
      messageId: "om_1",
      chatId: "oc_target",
      chatType: "group",
      senderId: "ou_sender",
      content: "收到",
      rawContentType: "text",
      mentionedBot: true,
      mentions: [{ key: "@_user_1", openId: "ou_bot", name: "bot", isBot: true }],
      resources: [],
      rootId: "om_root",
      threadId: "omt_thread",
      replyToMessageId: "om_parent",
      createTime: 1781331418258,
    });

    const result = await pending;
    assert.equal(result.messageId, "om_1");
    assert.equal(result.chatId, "oc_target");
    assert.equal(result.mentionedBot, true);
    assert.equal(result.rootId, "om_root");
    assert.equal(result.threadId, "omt_thread");
    assert.equal(result.replyToMessageId, "om_parent");
    assert.equal(channel.disconnected, true);
  });

  it("ignores messages from other chats", async () => {
    const channel = createFakeChannel();
    const pending = listenOnce(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
      },
      {
        timeoutMs: 1000,
        channelFactory: () => channel,
      },
    );

    await Promise.resolve();
    channel.emit("message", {
      messageId: "om_ignored",
      chatId: "oc_other",
      chatType: "group",
      senderId: "ou_sender",
      content: "ignored",
      rawContentType: "text",
      mentionedBot: true,
      mentions: [],
      resources: [],
      createTime: 1,
    });
    channel.emit("message", {
      messageId: "om_target",
      chatId: "oc_target",
      chatType: "group",
      senderId: "ou_sender",
      content: "target",
      rawContentType: "text",
      mentionedBot: true,
      mentions: [],
      resources: [],
      createTime: 2,
    });

    const result = await pending;
    assert.equal(result.messageId, "om_target");
  });

  it("ignores messages from the target chat when the bot was not mentioned", async () => {
    const channel = createFakeChannel();
    const pending = listenOnce(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
      },
      {
        timeoutMs: 1000,
        channelFactory: () => channel,
      },
    );

    await Promise.resolve();
    channel.emit("message", {
      messageId: "om_no_mention",
      chatId: "oc_target",
      chatType: "group",
      senderId: "ou_sender",
      content: "普通群消息",
      rawContentType: "text",
      mentionedBot: false,
      mentions: [],
      resources: [],
      createTime: 1,
    });
    channel.emit("message", {
      messageId: "om_target",
      chatId: "oc_target",
      chatType: "group",
      senderId: "ou_sender",
      content: "target",
      rawContentType: "text",
      mentionedBot: true,
      mentions: [],
      resources: [],
      createTime: 2,
    });

    const result = await pending;
    assert.equal(result.messageId, "om_target");
  });

  it("times out and disconnects", async () => {
    const channel = createFakeChannel();
    await assert.rejects(
      () =>
        listenOnce(
          {
            appId: "cli_test",
            appSecret: "secret",
            chatId: "oc_target",
          },
          {
            timeoutMs: 1,
            channelFactory: () => channel,
          },
        ),
      /Timed out waiting for a Lark mention/,
    );
    assert.equal(channel.disconnected, true);
  });
});
