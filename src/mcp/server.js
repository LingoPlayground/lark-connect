import { resolveConfig } from "../config.js";
import { createDaemonHttpClient } from "../daemon/http-client.js";

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
    name: "lark_connect_bind_session",
    description: "Bind one Feishu group chat to the current Codex or Claude Code session.",
    inputSchema: {
      type: "object",
      properties: {
        chatId: { type: "string", description: "Feishu group chat_id, for example oc_xxx." },
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
    name: "lark_connect_poll_messages",
    description: "Immediately poll pending Feishu mention messages for one agent session.",
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
    description: "Wait briefly for Feishu mention messages for one agent session.",
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
      "Send a text message to the Feishu group bound to one Codex or Claude Code session.",
    inputSchema: {
      type: "object",
      properties: {
        agentSessionId: { type: "string", description: "Codex thread id or Claude Code session id." },
        text: { type: "string", description: "Plain text to send." },
        replyToMessageId: { type: "string", description: "Optional Feishu message id to reply to." },
        replyInThread: { type: "boolean", description: "Whether to reply inside a Feishu thread." },
      },
      required: ["agentSessionId", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "lark_connect_send_file",
    description:
      "Send a local file to the Feishu group bound to one Codex or Claude Code session.",
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
      "Send a local image to the Feishu group bound to one Codex or Claude Code session.",
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
      "Send a local video to the Feishu group bound to one Codex or Claude Code session. A local cover image is required.",
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

    if (params?.name === "lark_connect_poll_messages") {
      return jsonResult(await client.pollMessages(args.agentSessionId));
    }

    if (params?.name === "lark_connect_wait_messages") {
      return jsonResult(
        await client.waitForMessages(args.agentSessionId, { timeoutMs: args.timeoutMs }),
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
          version: "0.1.0",
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
