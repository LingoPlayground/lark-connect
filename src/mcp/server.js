import { readFileSync } from "node:fs";

import { resolveConfig } from "../config.js";
import { createDaemonHttpClient } from "../daemon/http-client.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

const TOOLS = [
  {
    name: "lark_connect_daemon_status",
    description: "Read the local lark-connect daemon status.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "lark_connect_search_chats",
    description:
      "Search Feishu group chats visible to the configured bot before binding a session.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Group chat name keyword to search." },
        pageSize: { type: "number", description: "Maximum number of chats to return." },
        pageToken: { type: "string", description: "Optional pagination token from a prior search." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "lark_connect_wait_direct_chat_signal",
    description:
      "Wait for a user to send an exact challenge text to the configured bot in a Feishu direct chat, then return the discovered p2p chat_id for explicit binding.",
    inputSchema: {
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
    },
  },
  {
    name: "lark_connect_bind_session",
    description: "Bind one Feishu chat to the current Codex or Claude Code session.",
    inputSchema: {
      type: "object",
      properties: {
        chatId: { type: "string", description: "Feishu chat_id, for example oc_xxx." },
        agentKind: { type: "string", description: "Agent runtime, for example codex or claude-code." },
        agentSessionId: { type: "string", description: "Codex thread id or Claude Code session id." },
        workspace: { type: "string", description: "Absolute workspace path for this agent session." },
        replace: { type: "boolean", description: "Replace an existing binding for the same chat." },
      },
      required: ["chatId", "agentKind", "agentSessionId", "workspace"],
      additionalProperties: false,
    },
  },
  {
    name: "lark_connect_get_chat_context",
    description:
      "Read recent messages from the Feishu chat bound to one Codex or Claude Code session. Defaults to the latest 10 messages, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        agentSessionId: { type: "string", description: "Codex thread id or Claude Code session id." },
        limit: {
          type: "number",
          description: "Maximum number of recent chat messages to return. Defaults to 10.",
        },
        pageToken: { type: "string", description: "Optional pagination token from a prior context read." },
      },
      required: ["agentSessionId"],
      additionalProperties: false,
    },
  },
  {
    name: "lark_connect_get_chat_members",
    description:
      "Read human members and group bots from the Feishu chat bound to one Codex or Claude Code session. Bot results come from the Feishu members/bots API and include bot open_id values.",
    inputSchema: {
      type: "object",
      properties: {
        agentSessionId: { type: "string", description: "Codex thread id or Claude Code session id." },
        pageSize: {
          type: "number",
          description: "Maximum number of human members to return. Defaults to 50.",
        },
        pageToken: { type: "string", description: "Optional pagination token from a prior member read." },
      },
      required: ["agentSessionId"],
      additionalProperties: false,
    },
  },
  {
    name: "lark_connect_poll_messages",
    description: "Immediately poll pending Feishu messages for one bound agent session.",
    inputSchema: {
      type: "object",
      properties: {
        agentSessionId: { type: "string", description: "Codex thread id or Claude Code session id." },
      },
      required: ["agentSessionId"],
      additionalProperties: false,
    },
  },
  {
    name: "lark_connect_wait_messages",
    description: "Wait briefly for Feishu messages for one bound agent session.",
    inputSchema: {
      type: "object",
      properties: {
        agentSessionId: { type: "string", description: "Codex thread id or Claude Code session id." },
        timeoutMs: { type: "number", description: "Maximum wait time in milliseconds." },
      },
      required: ["agentSessionId"],
      additionalProperties: false,
    },
  },
  {
    name: "lark_connect_ack_message",
    description:
      "Acknowledge one delivered Feishu message and add an OK reaction to the original message.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "Message id returned by poll or wait." },
        agentSessionId: { type: "string", description: "Optional owning agent session id." },
      },
      required: ["messageId", "agentSessionId"],
      additionalProperties: false,
    },
  },
  {
    name: "lark_connect_send_message",
    description:
      "Send text to the bound Feishu chat. Supports replying to a message, mentioning humans or bots, and mention-only messages.",
    inputSchema: {
      type: "object",
      properties: {
        agentSessionId: { type: "string", description: "Codex thread id or Claude Code session id." },
        text: { type: "string", description: "Plain text to send. Optional when mentions are provided." },
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
    },
  },
  {
    name: "lark_connect_send_file",
    description:
      "Send a local file to the Feishu chat bound to one Codex or Claude Code session.",
    inputSchema: {
      type: "object",
      properties: {
        agentSessionId: { type: "string", description: "Codex thread id or Claude Code session id." },
        filePath: { type: "string", description: "Local path to the file to send." },
        fileName: { type: "string", description: "Optional display name in Feishu." },
        replyToMessageId: { type: "string", description: "Optional Feishu message id to reply to." },
        replyInThread: { type: "boolean", description: "Whether to reply inside a Feishu thread." },
      },
      required: ["agentSessionId", "filePath"],
      additionalProperties: false,
    },
  },
  {
    name: "lark_connect_send_image",
    description:
      "Send a local image to the Feishu chat bound to one Codex or Claude Code session.",
    inputSchema: {
      type: "object",
      properties: {
        agentSessionId: { type: "string", description: "Codex thread id or Claude Code session id." },
        imagePath: { type: "string", description: "Local image path to send." },
        replyToMessageId: { type: "string", description: "Optional Feishu message id to reply to." },
        replyInThread: { type: "boolean", description: "Whether to reply inside a Feishu thread." },
      },
      required: ["agentSessionId", "imagePath"],
      additionalProperties: false,
    },
  },
  {
    name: "lark_connect_send_video",
    description:
      "Send a local video to the Feishu chat bound to one Codex or Claude Code session. A local cover image is required.",
    inputSchema: {
      type: "object",
      properties: {
        agentSessionId: { type: "string", description: "Codex thread id or Claude Code session id." },
        videoPath: { type: "string", description: "Local video path to send." },
        coverImagePath: { type: "string", description: "Local image path used as the Feishu video cover." },
        replyToMessageId: { type: "string", description: "Optional Feishu message id to reply to." },
        replyInThread: { type: "boolean", description: "Whether to reply inside a Feishu thread." },
      },
      required: ["agentSessionId", "videoPath", "coverImagePath"],
      additionalProperties: false,
    },
  },
  {
    name: "lark_connect_download_resource",
    description:
      "Download an image or file resource from a Feishu message received by one bound session.",
    inputSchema: {
      type: "object",
      properties: {
        agentSessionId: { type: "string", description: "Codex thread id or Claude Code session id." },
        messageId: { type: "string", description: "Message id returned by poll or wait." },
        fileKey: { type: "string", description: "Resource file_key from the message resources list." },
        outputDir: { type: "string", description: "Optional local directory to write the file into." },
      },
      required: ["agentSessionId", "messageId", "fileKey"],
      additionalProperties: false,
    },
  },
];

