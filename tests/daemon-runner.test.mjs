import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createDaemonHttpClient } from "../src/daemon/http-client.js";
import { startDaemon } from "../src/daemon/runner.js";

function createFakeChannelRunner() {
  return {
    started: false,
    stopped: false,
    async start() {
      this.started = true;
    },
    async stop() {
      this.stopped = true;
    },
  };
}

describe("daemon runner", () => {
  it("starts http and channel runners, then shuts down through the local protocol", async () => {
    const channelRunner = createFakeChannelRunner();
    const daemon = await startDaemon(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
        daemonHost: "127.0.0.1",
        daemonPort: 0,
        daemonIdleTimeoutMs: 3_600_000,
      },
      { channelRunner },
    );

    const client = createDaemonHttpClient(daemon.address);
    try {
      assert.equal(channelRunner.started, true);
      assert.deepEqual(await client.health(), { ok: true });

      assert.deepEqual(await client.shutdown(), { state: "stopping" });
      await daemon.waitUntilClosed();

      assert.equal(channelRunner.stopped, true);
      await assert.rejects(() => client.health(), { code: "DAEMON_NOT_RUNNING" });
    } finally {
      await daemon.close();
    }
  });

  it("auto-closes after the configured idle timeout", async () => {
    const channelRunner = createFakeChannelRunner();
    const daemon = await startDaemon(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
        daemonHost: "127.0.0.1",
        daemonPort: 0,
        daemonIdleTimeoutMs: 5,
      },
      { channelRunner },
    );

    try {
      await daemon.waitUntilClosed();
      assert.equal(channelRunner.stopped, true);
    } finally {
      await daemon.close();
    }
  });

  it("wires an injected reaction client into acknowledgments", async () => {
    const channelRunner = createFakeChannelRunner();
    const observedReactions = [];
    const daemon = await startDaemon(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
        daemonHost: "127.0.0.1",
        daemonPort: 0,
        daemonIdleTimeoutMs: 3_600_000,
      },
      {
        channelRunner,
        reactionClient: {
          async addMessageReaction(messageId, emojiType) {
            observedReactions.push({ messageId, emojiType });
            return { messageId, emojiType, reactionId: "reaction_1" };
          },
        },
      },
    );

    const client = createDaemonHttpClient(daemon.address);
    try {
      daemon.runtime.bindSession({
        chatId: "oc_target",
        agentKind: "codex",
        agentSessionId: "thread_a",
        workspace: "/workspace/app",
      });
      daemon.runtime.receiveLarkMessage({
        messageId: "om_runner",
        chatId: "oc_target",
        mentionedBot: true,
      });
      await client.pollMessages("thread_a");

      await client.ackMessage("om_runner", { agentSessionId: "thread_a" });

      assert.deepEqual(observedReactions, [
        {
          messageId: "om_runner",
          emojiType: "OK",
        },
      ]);
    } finally {
      await daemon.close();
    }
  });

  it("wires an injected message client into text sending", async () => {
    const channelRunner = createFakeChannelRunner();
    const observedMessages = [];
    const daemon = await startDaemon(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
        daemonHost: "127.0.0.1",
        daemonPort: 0,
        daemonIdleTimeoutMs: 3_600_000,
      },
      {
        channelRunner,
        messageClient: {
          async sendTextMessage(input) {
            observedMessages.push(input);
            return { ...input, messageId: "om_sent" };
          },
        },
      },
    );

    const client = createDaemonHttpClient(daemon.address);
    try {
      daemon.runtime.bindSession({
        chatId: "oc_target",
        agentKind: "codex",
        agentSessionId: "thread_a",
        workspace: "/workspace/app",
      });

      await client.sendMessage("thread_a", { text: "处理完成" });

      assert.deepEqual(observedMessages, [
        {
          chatId: "oc_target",
          text: "处理完成",
          mentions: undefined,
          replyToMessageId: undefined,
          replyInThread: undefined,
        },
      ]);
    } finally {
      await daemon.close();
    }
  });

  it("wires an injected chat context client into context reads", async () => {
    const channelRunner = createFakeChannelRunner();
    const observedContextRequests = [];
    const daemon = await startDaemon(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
        daemonHost: "127.0.0.1",
        daemonPort: 0,
        daemonIdleTimeoutMs: 3_600_000,
      },
      {
        channelRunner,
        chatContextClient: {
          async getChatContext(input) {
            observedContextRequests.push(input);
            return {
              chatId: input.chatId,
              limit: input.limit,
              messages: [{ messageId: "om_latest", text: "最近的讨论" }],
              hasMore: false,
              pageToken: "",
            };
          },
        },
      },
    );

    const client = createDaemonHttpClient(daemon.address);
    try {
      daemon.runtime.bindSession({
        chatId: "oc_target",
        agentKind: "codex",
        agentSessionId: "thread_a",
        workspace: "/workspace/app",
      });

      const result = await client.getChatContext("thread_a", { limit: 5 });

      assert.deepEqual(observedContextRequests, [
        {
          chatId: "oc_target",
          limit: 5,
          pageToken: undefined,
        },
      ]);
      assert.deepEqual(result.context.messages, [
        { messageId: "om_latest", text: "最近的讨论" },
      ]);
    } finally {
      await daemon.close();
    }
  });

  it("wires an injected chat client into chat search", async () => {
    const channelRunner = createFakeChannelRunner();
    const observedSearches = [];
    const daemon = await startDaemon(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
        daemonHost: "127.0.0.1",
        daemonPort: 0,
        daemonIdleTimeoutMs: 3_600_000,
      },
      {
        channelRunner,
        chatClient: {
          async searchChats(input) {
            observedSearches.push(input);
            return {
              query: input.query,
              items: [{ chatId: "oc_test", name: "lark-connect 测试群" }],
              hasMore: false,
              pageToken: "",
              nextSteps: [],
            };
          },
        },
      },
    );

    const client = createDaemonHttpClient(daemon.address);
    try {
      const result = await client.searchChats({ query: "测试群", pageSize: 10 });

      assert.deepEqual(observedSearches, [
        {
          query: "测试群",
          pageSize: 10,
          pageToken: undefined,
        },
      ]);
      assert.deepEqual(result.items, [{ chatId: "oc_test", name: "lark-connect 测试群" }]);
    } finally {
      await daemon.close();
    }
  });

  it("wires an injected message client into file sending", async () => {
    const channelRunner = createFakeChannelRunner();
    const observedFiles = [];
    const daemon = await startDaemon(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
        daemonHost: "127.0.0.1",
        daemonPort: 0,
        daemonIdleTimeoutMs: 3_600_000,
      },
      {
        channelRunner,
        messageClient: {
          async sendFileMessage(input) {
            observedFiles.push(input);
            return { ...input, messageId: "om_file" };
          },
        },
      },
    );

    const client = createDaemonHttpClient(daemon.address);
    try {
      daemon.runtime.bindSession({
        chatId: "oc_target",
        agentKind: "codex",
        agentSessionId: "thread_a",
        workspace: "/workspace/app",
      });

      await client.sendFile("thread_a", { filePath: "/tmp/output.txt" });

      assert.deepEqual(observedFiles, [
        {
          chatId: "oc_target",
          filePath: "/tmp/output.txt",
          fileName: undefined,
          replyToMessageId: undefined,
          replyInThread: undefined,
        },
      ]);
    } finally {
      await daemon.close();
    }
  });

  it("wires an injected message client into media sending", async () => {
    const channelRunner = createFakeChannelRunner();
    const observedMedia = [];
    const daemon = await startDaemon(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
        daemonHost: "127.0.0.1",
        daemonPort: 0,
        daemonIdleTimeoutMs: 3_600_000,
      },
      {
        channelRunner,
        messageClient: {
          async sendImageMessage(input) {
            observedMedia.push({ kind: "image", input });
            return { ...input, messageId: "om_image" };
          },
          async sendVideoMessage(input) {
            observedMedia.push({ kind: "video", input });
            return { ...input, coverImageKey: "img_cover", messageId: "om_video" };
          },
        },
      },
    );

    const client = createDaemonHttpClient(daemon.address);
    try {
      daemon.runtime.bindSession({
        chatId: "oc_target",
        agentKind: "codex",
        agentSessionId: "thread_a",
        workspace: "/workspace/app",
      });

      await client.sendImage("thread_a", { imagePath: "/tmp/screen.png" });
      await client.sendVideo("thread_a", {
        videoPath: "/tmp/demo.mp4",
        coverImagePath: "/tmp/demo-cover.png",
      });

      assert.deepEqual(observedMedia, [
        {
          kind: "image",
          input: {
            chatId: "oc_target",
            imagePath: "/tmp/screen.png",
            replyToMessageId: undefined,
            replyInThread: undefined,
          },
        },
        {
          kind: "video",
          input: {
            chatId: "oc_target",
            videoPath: "/tmp/demo.mp4",
            coverImagePath: "/tmp/demo-cover.png",
            replyToMessageId: undefined,
            replyInThread: undefined,
          },
        },
      ]);
    } finally {
      await daemon.close();
    }
  });

  it("wires an injected resource client into resource downloads", async () => {
    const channelRunner = createFakeChannelRunner();
    const observedDownloads = [];
    const daemon = await startDaemon(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
        daemonHost: "127.0.0.1",
        daemonPort: 0,
        daemonIdleTimeoutMs: 3_600_000,
      },
      {
        channelRunner,
        resourceClient: {
          async downloadResource(input) {
            observedDownloads.push(input);
            return {
              agentSessionId: input.agentSessionId,
              messageId: input.messageId,
              fileKey: input.resource.fileKey,
              resourceType: input.resource.type,
              fileName: input.resource.fileName,
              filePath: "/tmp/lark-connect/screen.png",
              size: 12,
            };
          },
        },
      },
    );

    const client = createDaemonHttpClient(daemon.address);
    try {
      daemon.runtime.bindSession({
        chatId: "oc_target",
        agentKind: "codex",
        agentSessionId: "thread_a",
        workspace: "/workspace/app",
      });
      daemon.runtime.receiveLarkMessage({
        messageId: "om_resource",
        chatId: "oc_target",
        mentionedBot: true,
        resources: [
          {
            type: "image",
            fileKey: "img_1",
            fileName: "screen.png",
          },
        ],
      });

      await client.downloadResource("thread_a", {
        messageId: "om_resource",
        fileKey: "img_1",
        outputDir: "/tmp/lark-connect",
      });

      assert.deepEqual(observedDownloads, [
        {
          agentSessionId: "thread_a",
          messageId: "om_resource",
          resource: {
            type: "image",
            fileKey: "img_1",
            fileName: "screen.png",
          },
          outputDir: "/tmp/lark-connect",
        },
      ]);
    } finally {
      await daemon.close();
    }
  });
});
