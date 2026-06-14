import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DAEMON_ERROR_CODES, DAEMON_START_COMMAND, DaemonHttpError } from "../src/daemon/errors.js";
import { handleMcpMessage } from "../src/mcp/server.js";

function toolCall(name, args = {}) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  };
}

function parseToolJson(response) {
  return JSON.parse(response.result.content[0].text);
}

function toolByName(tools, name) {
  return tools.find((tool) => tool.name === name);
}

describe("mcp daemon tools", () => {
  it("exposes daemon binding and message tools", async () => {
    const response = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    assert.deepEqual(
      response.result.tools.map((tool) => tool.name),
      [
        "lark_connect_daemon_status",
        "lark_connect_search_chats",
        "lark_connect_wait_direct_chat_signal",
        "lark_connect_bind_session",
        "lark_connect_get_chat_context",
        "lark_connect_get_chat_members",
        "lark_connect_poll_messages",
        "lark_connect_wait_messages",
        "lark_connect_ack_message",
        "lark_connect_send_message",
        "lark_connect_send_file",
        "lark_connect_send_image",
        "lark_connect_send_video",
        "lark_connect_download_resource",
      ],
    );
  });

  it("exposes strict schemas for chat discovery tools", async () => {
    const response = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const tools = response.result.tools;

    assert.deepEqual(toolByName(tools, "lark_connect_search_chats").inputSchema, {
      type: "object",
      properties: {
        query: { type: "string", description: "Group chat name keyword to search." },
        pageSize: { type: "number", description: "Maximum number of chats to return." },
        pageToken: { type: "string", description: "Optional pagination token from a prior search." },
      },
      required: ["query"],
      additionalProperties: false,
    });
    assert.deepEqual(toolByName(tools, "lark_connect_wait_direct_chat_signal").inputSchema, {
      type: "object",
      properties: {
        challengeText: {
          type: "string",
          description: "Exact text the user must send to the bot direct chat.",
        },
        agentKind: {
          type: "string",
          description: "Agent runtime, for example codex or claude-code.",
        },
        agentSessionId: {
          type: "string",
          description: "Codex thread id or Claude Code session id.",
        },
        workspace: {
          type: "string",
          description: "Absolute workspace path for this agent session.",
        },
        timeoutMs: {
          type: "number",
          description: "Maximum wait time in milliseconds.",
        },
      },
      required: ["challengeText", "agentKind", "agentSessionId", "workspace"],
      additionalProperties: false,
    });
  });

  it("rejects removed setup_url without creating a daemon client", async () => {
    const response = await handleMcpMessage(toolCall("setup_url"), {
      createDaemonHttpClientImpl: () => {
        throw new Error("daemon client should not be created");
      },
    });

    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /unknown tool: setup_url/);
  });

  it("forwards session binding calls to the local daemon client", async () => {
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_bind_session", {
        chatId: "oc_target",
        agentKind: "codex",
        agentSessionId: "thread_a",
        workspace: "/workspace/app",
        replace: true,
      }),
      {
        createDaemonHttpClientImpl: () => ({
          bindSession: async (args) => {
            observedArgs = args;
            return { binding: args };
          },
        }),
      },
    );

    assert.deepEqual(observedArgs, {
      chatId: "oc_target",
      agentKind: "codex",
      agentSessionId: "thread_a",
      workspace: "/workspace/app",
      replace: true,
    });
    assert.deepEqual(parseToolJson(response), {
      binding: observedArgs,
    });
  });

  it("forwards chat search calls to the local daemon client", async () => {
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_search_chats", {
        query: "测试群",
        pageSize: 10,
      }),
      {
        createDaemonHttpClientImpl: () => ({
          searchChats: async (args) => {
            observedArgs = args;
            return {
              query: args.query,
              items: [{ chatId: "oc_test", name: "lark-connect 测试群" }],
              hasMore: false,
              pageToken: "",
              nextSteps: [],
            };
          },
        }),
      },
    );

    assert.deepEqual(observedArgs, {
      query: "测试群",
      pageSize: 10,
      pageToken: undefined,
    });
    assert.deepEqual(parseToolJson(response), {
      query: "测试群",
      items: [{ chatId: "oc_test", name: "lark-connect 测试群" }],
      hasMore: false,
      pageToken: "",
      nextSteps: [],
    });
  });

  it("forwards direct chat signal waits to the local daemon client", async () => {
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_wait_direct_chat_signal", {
        challengeText: "lark-connect bind 8F2K",
        agentKind: "codex",
        agentSessionId: "thread_a",
        workspace: "/workspace/app",
        timeoutMs: 60_000,
      }),
      {
        createDaemonHttpClientImpl: () => ({
          waitDirectChatSignal: async (args) => {
            observedArgs = args;
            return {
              signal: {
                chatId: "oc_dm",
                chatType: "p2p",
                messageId: "om_signal",
                matchedChallenge: args.challengeText,
                bindingInput: {
                  chatId: "oc_dm",
                  agentKind: args.agentKind,
                  agentSessionId: args.agentSessionId,
                  workspace: args.workspace,
                },
              },
            };
          },
        }),
      },
    );

    assert.deepEqual(observedArgs, {
      challengeText: "lark-connect bind 8F2K",
      agentKind: "codex",
      agentSessionId: "thread_a",
      workspace: "/workspace/app",
      timeoutMs: 60_000,
    });
    assert.equal(parseToolJson(response).signal.chatId, "oc_dm");
  });

  it("returns empty chat search next steps through the tool result", async () => {
    const response = await handleMcpMessage(
      toolCall("lark_connect_search_chats", {
        query: "不存在的群",
      }),
      {
        createDaemonHttpClientImpl: () => ({
          searchChats: async (args) => ({
            query: args.query,
            items: [],
            hasMore: false,
            pageToken: "",
            nextSteps: [
              "没有找到名称匹配“不存在的群”且机器人可见的群聊。",
              "请用户确认群名是否正确；如果目标群还不存在，请先创建群。",
              "如果群已经存在，请把当前飞书应用的机器人拉入群后再搜索。",
            ],
          }),
        }),
      },
    );

    const result = parseToolJson(response);
    assert.deepEqual(result.items, []);
    assert.match(result.nextSteps.join("\n"), /创建群/);
    assert.match(result.nextSteps.join("\n"), /机器人拉入群/);
  });

  it("returns chat search failures as structured tool errors", async () => {
    const response = await handleMcpMessage(
      toolCall("lark_connect_search_chats", {
        query: "测试群",
      }),
      {
        createDaemonHttpClientImpl: () => ({
          searchChats: async () => {
            throw new DaemonHttpError(
              DAEMON_ERROR_CODES.LARK_CHAT_SEARCH_FAILED,
              "failed to search Feishu chats for 测试群: permission denied",
              {
                status: 502,
                details: { query: "测试群" },
              },
            );
          },
        }),
      },
    );

    assert.equal(response.result.isError, true);
    assert.deepEqual(parseToolJson(response), {
      code: DAEMON_ERROR_CODES.LARK_CHAT_SEARCH_FAILED,
      message: "failed to search Feishu chats for 测试群: permission denied",
      details: { query: "测试群" },
    });
  });

  it("returns daemon-not-running as a tool error with a start command", async () => {
    const response = await handleMcpMessage(toolCall("lark_connect_daemon_status"), {
      createDaemonHttpClientImpl: () => ({
        status: async () => {
          throw new DaemonHttpError(
            DAEMON_ERROR_CODES.DAEMON_NOT_RUNNING,
            `lark-connect daemon is not running. Start it with: ${DAEMON_START_COMMAND}`,
            { command: DAEMON_START_COMMAND },
          );
        },
      }),
    });

    assert.equal(response.result.isError, true);
    assert.deepEqual(parseToolJson(response), {
      code: "DAEMON_NOT_RUNNING",
      message: `lark-connect daemon is not running. Start it with: ${DAEMON_START_COMMAND}`,
      command: DAEMON_START_COMMAND,
    });
  });

  it("returns session-not-bound as a tool error before polling a bound session", async () => {
    const response = await handleMcpMessage(
      toolCall("lark_connect_poll_messages", { agentSessionId: "thread_unbound" }),
      {
        createDaemonHttpClientImpl: () => ({
          pollMessages: async () => {
            throw new DaemonHttpError(
              DAEMON_ERROR_CODES.SESSION_NOT_BOUND,
              "No Feishu chat is bound to agentSessionId thread_unbound. Call lark_connect_bind_session first.",
              {
                status: 404,
                details: { agentSessionId: "thread_unbound" },
              },
            );
          },
        }),
      },
    );

    assert.equal(response.result.isError, true);
    assert.deepEqual(parseToolJson(response), {
      code: "SESSION_NOT_BOUND",
      message:
        "No Feishu chat is bound to agentSessionId thread_unbound. Call lark_connect_bind_session first.",
      details: { agentSessionId: "thread_unbound" },
    });
  });

  it("returns chat context failures as structured tool errors", async () => {
    const sessionNotBound = await handleMcpMessage(
      toolCall("lark_connect_get_chat_context", { agentSessionId: "thread_unbound" }),
      {
        createDaemonHttpClientImpl: () => ({
          getChatContext: async () => {
            throw new DaemonHttpError(
              DAEMON_ERROR_CODES.SESSION_NOT_BOUND,
              "No Feishu chat is bound to agentSessionId thread_unbound. Call lark_connect_bind_session first.",
              {
                status: 404,
                details: { agentSessionId: "thread_unbound" },
              },
            );
          },
        }),
      },
    );

    assert.equal(sessionNotBound.result.isError, true);
    assert.deepEqual(parseToolJson(sessionNotBound), {
      code: DAEMON_ERROR_CODES.SESSION_NOT_BOUND,
      message:
        "No Feishu chat is bound to agentSessionId thread_unbound. Call lark_connect_bind_session first.",
      details: { agentSessionId: "thread_unbound" },
    });

    const larkFailure = await handleMcpMessage(
      toolCall("lark_connect_get_chat_context", { agentSessionId: "thread_a" }),
      {
        createDaemonHttpClientImpl: () => ({
          getChatContext: async () => {
            throw new DaemonHttpError(
              DAEMON_ERROR_CODES.LARK_CHAT_CONTEXT_FAILED,
              "failed to get Feishu chat context for oc_target: permission denied",
              {
                status: 502,
                details: { chatId: "oc_target" },
              },
            );
          },
        }),
      },
    );

    assert.equal(larkFailure.result.isError, true);
    assert.deepEqual(parseToolJson(larkFailure), {
      code: DAEMON_ERROR_CODES.LARK_CHAT_CONTEXT_FAILED,
      message: "failed to get Feishu chat context for oc_target: permission denied",
      details: { chatId: "oc_target" },
    });
  });

  it("returns chat member failures as structured tool errors", async () => {
    const sessionNotBound = await handleMcpMessage(
      toolCall("lark_connect_get_chat_members", { agentSessionId: "thread_unbound" }),
      {
        createDaemonHttpClientImpl: () => ({
          getChatMembers: async () => {
            throw new DaemonHttpError(
              DAEMON_ERROR_CODES.SESSION_NOT_BOUND,
              "No Feishu chat is bound to agentSessionId thread_unbound. Call lark_connect_bind_session first.",
              {
                status: 404,
                details: { agentSessionId: "thread_unbound" },
              },
            );
          },
        }),
      },
    );

    assert.equal(sessionNotBound.result.isError, true);
    assert.deepEqual(parseToolJson(sessionNotBound), {
      code: DAEMON_ERROR_CODES.SESSION_NOT_BOUND,
      message:
        "No Feishu chat is bound to agentSessionId thread_unbound. Call lark_connect_bind_session first.",
      details: { agentSessionId: "thread_unbound" },
    });

    const larkFailure = await handleMcpMessage(
      toolCall("lark_connect_get_chat_members", { agentSessionId: "thread_a" }),
      {
        createDaemonHttpClientImpl: () => ({
          getChatMembers: async () => {
            throw new DaemonHttpError(
              DAEMON_ERROR_CODES.LARK_CHAT_MEMBERS_FAILED,
              "failed to get Feishu chat members for oc_target: permission denied",
              {
                status: 502,
                details: { chatId: "oc_target" },
              },
            );
          },
        }),
      },
    );

    assert.equal(larkFailure.result.isError, true);
    assert.deepEqual(parseToolJson(larkFailure), {
      code: DAEMON_ERROR_CODES.LARK_CHAT_MEMBERS_FAILED,
      message: "failed to get Feishu chat members for oc_target: permission denied",
      details: { chatId: "oc_target" },
    });
  });

  it("exposes strict schemas for chat context and mention sending", async () => {
    const response = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const tools = response.result.tools;

    assert.deepEqual(toolByName(tools, "lark_connect_get_chat_context").inputSchema, {
      type: "object",
      properties: {
        agentSessionId: {
          type: "string",
          description: "Codex thread id or Claude Code session id.",
        },
        limit: {
          type: "number",
          description: "Maximum number of recent chat messages to return. Defaults to 10.",
        },
        pageToken: {
          type: "string",
          description: "Optional pagination token from a prior context read.",
        },
      },
      required: ["agentSessionId"],
      additionalProperties: false,
    });
    assert.equal(
      toolByName(tools, "lark_connect_send_message").description,
      "Send text to the bound Feishu chat. Supports replying to a message, mentioning humans or bots, and mention-only messages.",
    );
    assert.equal(
      toolByName(tools, "lark_connect_get_chat_members").description,
      "Read human members and group bots from the Feishu chat bound to one Codex or Claude Code session. Bot results come from the Feishu members/bots API and include bot open_id values.",
    );
    assert.deepEqual(toolByName(tools, "lark_connect_get_chat_members").inputSchema, {
      type: "object",
      properties: {
        agentSessionId: {
          type: "string",
          description: "Codex thread id or Claude Code session id.",
        },
        pageSize: {
          type: "number",
          description: "Maximum number of human members to return. Defaults to 50.",
        },
        pageToken: {
          type: "string",
          description: "Optional pagination token from a prior member read.",
        },
      },
      required: ["agentSessionId"],
      additionalProperties: false,
    });
    assert.deepEqual(toolByName(tools, "lark_connect_send_message").inputSchema, {
      type: "object",
      properties: {
        agentSessionId: {
          type: "string",
          description: "Codex thread id or Claude Code session id.",
        },
        text: {
          type: "string",
          description: "Plain text to send. Optional when mentions are provided.",
        },
        mentions: {
          type: "array",
          description:
            "Optional Feishu users or bots to mention before the text. Supports mention-only messages.",
          items: {
            type: "object",
            properties: {
              openId: {
                type: "string",
                description: "Feishu open_id for a human user or bot.",
              },
              name: {
                type: "string",
                description: "Optional display name used in the mention tag.",
              },
              isBot: {
                type: "boolean",
                description: "Whether the mention target is another bot.",
              },
            },
            required: ["openId"],
            additionalProperties: false,
          },
        },
        replyToMessageId: { type: "string", description: "Optional Feishu message id to reply to." },
        replyInThread: { type: "boolean", description: "Whether to reply inside a Feishu thread." },
      },
      required: ["agentSessionId"],
      additionalProperties: false,
    });
  });

  it("forwards chat context reads to the local daemon client", async () => {
    let observedAgentSessionId;
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_get_chat_context", {
        agentSessionId: "thread_a",
        limit: 10,
        pageToken: "next_page",
      }),
      {
        createDaemonHttpClientImpl: () => ({
          getChatContext: async (agentSessionId, args) => {
            observedAgentSessionId = agentSessionId;
            observedArgs = args;
            return {
              context: {
                chatId: "oc_target",
                limit: args.limit,
                messages: [{ messageId: "om_latest", text: "最近的讨论" }],
                hasMore: false,
                pageToken: "",
              },
            };
          },
        }),
      },
    );

    assert.equal(observedAgentSessionId, "thread_a");
    assert.deepEqual(observedArgs, {
      limit: 10,
      pageToken: "next_page",
    });
    assert.deepEqual(parseToolJson(response), {
      context: {
        chatId: "oc_target",
        limit: 10,
        messages: [{ messageId: "om_latest", text: "最近的讨论" }],
        hasMore: false,
        pageToken: "",
      },
    });
  });

  it("forwards chat member reads to the local daemon client", async () => {
    let observedAgentSessionId;
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_get_chat_members", {
        agentSessionId: "thread_a",
        pageSize: 20,
        pageToken: "members_page",
      }),
      {
        createDaemonHttpClientImpl: () => ({
          getChatMembers: async (agentSessionId, args) => {
            observedAgentSessionId = agentSessionId;
            observedArgs = args;
            return {
              roster: {
                chatId: "oc_target",
                members: [{ memberId: "ou_human", memberType: "user" }],
                bots: [
                  {
                    botId: "ou_bot",
                    openId: "ou_bot",
                    memberType: "bot",
                    source: "chat_member_bots_api",
                  },
                ],
                botCoverage: "direct",
              },
            };
          },
        }),
      },
    );

    assert.equal(observedAgentSessionId, "thread_a");
    assert.deepEqual(observedArgs, {
      pageSize: 20,
      pageToken: "members_page",
    });
    assert.deepEqual(parseToolJson(response), {
      roster: {
        chatId: "oc_target",
        members: [{ memberId: "ou_human", memberType: "user" }],
        bots: [
          {
            botId: "ou_bot",
            openId: "ou_bot",
            memberType: "bot",
            source: "chat_member_bots_api",
          },
        ],
        botCoverage: "direct",
      },
    });
  });

  it("forwards text send calls to the local daemon client", async () => {
    let observedAgentSessionId;
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_send_message", {
        agentSessionId: "thread_a",
        text: "处理完成",
        mentions: [{ openId: "ou_designer", name: "设计师" }],
        replyToMessageId: "om_original",
        replyInThread: true,
      }),
      {
        createDaemonHttpClientImpl: () => ({
          sendMessage: async (agentSessionId, args) => {
            observedAgentSessionId = agentSessionId;
            observedArgs = args;
            return {
              message: {
                id: "om_sent",
                larkMessageId: "om_sent",
                chatId: "oc_target",
                agentSessionId,
                ...args,
              },
            };
          },
        }),
      },
    );

    assert.equal(observedAgentSessionId, "thread_a");
    assert.deepEqual(observedArgs, {
      text: "处理完成",
      mentions: [{ openId: "ou_designer", name: "设计师" }],
      replyToMessageId: "om_original",
      replyInThread: true,
    });
    assert.deepEqual(parseToolJson(response), {
      message: {
        id: "om_sent",
        larkMessageId: "om_sent",
        chatId: "oc_target",
        agentSessionId: "thread_a",
        text: "处理完成",
        mentions: [{ openId: "ou_designer", name: "设计师" }],
        replyToMessageId: "om_original",
        replyInThread: true,
      },
    });
  });

  it("forwards file send calls to the local daemon client", async () => {
    let observedAgentSessionId;
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_send_file", {
        agentSessionId: "thread_a",
        filePath: "/tmp/lark-connect/screen.mov",
        fileName: "screen.mov",
        replyToMessageId: "om_original",
        replyInThread: true,
      }),
      {
        createDaemonHttpClientImpl: () => ({
          sendFile: async (agentSessionId, args) => {
            observedAgentSessionId = agentSessionId;
            observedArgs = args;
            return {
              message: {
                id: "om_file",
                larkMessageId: "om_file",
                chatId: "oc_target",
                agentSessionId,
                ...args,
              },
            };
          },
        }),
      },
    );

    assert.equal(observedAgentSessionId, "thread_a");
    assert.deepEqual(observedArgs, {
      filePath: "/tmp/lark-connect/screen.mov",
      fileName: "screen.mov",
      replyToMessageId: "om_original",
      replyInThread: true,
    });
    assert.deepEqual(parseToolJson(response), {
      message: {
        id: "om_file",
        larkMessageId: "om_file",
        chatId: "oc_target",
        agentSessionId: "thread_a",
        filePath: "/tmp/lark-connect/screen.mov",
        fileName: "screen.mov",
        replyToMessageId: "om_original",
        replyInThread: true,
      },
    });
  });

  it("forwards image send calls to the local daemon client", async () => {
    let observedAgentSessionId;
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_send_image", {
        agentSessionId: "thread_a",
        imagePath: "/tmp/lark-connect/screen.png",
        replyToMessageId: "om_original",
        replyInThread: true,
      }),
      {
        createDaemonHttpClientImpl: () => ({
          sendImage: async (agentSessionId, args) => {
            observedAgentSessionId = agentSessionId;
            observedArgs = args;
            return {
              message: {
                id: "om_image",
                larkMessageId: "om_image",
                chatId: "oc_target",
                agentSessionId,
                ...args,
              },
            };
          },
        }),
      },
    );

    assert.equal(observedAgentSessionId, "thread_a");
    assert.deepEqual(observedArgs, {
      imagePath: "/tmp/lark-connect/screen.png",
      replyToMessageId: "om_original",
      replyInThread: true,
    });
    assert.deepEqual(parseToolJson(response), {
      message: {
        id: "om_image",
        larkMessageId: "om_image",
        chatId: "oc_target",
        agentSessionId: "thread_a",
        imagePath: "/tmp/lark-connect/screen.png",
        replyToMessageId: "om_original",
        replyInThread: true,
      },
    });
  });

  it("forwards video send calls to the local daemon client", async () => {
    let observedAgentSessionId;
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_send_video", {
        agentSessionId: "thread_a",
        videoPath: "/tmp/lark-connect/demo.mp4",
        coverImagePath: "/tmp/lark-connect/demo-cover.png",
        replyToMessageId: "om_original",
        replyInThread: true,
      }),
      {
        createDaemonHttpClientImpl: () => ({
          sendVideo: async (agentSessionId, args) => {
            observedAgentSessionId = agentSessionId;
            observedArgs = args;
            return {
              message: {
                id: "om_video",
                larkMessageId: "om_video",
                chatId: "oc_target",
                agentSessionId,
                coverImageKey: "img_cover",
                ...args,
              },
            };
          },
        }),
      },
    );

    assert.equal(observedAgentSessionId, "thread_a");
    assert.deepEqual(observedArgs, {
      videoPath: "/tmp/lark-connect/demo.mp4",
      coverImagePath: "/tmp/lark-connect/demo-cover.png",
      replyToMessageId: "om_original",
      replyInThread: true,
    });
    assert.deepEqual(parseToolJson(response), {
      message: {
        id: "om_video",
        larkMessageId: "om_video",
        chatId: "oc_target",
        agentSessionId: "thread_a",
        videoPath: "/tmp/lark-connect/demo.mp4",
        coverImagePath: "/tmp/lark-connect/demo-cover.png",
        coverImageKey: "img_cover",
        replyToMessageId: "om_original",
        replyInThread: true,
      },
    });
  });

  it("forwards resource download calls to the local daemon client", async () => {
    let observedAgentSessionId;
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_download_resource", {
        agentSessionId: "thread_a",
        messageId: "om_resource",
        fileKey: "img_1",
        outputDir: "/tmp/lark-connect-downloads",
      }),
      {
        createDaemonHttpClientImpl: () => ({
          downloadResource: async (agentSessionId, args) => {
            observedAgentSessionId = agentSessionId;
            observedArgs = args;
            return {
              download: {
                agentSessionId,
                messageId: args.messageId,
                fileKey: args.fileKey,
                resourceType: "image",
                fileName: "screen.png",
                filePath: "/tmp/lark-connect-downloads/screen.png",
                size: 12,
              },
            };
          },
        }),
      },
    );

    assert.equal(observedAgentSessionId, "thread_a");
    assert.deepEqual(observedArgs, {
      messageId: "om_resource",
      fileKey: "img_1",
      outputDir: "/tmp/lark-connect-downloads",
    });
    assert.deepEqual(parseToolJson(response), {
      download: {
        agentSessionId: "thread_a",
        messageId: "om_resource",
        fileKey: "img_1",
        resourceType: "image",
        fileName: "screen.png",
        filePath: "/tmp/lark-connect-downloads/screen.png",
        size: 12,
      },
    });
  });
});
