import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { DAEMON_ERROR_CODES } from "../src/daemon/errors.js";
import { createDaemonHttpClient } from "../src/daemon/http-client.js";
import { createDaemonHttpServer } from "../src/daemon/http-server.js";
import { createDaemonRuntime } from "../src/daemon/runtime.js";

async function createUnusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function createTestServer(options = {}) {
  const runtime = createDaemonRuntime({
    idleTimeoutMs: 3_600_000,
    now: () => Date.now(),
  });
  const daemon = createDaemonHttpServer({
    runtime,
    host: "127.0.0.1",
    port: 0,
    ...options,
  });
  const address = await daemon.listen();
  const client = createDaemonHttpClient(address);

  return {
    runtime,
    client,
    address,
    async close() {
      await daemon.close();
    },
  };
}

function binding(overrides = {}) {
  return {
    chatId: "oc_target",
    agentKind: "codex",
    agentSessionId: "thread_a",
    workspace: "/workspace/app",
    ...overrides,
  };
}

function larkMessage(overrides = {}) {
  return {
    messageId: "om_1",
    chatId: "oc_target",
    content: "Please tighten the title spacing",
    mentionedBot: true,
    resources: [],
    ...overrides,
  };
}

describe("daemon http client", () => {
  it("maps connection failures to DAEMON_NOT_RUNNING with a start command", async () => {
    const port = await createUnusedPort();
    const client = createDaemonHttpClient({ host: "127.0.0.1", port });

    // VAL-DAEM-001 and VAL-DAEM-002: client calls do not auto-start the daemon.
    await assert.rejects(
      () => client.status(),
      (error) =>
        error?.code === "DAEMON_NOT_RUNNING" &&
        error?.command === "npx -y curiosea-lark-connect@latest daemon start",
    );
  });
});