function encodeMessage(message) {
  return `${JSON.stringify(message)}\n`;
}

function decodeMessages(state, chunk) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  const messages = [];

  while (true) {
    const newlineIndex = state.buffer.indexOf("\n");
    if (newlineIndex === -1) return messages;

    const line = state.buffer.subarray(0, newlineIndex).toString("utf8").replace(/\r$/, "");
    state.buffer = state.buffer.subarray(newlineIndex + 1);
    if (line.length === 0) continue;

    try {
      messages.push(JSON.parse(line));
    } catch (error) {
      messages.push({
        __parseError: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function makeResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function makeError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonResult(value, options = {}) {
  return {
    isError: options.isError,
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorPayload(error) {
  const payload = {
    code: error?.code ?? "TOOL_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
  if (error?.command) payload.command = error.command;
  if (error?.details) payload.details = error.details;
  return payload;
}

function createDaemonClient(runtime) {
  const config = resolveConfig({}, runtime.env ?? process.env);
  const createClient = runtime.createDaemonHttpClientImpl ?? createDaemonHttpClient;
  return createClient({
    host: config.daemonHost,
    port: config.daemonPort,
  });
}

async function handleToolCall(params, runtime) {
  const args = params.arguments ?? {};

  if (!TOOLS.some((tool) => tool.name === params?.name)) {
    throw new Error(`unknown tool: ${params?.name ?? ""}`);
  }

  const client = createDaemonClient(runtime);
  try {
    if (params?.name === "lark_connect_daemon_status") {
      return jsonResult(await client.status());
    }

    if (params?.name === "lark_connect_bind_session") {
      return jsonResult(await client.bindSession(args));
    }

    if (params?.name === "lark_connect_search_chats") {
      return jsonResult(
        await client.searchChats({
          query: args.query,
          pageSize: args.pageSize,
          pageToken: args.pageToken,
        }),
      );
    }

    if (params?.name === "lark_connect_wait_direct_chat_signal") {
      return jsonResult(
        await client.waitDirectChatSignal({
          challengeText: args.challengeText,
          agentKind: args.agentKind,
          agentSessionId: args.agentSessionId,
          workspace: args.workspace,
          timeoutMs: args.timeoutMs,
        }),
      );
    }

    if (params?.name === "lark_connect_get_chat_context") {
      return jsonResult(
        await client.getChatContext(args.agentSessionId, {
          limit: args.limit,
          pageToken: args.pageToken,
        }),
      );
    }

    if (params?.name === "lark_connect_get_chat_members") {
      return jsonResult(
        await client.getChatMembers(args.agentSessionId, {
          pageSize: args.pageSize,
          pageToken: args.pageToken,
        }),
      );
    }

    if (params?.name === "lark_connect_poll_messages") {
      return jsonResult(await client.pollMessages(args.agentSessionId, { clientKind: "mcp" }));
    }

    if (params?.name === "lark_connect_wait_messages") {
      return jsonResult(
        await client.waitForMessages(args.agentSessionId, {
          timeoutMs: args.timeoutMs,
          clientKind: "mcp",
        }),
      );
    }

    if (params?.name === "lark_connect_ack_message") {
      return jsonResult(
        await client.ackMessage(args.messageId, { agentSessionId: args.agentSessionId }),
      );
    }

    if (params?.name === "lark_connect_send_message") {
      return jsonResult(
        await client.sendMessage(args.agentSessionId, {
          text: args.text,
          mentions: args.mentions,
          replyToMessageId: args.replyToMessageId,
          replyInThread: args.replyInThread,
        }),
      );
    }

    if (params?.name === "lark_connect_send_file") {
      return jsonResult(
        await client.sendFile(args.agentSessionId, {
          filePath: args.filePath,
          fileName: args.fileName,
          replyToMessageId: args.replyToMessageId,
          replyInThread: args.replyInThread,
        }),
      );
    }

    if (params?.name === "lark_connect_send_image") {
      return jsonResult(
        await client.sendImage(args.agentSessionId, {
          imagePath: args.imagePath,
          replyToMessageId: args.replyToMessageId,
          replyInThread: args.replyInThread,
        }),
      );
    }

    if (params?.name === "lark_connect_send_video") {
      return jsonResult(
        await client.sendVideo(args.agentSessionId, {
          videoPath: args.videoPath,
          coverImagePath: args.coverImagePath,
          replyToMessageId: args.replyToMessageId,
          replyInThread: args.replyInThread,
        }),
      );
    }

    if (params?.name === "lark_connect_download_resource") {
      return jsonResult(
        await client.downloadResource(args.agentSessionId, {
          messageId: args.messageId,
          fileKey: args.fileKey,
          outputDir: args.outputDir,
        }),
      );
    }
  } catch (error) {
    if (error?.code) {
      return jsonResult(errorPayload(error), { isError: true });
    }
    throw error;
  }

  throw new Error(`unknown tool: ${params?.name ?? ""}`);
}

export async function handleMcpMessage(message, runtime = {}) {
  if (message.method === "notifications/initialized") {
    return null;
  }

  try {
    if (message.method === "initialize") {
      return makeResult(message.id, {
        protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "curiosea-lark-connect",
          version: packageJson.version,
        },
      });
    }

    if (message.method === "tools/list") {
      return makeResult(message.id, { tools: TOOLS });
    }

    if (message.method === "tools/call") {
      return makeResult(message.id, await handleToolCall(message.params, runtime));
    }

    return makeError(message.id, -32601, `method not found: ${message.method}`);
  } catch (error) {
    return makeError(message.id, -32602, error instanceof Error ? error.message : String(error));
  }
}

export async function runMcpServer({ input, output }) {
  const state = { buffer: Buffer.alloc(0) };

  for await (const chunk of input) {
    const messages = decodeMessages(state, chunk);
    for (const message of messages) {
      const response = message.__parseError
        ? makeError(null, -32700, `parse error: ${message.__parseError}`)
        : await handleMcpMessage(message);
      if (response) {
        output.write(encodeMessage(response));
      }
    }
  }
}