describe("daemon http server", () => {
  it("searches chats through the local protocol without a bound session", async () => {
    const observedSearches = [];
    const server = await createTestServer({
      chatClient: {
        async searchChats(input) {
          observedSearches.push(input);
          return {
            query: input.query,
            items: [
              {
                chatId: "oc_test",
                name: "lark-connect 测试群",
                chatMode: "group",
                memberCount: 3,
              },
            ],
            hasMore: false,
            pageToken: "",
            nextSteps: [],
          };
        },
      },
    });
    try {
      const result = await server.client.searchChats({
        query: "测试群",
        pageSize: 10,
      });

      assert.deepEqual(observedSearches, [
        {
          query: "测试群",
          pageSize: 10,
          pageToken: undefined,
        },
      ]);
      assert.deepEqual(result.items.map((item) => item.chatId), ["oc_test"]);
    } finally {
      await server.close();
    }
  });

  it("returns empty search guidance through the local protocol", async () => {
    const server = await createTestServer({
      chatClient: {
        async searchChats(input) {
          return {
            query: input.query,
            items: [],
            hasMore: false,
            pageToken: "",
            nextSteps: [
              "没有找到名称匹配“测试群”且机器人可见的群聊。",
              "请用户确认群名是否正确；如果目标群还不存在，请先创建群。",
              "如果群已经存在，请把当前飞书应用的机器人拉入群后再搜索。",
            ],
          };
        },
      },
    });
    try {
      const result = await server.client.searchChats({ query: "测试群" });

      assert.deepEqual(result.items, []);
      assert.match(result.nextSteps.join("\n"), /创建群/);
      assert.match(result.nextSteps.join("\n"), /机器人拉入群/);
    } finally {
      await server.close();
    }
  });

  it("reports chat search failures", async () => {
    const server = await createTestServer({
      chatClient: {
        async searchChats() {
          throw new Error("permission denied");
        },
      },
    });
    try {
      await assert.rejects(
        () => server.client.searchChats({ query: "测试群" }),
        (error) =>
          error?.code === "LARK_CHAT_SEARCH_FAILED" &&
          error?.status === 502 &&
          /permission denied/.test(error.message),
      );
    } finally {
      await server.close();
    }
  });

  it("rejects invalid chat search requests before reporting Feishu failures", async () => {
    const server = await createTestServer({
      chatClient: {
        async searchChats() {
          throw new Error("should not be wrapped as Feishu failure");
        },
      },
    });
    try {
      await assert.rejects(
        () => server.client.searchChats({ query: "测试群", pageSize: 0 }),
        (error) =>
          error?.code === DAEMON_ERROR_CODES.INVALID_REQUEST &&
          error?.status === 400 &&
          /pageSize/.test(error.message),
      );
      await assert.rejects(
        () => server.client.searchChats({ query: "   " }),
        (error) =>
          error?.code === DAEMON_ERROR_CODES.INVALID_REQUEST &&
          error?.status === 400 &&
          /query/.test(error.message),
      );
      await assert.rejects(
        () => server.client.searchChats({ query: ["测试群"] }),
        (error) =>
          error?.code === DAEMON_ERROR_CODES.INVALID_REQUEST &&
          error?.status === 400 &&
          /query/.test(error.message),
      );
      await assert.rejects(
        () => server.client.searchChats({ query: "测试群", pageToken: { bad: true } }),
        (error) =>
          error?.code === DAEMON_ERROR_CODES.INVALID_REQUEST &&
          error?.status === 400 &&
          /pageToken/.test(error.message),
      );
    } finally {
      await server.close();
    }
  });

  it("rejects a null chat search request body as an invalid request", async () => {
    const server = await createTestServer({
      chatClient: {
        async searchChats() {
          throw new Error("should not call search client");
        },
      },
    });
    try {
      const response = await fetch(
        `http://${server.address.host}:${server.address.port}/chats/search`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "null",
        },
      );
      const payload = await response.json();

      assert.equal(response.status, 400);
      assert.equal(payload.error.code, DAEMON_ERROR_CODES.INVALID_REQUEST);
      assert.match(payload.error.message, /body/);
    } finally {
      await server.close();
    }
  });

  it("waits for a direct chat signal through the local protocol", async () => {
    const server = await createTestServer();
    try {
      const pending = server.client.waitDirectChatSignal({
        challengeText: "lark-connect bind 8F2K",
        agentKind: "codex",
        agentSessionId: "thread_a",
        workspace: "/workspace/app",
        timeoutMs: 1_000,
      });

      server.runtime.receiveLarkMessage({
        messageId: "om_signal",
        chatId: "oc_dm",
        chatType: "p2p",
        content: "lark-connect bind 8F2K",
        mentionedBot: false,
        senderId: "ou_sender",
      });

      const result = await pending;

      assert.equal(result.signal.chatId, "oc_dm");
      assert.equal(result.signal.messageId, "om_signal");
      assert.deepEqual(result.signal.bindingInput, {
        chatId: "oc_dm",
        agentKind: "codex",
        agentSessionId: "thread_a",
        workspace: "/workspace/app",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects invalid direct chat signal wait requests", async () => {
    const server = await createTestServer();
    try {
      for (const [field, input] of [
        [
          "challengeText",
          {
            challengeText: "   ",
            agentKind: "codex",
            agentSessionId: "thread_a",
            workspace: "/workspace/app",
          },
        ],
        [
          "agentKind",
          {
            challengeText: "lark-connect bind 8F2K",
            agentKind: "   ",
            agentSessionId: "thread_a",
            workspace: "/workspace/app",
          },
        ],
        [
          "agentSessionId",
          {
            challengeText: "lark-connect bind 8F2K",
            agentKind: "codex",
            agentSessionId: "   ",
            workspace: "/workspace/app",
          },
        ],
        [
          "workspace",
          {
            challengeText: "lark-connect bind 8F2K",
            agentKind: "codex",
            agentSessionId: "thread_a",
            workspace: "   ",
          },
        ],
        [
          "timeoutMs",
          {
            challengeText: "lark-connect bind 8F2K",
            agentKind: "codex",
            agentSessionId: "thread_a",
            workspace: "/workspace/app",
            timeoutMs: 2_147_483_648,
          },
        ],
      ]) {
        await assert.rejects(
          () => server.client.waitDirectChatSignal(input),
          (error) =>
            error?.code === DAEMON_ERROR_CODES.INVALID_REQUEST &&
            error?.status === 400 &&
            error?.details?.field === field,
        );
      }

      const nullResponse = await fetch(
        `http://${server.address.host}:${server.address.port}/direct-chat/signals/wait`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "null",
        },
      );
      const nullPayload = await nullResponse.json();

      assert.equal(nullResponse.status, 400);
      assert.equal(nullPayload.error.code, DAEMON_ERROR_CODES.INVALID_REQUEST);
      assert.match(nullPayload.error.message, /body/);

      const arrayResponse = await fetch(
        `http://${server.address.host}:${server.address.port}/direct-chat/signals/wait`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "[]",
        },
      );
      const arrayPayload = await arrayResponse.json();

      assert.equal(arrayResponse.status, 400);
      assert.equal(arrayPayload.error.code, DAEMON_ERROR_CODES.INVALID_REQUEST);
      assert.match(arrayPayload.error.message, /body/);
    } finally {
      await server.close();
    }
  });

  it("rejects non-boolean binding replace values through the local protocol", async () => {
    const server = await createTestServer();
    try {
      await server.client.bindSession(binding());

      await assert.rejects(
        () =>
          server.client.bindSession(
            binding({
              chatId: "oc_other",
              replace: "false",
            }),
          ),
        (error) =>
          error?.code === DAEMON_ERROR_CODES.INVALID_REQUEST &&
          error?.status === 400 &&
          error?.details?.field === "replace",
      );

      const status = await server.client.status();
      assert.deepEqual(status.bindings.map((item) => item.chatId), ["oc_target"]);
    } finally {
      await server.close();
    }
  });

  it("binds a chat and exposes it through status", async () => {
    const server = await createTestServer();
    try {
      const result = await server.client.bindSession(binding());
      const status = await server.client.status();

      assert.equal(result.binding.chatId, "oc_target");
      assert.deepEqual(status.bindings.map((item) => item.agentSessionId), ["thread_a"]);
    } finally {
      await server.close();
    }
  });

  it("returns a binding conflict without replacing the original binding", async () => {
    const server = await createTestServer();
    try {
      await server.client.bindSession(binding());

      await assert.rejects(
        () => server.client.bindSession(binding({ agentSessionId: "thread_b" })),
        (error) => error?.code === "BINDING_CONFLICT" && error?.status === 409,
      );

      const status = await server.client.status();
      assert.deepEqual(status.bindings.map((item) => item.agentSessionId), ["thread_a"]);
    } finally {
      await server.close();
    }
  });

  it("polls, waits, and acknowledges messages through the local protocol", async () => {
    const server = await createTestServer();
    try {
      await server.client.bindSession(binding());
      server.runtime.receiveLarkMessage(larkMessage({ messageId: "om_poll" }));

      const polled = await server.client.pollMessages("thread_a");
      assert.deepEqual(
        polled.messages.map((message) => message.larkMessageId),
        ["om_poll"],
      );

      await server.client.ackMessage("om_poll", { agentSessionId: "thread_a" });
      const statusAfterAck = await server.client.status();
      assert.equal(statusAfterAck.sessions[0].messages[0].status, "acknowledged");

      const emptyWait = await server.client.waitForMessages("thread_a", { timeoutMs: 0 });
      assert.deepEqual(emptyWait.messages, []);
      assert.match(emptyWait.nextSteps.join("\n"), /继续调用 lark_connect_wait_messages/);
      assert.match(emptyWait.nextSteps.join("\n"), /心跳/);
      assert.match(
        emptyWait.nextSteps.join("\n"),
        /npx -y curiosea-lark-connect@latest wait --agent-session-id thread_a --timeout-ms 300000/,
      );
      assert.doesNotMatch(emptyWait.nextSteps.join("\n"), /<绑定时使用的 agentSessionId>/);
      assert.match(emptyWait.nextSteps.join("\n"), /唤醒后先调用 lark_connect_poll_messages/);

      server.runtime.receiveLarkMessage(larkMessage({ messageId: "om_wait_ready" }));
      const readyWait = await server.client.waitForMessages("thread_a", { timeoutMs: 0 });
      assert.deepEqual(
        readyWait.messages.map((message) => message.larkMessageId),
        ["om_wait_ready"],
      );
      assert.equal(readyWait.nextSteps, undefined);
    } finally {
      await server.close();
    }
  });

  it("routes bound direct messages without requiring a bot mention", async () => {
    const server = await createTestServer();
    try {
      await server.client.bindSession(binding({ chatId: "oc_dm" }));
      server.runtime.receiveLarkMessage(
        larkMessage({
          messageId: "om_dm",
          chatId: "oc_dm",
          chatType: "p2p",
          mentionedBot: false,
        }),
      );

      const polled = await server.client.pollMessages("thread_a");
      assert.deepEqual(
        polled.messages.map((message) => ({
          id: message.larkMessageId,
          chatType: message.payload.chatType,
        })),
        [{ id: "om_dm", chatType: "p2p" }],
      );
    } finally {
      await server.close();
    }
  });

  it("adds an OK reaction to the original message when acknowledging it", async () => {
    const observedReactions = [];
    const server = await createTestServer({
      reactionClient: {
        async addMessageReaction(messageId, emojiType) {
          observedReactions.push({ messageId, emojiType });
          return {
            messageId,
            emojiType,
            reactionId: "reaction_1",
          };
        },
      },
    });
    try {
      await server.client.bindSession(binding());
      server.runtime.receiveLarkMessage(larkMessage({ messageId: "om_reaction" }));
      await server.client.pollMessages("thread_a");

      const result = await server.client.ackMessage("om_reaction", {
        agentSessionId: "thread_a",
      });

      assert.deepEqual(observedReactions, [
        {
          messageId: "om_reaction",
          emojiType: "OK",
        },
      ]);
      assert.deepEqual(result.reaction, {
        messageId: "om_reaction",
        emojiType: "OK",
        reactionId: "reaction_1",
      });
    } finally {
      await server.close();
    }
  });

  it("reports reaction failures when acknowledgment cannot notify Feishu", async () => {
    const server = await createTestServer({
      reactionClient: {
        async addMessageReaction() {
          throw new Error("permission denied");
        },
      },
    });
    try {
      await server.client.bindSession(binding());
      server.runtime.receiveLarkMessage(larkMessage({ messageId: "om_reaction_fail" }));
      await server.client.pollMessages("thread_a");

      await assert.rejects(
        () => server.client.ackMessage("om_reaction_fail", { agentSessionId: "thread_a" }),
        (error) =>
          error?.code === "LARK_REACTION_FAILED" &&
          error?.status === 502 &&
          error?.details?.messageId === "om_reaction_fail" &&
          error?.details?.emojiType === "OK",
      );
      const statusAfterFailure = await server.client.status();
      assert.equal(statusAfterFailure.sessions[0].messages[0].status, "delivered");
    } finally {
      await server.close();
    }
  });

  it("does not add an acknowledgment reaction for messages that did not mention the bot", async () => {
    const observedReactions = [];
    const server = await createTestServer({
      reactionClient: {
        async addMessageReaction(messageId, emojiType) {
          observedReactions.push({ messageId, emojiType });
          return { messageId, emojiType, reactionId: "reaction_1" };
        },
      },
    });
    try {
      await server.client.bindSession(binding());
      server.runtime.receiveLarkMessage(
        larkMessage({ messageId: "om_no_mention", mentionedBot: false }),
      );

      assert.deepEqual(await server.client.pollMessages("thread_a"), { messages: [] });
      await assert.rejects(
        () => server.client.ackMessage("om_no_mention", { agentSessionId: "thread_a" }),
        (error) => error?.code === "MESSAGE_NOT_FOUND" && error?.status === 404,
      );
      assert.deepEqual(observedReactions, []);
    } finally {
      await server.close();
    }
  });

  it("sends a text message to the chat bound to an agent session", async () => {
    const observedMessages = [];
    const server = await createTestServer({
      messageClient: {
        async sendTextMessage(input) {
          observedMessages.push(input);
          return {
            ...input,
            messageId: "om_sent",
          };
        },
      },
    });
    try {
      await server.client.bindSession(binding());

      const result = await server.client.sendMessage("thread_a", {
        text: "处理完成",
        replyToMessageId: "om_original",
        replyInThread: true,
      });

      assert.deepEqual(observedMessages, [
        {
          chatId: "oc_target",
          text: "处理完成",
          replyToMessageId: "om_original",
          replyInThread: true,
        },
      ]);
      assert.deepEqual(result.message, {
        id: "om_sent",
        larkMessageId: "om_sent",
        chatId: "oc_target",
        agentSessionId: "thread_a",
        text: "处理完成",
        replyToMessageId: "om_original",
        replyInThread: true,
      });
    } finally {
      await server.close();
    }
  });

  it("does not send a text message when the agent session is not bound", async () => {
    const observedMessages = [];
    const server = await createTestServer({
      messageClient: {
        async sendTextMessage(input) {
          observedMessages.push(input);
          return { ...input, messageId: "om_sent" };
        },
      },
    });
    try {
      await assert.rejects(
        () => server.client.sendMessage("thread_unbound", { text: "hello" }),
        (error) =>
          error?.code === "SESSION_NOT_BOUND" &&
          error?.status === 404 &&
          error?.details?.agentSessionId === "thread_unbound",
      );
      assert.deepEqual(observedMessages, []);
    } finally {
      await server.close();
    }
  });

  it("sends a file to the chat bound to an agent session", async () => {
    const observedFiles = [];
    const server = await createTestServer({
      messageClient: {
        async sendFileMessage(input) {
          observedFiles.push(input);
          return {
            ...input,
            messageId: "om_file",
          };
        },
      },
    });
    try {
      await server.client.bindSession(binding());

      const result = await server.client.sendFile("thread_a", {
        filePath: "/tmp/lark-connect/screen.mov",
        fileName: "screen.mov",
        replyToMessageId: "om_original",
        replyInThread: true,
      });

      assert.deepEqual(observedFiles, [
        {
          chatId: "oc_target",
          filePath: "/tmp/lark-connect/screen.mov",
          fileName: "screen.mov",
          replyToMessageId: "om_original",
          replyInThread: true,
        },
      ]);
      assert.deepEqual(result.message, {
        id: "om_file",
        larkMessageId: "om_file",
        chatId: "oc_target",
        agentSessionId: "thread_a",
        filePath: "/tmp/lark-connect/screen.mov",
        fileName: "screen.mov",
        replyToMessageId: "om_original",
        replyInThread: true,
      });
    } finally {
      await server.close();
    }
  });

  it("does not send a file when the agent session is not bound", async () => {
    const observedFiles = [];
    const server = await createTestServer({
      messageClient: {
        async sendFileMessage(input) {
          observedFiles.push(input);
          return { ...input, messageId: "om_file" };
        },
      },
    });
    try {
      await assert.rejects(
        () => server.client.sendFile("thread_unbound", { filePath: "/tmp/output.txt" }),
        (error) =>
          error?.code === "SESSION_NOT_BOUND" &&
          error?.status === 404 &&
          error?.details?.agentSessionId === "thread_unbound",
      );
      assert.deepEqual(observedFiles, []);
    } finally {
      await server.close();
    }
  });

  it("sends an image to the chat bound to an agent session", async () => {
    const observedImages = [];
    const server = await createTestServer({
      messageClient: {
        async sendImageMessage(input) {
          observedImages.push(input);
          return {
            ...input,
            messageId: "om_image",
          };
        },
      },
    });
    try {
      await server.client.bindSession(binding());

      const result = await server.client.sendImage("thread_a", {
        imagePath: "/tmp/lark-connect/screen.png",
        replyToMessageId: "om_original",
        replyInThread: true,
      });

      assert.deepEqual(observedImages, [
        {
          chatId: "oc_target",
          imagePath: "/tmp/lark-connect/screen.png",
          replyToMessageId: "om_original",
          replyInThread: true,
        },
      ]);
      assert.deepEqual(result.message, {
        id: "om_image",
        larkMessageId: "om_image",
        chatId: "oc_target",
        agentSessionId: "thread_a",
        imagePath: "/tmp/lark-connect/screen.png",
        replyToMessageId: "om_original",
        replyInThread: true,
      });
    } finally {
      await server.close();
    }
  });

  it("sends a video to the chat bound to an agent session", async () => {
    const observedVideos = [];
    const server = await createTestServer({
      messageClient: {
        async sendVideoMessage(input) {
          observedVideos.push(input);
          return {
            ...input,
            coverImageKey: "img_cover",
            messageId: "om_video",
          };
        },
      },
    });
    try {
      await server.client.bindSession(binding());

      const result = await server.client.sendVideo("thread_a", {
        videoPath: "/tmp/lark-connect/demo.mp4",
        coverImagePath: "/tmp/lark-connect/demo-cover.png",
        replyToMessageId: "om_original",
        replyInThread: true,
      });

      assert.deepEqual(observedVideos, [
        {
          chatId: "oc_target",
          videoPath: "/tmp/lark-connect/demo.mp4",
          coverImagePath: "/tmp/lark-connect/demo-cover.png",
          replyToMessageId: "om_original",
          replyInThread: true,
        },
      ]);
      assert.deepEqual(result.message, {
        id: "om_video",
        larkMessageId: "om_video",
        chatId: "oc_target",
        agentSessionId: "thread_a",
        videoPath: "/tmp/lark-connect/demo.mp4",
        coverImagePath: "/tmp/lark-connect/demo-cover.png",
        coverImageKey: "img_cover",
        replyToMessageId: "om_original",
        replyInThread: true,
      });
    } finally {
      await server.close();
    }
  });

  it("does not send media when the agent session is not bound", async () => {
    const observedMedia = [];
    const server = await createTestServer({
      messageClient: {
        async sendImageMessage(input) {
          observedMedia.push(input);
          return { ...input, messageId: "om_image" };
        },
        async sendVideoMessage(input) {
          observedMedia.push(input);
          return { ...input, messageId: "om_video" };
        },
      },
    });
    try {
      for (const call of [
        () => server.client.sendImage("thread_unbound", { imagePath: "/tmp/screen.png" }),
        () =>
          server.client.sendVideo("thread_unbound", {
            videoPath: "/tmp/demo.mp4",
            coverImagePath: "/tmp/demo-cover.png",
          }),
      ]) {
        await assert.rejects(
          call,
          (error) =>
            error?.code === "SESSION_NOT_BOUND" &&
            error?.status === 404 &&
            error?.details?.agentSessionId === "thread_unbound",
        );
      }
      assert.deepEqual(observedMedia, []);
    } finally {
      await server.close();
    }
  });

  it("downloads a resource from a message bound to an agent session", async () => {
    const observedDownloads = [];
    const server = await createTestServer({
      resourceClient: {
        async downloadResource(input) {
          observedDownloads.push(input);
          return {
            agentSessionId: input.agentSessionId,
            messageId: input.messageId,
            fileKey: input.resource.fileKey,
            resourceType: input.resource.type,
            fileName: input.resource.fileName,
            filePath: "/tmp/lark-connect-downloads/screen.png",
            size: 12,
          };
        },
      },
    });
    try {
      await server.client.bindSession(binding());
      server.runtime.receiveLarkMessage(
        larkMessage({
          messageId: "om_resource",
          resources: [
            {
              type: "image",
              fileKey: "img_1",
              fileName: "screen.png",
            },
          ],
        }),
      );
      await server.client.pollMessages("thread_a");

      const result = await server.client.downloadResource("thread_a", {
        messageId: "om_resource",
        fileKey: "img_1",
        outputDir: "/tmp/lark-connect-downloads",
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
          outputDir: "/tmp/lark-connect-downloads",
        },
      ]);
      assert.deepEqual(result.download, {
        agentSessionId: "thread_a",
        messageId: "om_resource",
        fileKey: "img_1",
        resourceType: "image",
        fileName: "screen.png",
        filePath: "/tmp/lark-connect-downloads/screen.png",
        size: 12,
      });
    } finally {
      await server.close();
    }
  });

  it("rejects invalid send and download requests before calling external clients", async () => {
    const observedCalls = [];
    const server = await createTestServer({
      messageClient: {
        async sendTextMessage(input) {
          observedCalls.push(["text", input]);
          return { ...input, messageId: "om_text" };
        },
        async sendFileMessage(input) {
          observedCalls.push(["file", input]);
          return { ...input, messageId: "om_file" };
        },
        async sendImageMessage(input) {
          observedCalls.push(["image", input]);
          return { ...input, messageId: "om_image" };
        },
        async sendVideoMessage(input) {
          observedCalls.push(["video", input]);
          return { ...input, messageId: "om_video" };
        },
      },
      resourceClient: {
        async downloadResource(input) {
          observedCalls.push(["download", input]);
          return { ...input, filePath: "/tmp/unused", size: 0 };
        },
      },
    });
    try {
      await server.client.bindSession(binding());

      for (const call of [
        () => server.client.sendMessage("thread_a", { text: "   " }),
        () => server.client.sendFile("thread_a", { filePath: "" }),
        () => server.client.sendImage("thread_a", { imagePath: "" }),
        () =>
          server.client.sendVideo("thread_a", {
            videoPath: "",
            coverImagePath: "/tmp/cover.png",
          }),
        () =>
          server.client.sendVideo("thread_a", {
            videoPath: "/tmp/video.mp4",
            coverImagePath: "",
          }),
        () =>
          server.client.downloadResource("thread_a", {
            messageId: "",
            fileKey: "img_1",
          }),
        () =>
          server.client.downloadResource("thread_a", {
            messageId: "om_resource",
            fileKey: "",
          }),
      ]) {
        await assert.rejects(
          call,
          (error) => error?.code === DAEMON_ERROR_CODES.INVALID_REQUEST && error?.status === 400,
        );
      }

      assert.deepEqual(observedCalls, []);
    } finally {
      await server.close();
    }
  });

  it("does not download a resource when the session, message, or resource is missing", async () => {
    const observedDownloads = [];
    const server = await createTestServer({
      resourceClient: {
        async downloadResource(input) {
          observedDownloads.push(input);
          return { ...input, filePath: "/tmp/unused", size: 0 };
        },
      },
    });
    try {
      await assert.rejects(
        () =>
          server.client.downloadResource("thread_unbound", {
            messageId: "om_resource",
            fileKey: "img_1",
          }),
        (error) =>
          error?.code === "SESSION_NOT_BOUND" &&
          error?.status === 404 &&
          error?.details?.agentSessionId === "thread_unbound",
      );

      await server.client.bindSession(binding());
      await assert.rejects(
        () =>
          server.client.downloadResource("thread_a", {
            messageId: "om_missing",
            fileKey: "img_1",
          }),
        (error) => error?.code === "MESSAGE_NOT_FOUND" && error?.status === 404,
      );

      server.runtime.receiveLarkMessage(
        larkMessage({
          messageId: "om_resource",
          resources: [
            {
              type: "image",
              fileKey: "img_1",
              fileName: "screen.png",
            },
          ],
        }),
      );
      await assert.rejects(
        () =>
          server.client.downloadResource("thread_a", {
            messageId: "om_resource",
            fileKey: "missing_key",
          }),
        (error) => error?.code === "RESOURCE_NOT_FOUND" && error?.status === 404,
      );

      assert.deepEqual(observedDownloads, []);
    } finally {
      await server.close();
    }
  });

  it("returns session-not-bound when message tools are called before binding", async () => {
    const server = await createTestServer();
    try {
      for (const call of [
        () => server.client.pollMessages("thread_unbound"),
        () => server.client.waitForMessages("thread_unbound", { timeoutMs: 0 }),
        () => server.client.ackMessage("om_missing", { agentSessionId: "thread_unbound" }),
      ]) {
        await assert.rejects(
          call,
          (error) =>
            error?.code === "SESSION_NOT_BOUND" &&
            error?.status === 404 &&
            error?.details?.agentSessionId === "thread_unbound",
        );
      }
    } finally {
      await server.close();
    }
  });
});
