import { createServer } from "node:http";

import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from "../config.js";
import { MAX_CHAT_SEARCH_PAGE_SIZE } from "../lark/chats.js";
import { DEFAULT_ACK_REACTION_EMOJI_TYPE } from "../lark/reactions.js";
import { createDaemonRuntime } from "./runtime.js";
import { DAEMON_ERROR_CODES, DaemonRuntimeError } from "./errors.js";

function statusForError(error) {
  if (error instanceof DaemonRuntimeError) {
    if (error.code === DAEMON_ERROR_CODES.BINDING_CONFLICT) return 409;
    if (error.code === DAEMON_ERROR_CODES.SESSION_NOT_BOUND) return 404;
    if (error.code === DAEMON_ERROR_CODES.MESSAGE_NOT_FOUND) return 404;
    if (error.code === DAEMON_ERROR_CODES.RESOURCE_NOT_FOUND) return 404;
    return 400;
  }
  if (error?.code === DAEMON_ERROR_CODES.NOT_FOUND) return 404;
  if (error?.code === DAEMON_ERROR_CODES.INVALID_REQUEST) return 400;
  if (error?.code === DAEMON_ERROR_CODES.LARK_REACTION_FAILED) return 502;
  if (error?.code === DAEMON_ERROR_CODES.LARK_SEND_FAILED) return 502;
  if (error?.code === DAEMON_ERROR_CODES.LARK_CHAT_SEARCH_FAILED) return 502;
  if (error?.code === DAEMON_ERROR_CODES.LARK_RESOURCE_DOWNLOAD_FAILED) return 502;
  return 500;
}

function errorBody(error) {
  if (error instanceof DaemonRuntimeError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  return {
    error: {
      code: error?.code ?? DAEMON_ERROR_CODES.INTERNAL_ERROR,
      message: error?.message ?? "daemon request failed",
      details: error?.details,
    },
  };
}

function sendJson(response, statusCode, body) {
  const json = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  response.end(json);
}

function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function notFound(pathname) {
  const error = new Error(`route not found: ${pathname}`);
  error.code = DAEMON_ERROR_CODES.NOT_FOUND;
  return error;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (cause) {
    const error = new Error("request body must be valid JSON");
    error.code = DAEMON_ERROR_CODES.INVALID_REQUEST;
    error.cause = cause;
    throw error;
  }
}

function routeSessionMessages(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "sessions" || parts[2] !== "messages") return undefined;
  if (parts.length !== 3 && parts.length !== 4) return undefined;
  if (parts.length === 4 && parts[3] !== "wait") return undefined;
  return {
    agentSessionId: decodeURIComponent(parts[1]),
    wait: parts.length === 4,
  };
}

function routeSessionSendMessage(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "sessions" || parts[2] !== "send-message" || parts.length !== 3) {
    return undefined;
  }
  return {
    agentSessionId: decodeURIComponent(parts[1]),
  };
}

function routeSessionSendFile(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "sessions" || parts[2] !== "send-file" || parts.length !== 3) {
    return undefined;
  }
  return {
    agentSessionId: decodeURIComponent(parts[1]),
  };
}

function routeSessionSendImage(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "sessions" || parts[2] !== "send-image" || parts.length !== 3) {
    return undefined;
  }
  return {
    agentSessionId: decodeURIComponent(parts[1]),
  };
}

function routeSessionSendVideo(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "sessions" || parts[2] !== "send-video" || parts.length !== 3) {
    return undefined;
  }
  return {
    agentSessionId: decodeURIComponent(parts[1]),
  };
}

function routeSessionDownloadResource(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (
    parts[0] !== "sessions" ||
    parts[2] !== "resources" ||
    parts[3] !== "download" ||
    parts.length !== 4
  ) {
    return undefined;
  }
  return {
    agentSessionId: decodeURIComponent(parts[1]),
  };
}

function routeAck(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "messages" || parts[2] !== "ack" || parts.length !== 3) {
    return undefined;
  }
  return {
    messageId: decodeURIComponent(parts[1]),
  };
}

function createSessionNotBoundError(agentSessionId) {
  return new DaemonRuntimeError(
    DAEMON_ERROR_CODES.SESSION_NOT_BOUND,
    `No Feishu chat is bound to agentSessionId ${agentSessionId}. Call lark_connect_bind_session first.`,
    { agentSessionId },
  );
}

function waitTimeoutNextSteps(agentSessionId) {
  return [
    "没有收到新消息。继续调用 lark_connect_wait_messages 做下一轮短等待，或建立约 5 分钟的心跳。",
    "Codex 使用 thread automation 定时唤醒；Claude Code 使用 background shell 调用 curiosea-lark-connect wait --agent-session-id <绑定时使用的 agentSessionId> --timeout-ms 300000。",
    `除非有人明确要求停止，不要把 agentSessionId ${agentSessionId} 的这次超时当作监听结束。`,
  ];
}

function waitMessagesBody(agentSessionId, messages) {
  const body = { messages };
  if (messages.length === 0) {
    body.nextSteps = waitTimeoutNextSteps(agentSessionId);
  }
  return body;
}

function requireBoundChat(runtime, agentSessionId) {
  const binding = runtime
    .getStatus()
    .bindings.find((item) => item.agentSessionId === agentSessionId);
  if (!binding) throw createSessionNotBoundError(agentSessionId);
  return binding.chatId;
}

function requireText(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    const error = new Error("text is required");
    error.code = DAEMON_ERROR_CODES.INVALID_REQUEST;
    throw error;
  }
  return text;
}

function requireFilePath(value) {
  const filePath = String(value ?? "").trim();
  if (!filePath) {
    const error = new Error("filePath is required");
    error.code = DAEMON_ERROR_CODES.INVALID_REQUEST;
    throw error;
  }
  return filePath;
}

function requireString(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!text) {
    const error = new Error(`${fieldName} is required`);
    error.code = DAEMON_ERROR_CODES.INVALID_REQUEST;
    throw error;
  }
  return text;
}

function requireObjectBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("request body must be a JSON object");
    error.code = DAEMON_ERROR_CODES.INVALID_REQUEST;
    throw error;
  }
  return body;
}

function normalizeDirectChatSignalWaitBody(body) {
  const input = requireObjectBody(body);
  return {
    challengeText: input.challengeText,
    agentKind: input.agentKind,
    agentSessionId: input.agentSessionId,
    workspace: input.workspace,
    timeoutMs: input.timeoutMs,
  };
}

function requireStringField(value, fieldName) {
  if (typeof value !== "string") {
    const error = new Error(`${fieldName} must be a string`);
    error.code = DAEMON_ERROR_CODES.INVALID_REQUEST;
    throw error;
  }
  return requireString(value, fieldName);
}

function normalizeOptionalStringField(value, fieldName) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    const error = new Error(`${fieldName} must be a string`);
    error.code = DAEMON_ERROR_CODES.INVALID_REQUEST;
    throw error;
  }
  return value.trim() || undefined;
}

function normalizeOptionalChatSearchPageSize(value) {
  if (value === undefined) return undefined;

  const pageSize = Number(value);
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_CHAT_SEARCH_PAGE_SIZE
  ) {
    const error = new Error(
      `pageSize must be an integer between 1 and ${MAX_CHAT_SEARCH_PAGE_SIZE}`,
    );
    error.code = DAEMON_ERROR_CODES.INVALID_REQUEST;
    throw error;
  }

  return pageSize;
}

function createReactionError(cause, message, emojiType) {
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(
    `failed to add Feishu reaction ${emojiType} to message ${message.larkMessageId}: ${causeMessage}`,
  );
  error.code = DAEMON_ERROR_CODES.LARK_REACTION_FAILED;
  error.cause = cause;
  error.details = {
    messageId: message.id,
    larkMessageId: message.larkMessageId,
    emojiType,
  };
  return error;
}

function createSendError(cause, agentSessionId, chatId) {
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(`failed to send Feishu message to chat ${chatId}: ${causeMessage}`);
  error.code = DAEMON_ERROR_CODES.LARK_SEND_FAILED;
  error.cause = cause;
  error.details = {
    agentSessionId,
    chatId,
  };
  return error;
}

function createChatSearchError(cause, query) {
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(`failed to search Feishu chats for ${query}: ${causeMessage}`);
  error.code = DAEMON_ERROR_CODES.LARK_CHAT_SEARCH_FAILED;
  error.cause = cause;
  error.details = {
    query,
  };
  return error;
}

function createResourceDownloadError(cause, agentSessionId, messageId, fileKey) {
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(
    `failed to download Feishu resource ${fileKey} from message ${messageId}: ${causeMessage}`,
  );
  error.code = DAEMON_ERROR_CODES.LARK_RESOURCE_DOWNLOAD_FAILED;
  error.cause = cause;
  error.details = {
    agentSessionId,
    messageId,
    fileKey,
  };
  return error;
}

function ensureSupportedResource(resource) {
  if (resource.type === "image" || resource.type === "file") return;

  const error = new Error(`resource type ${resource.type ?? ""} is not supported`);
  error.code = DAEMON_ERROR_CODES.INVALID_REQUEST;
  error.details = {
    fileKey: resource.fileKey,
    resourceType: resource.type,
  };
  throw error;
}

async function addAckReaction(reactionClient, message, emojiType) {
  if (!reactionClient) return undefined;

  try {
    return await reactionClient.addMessageReaction(message.larkMessageId, emojiType);
  } catch (cause) {
    throw createReactionError(cause, message, emojiType);
  }
}

async function sendTextMessage(messageClient, agentSessionId, chatId, body) {
  if (!messageClient) {
    throw createSendError(new Error("message client is unavailable"), agentSessionId, chatId);
  }

  try {
    const sent = await messageClient.sendTextMessage({
      chatId,
      text: requireText(body.text),
      replyToMessageId: body.replyToMessageId,
      replyInThread: body.replyInThread,
    });
    const message = {
      id: sent.messageId,
      larkMessageId: sent.messageId,
      chatId,
      agentSessionId,
      text: sent.text,
    };
    if (sent.replyToMessageId !== undefined) message.replyToMessageId = sent.replyToMessageId;
    if (sent.replyInThread !== undefined) message.replyInThread = sent.replyInThread;
    if (sent.chunkIds) message.chunkIds = sent.chunkIds;
    return message;
  } catch (cause) {
    if (cause?.code === DAEMON_ERROR_CODES.INVALID_REQUEST) throw cause;
    throw createSendError(cause, agentSessionId, chatId);
  }
}

async function searchChats(chatClient, body) {
  const input = requireObjectBody(body);
  const query = requireStringField(input.query, "query");
  const pageSize = normalizeOptionalChatSearchPageSize(input.pageSize);
  const pageToken = normalizeOptionalStringField(input.pageToken, "pageToken");

  if (!chatClient?.searchChats) {
    throw createChatSearchError(new Error("chat search client is unavailable"), query);
  }

  try {
    return await chatClient.searchChats({
      query,
      pageSize,
      pageToken,
    });
  } catch (cause) {
    if (cause?.code === DAEMON_ERROR_CODES.INVALID_REQUEST) throw cause;
    throw createChatSearchError(cause, query);
  }
}

async function sendFileMessage(messageClient, agentSessionId, chatId, body) {
  if (!messageClient?.sendFileMessage) {
    throw createSendError(new Error("file message client is unavailable"), agentSessionId, chatId);
  }

  try {
    const sent = await messageClient.sendFileMessage({
      chatId,
      filePath: requireFilePath(body.filePath),
      fileName: body.fileName,
      replyToMessageId: body.replyToMessageId,
      replyInThread: body.replyInThread,
    });
    const message = {
      id: sent.messageId,
      larkMessageId: sent.messageId,
      chatId,
      agentSessionId,
      filePath: sent.filePath,
      fileName: sent.fileName,
    };
    if (sent.replyToMessageId !== undefined) message.replyToMessageId = sent.replyToMessageId;
    if (sent.replyInThread !== undefined) message.replyInThread = sent.replyInThread;
    if (sent.chunkIds) message.chunkIds = sent.chunkIds;
    return message;
  } catch (cause) {
    if (cause?.code === DAEMON_ERROR_CODES.INVALID_REQUEST) throw cause;
    throw createSendError(cause, agentSessionId, chatId);
  }
}

async function sendImageMessage(messageClient, agentSessionId, chatId, body) {
  if (!messageClient?.sendImageMessage) {
    throw createSendError(new Error("image message client is unavailable"), agentSessionId, chatId);
  }

  try {
    const sent = await messageClient.sendImageMessage({
      chatId,
      imagePath: requireString(body.imagePath, "imagePath"),
      replyToMessageId: body.replyToMessageId,
      replyInThread: body.replyInThread,
    });
    const message = {
      id: sent.messageId,
      larkMessageId: sent.messageId,
      chatId,
      agentSessionId,
      imagePath: sent.imagePath,
    };
    if (sent.replyToMessageId !== undefined) message.replyToMessageId = sent.replyToMessageId;
    if (sent.replyInThread !== undefined) message.replyInThread = sent.replyInThread;
    if (sent.chunkIds) message.chunkIds = sent.chunkIds;
    return message;
  } catch (cause) {
    if (cause?.code === DAEMON_ERROR_CODES.INVALID_REQUEST) throw cause;
    throw createSendError(cause, agentSessionId, chatId);
  }
}

async function sendVideoMessage(messageClient, agentSessionId, chatId, body) {
  if (!messageClient?.sendVideoMessage) {
    throw createSendError(new Error("video message client is unavailable"), agentSessionId, chatId);
  }

  try {
    const sent = await messageClient.sendVideoMessage({
      chatId,
      videoPath: requireString(body.videoPath, "videoPath"),
      coverImagePath: requireString(body.coverImagePath, "coverImagePath"),
      replyToMessageId: body.replyToMessageId,
      replyInThread: body.replyInThread,
    });
    const message = {
      id: sent.messageId,
      larkMessageId: sent.messageId,
      chatId,
      agentSessionId,
      videoPath: sent.videoPath,
      coverImagePath: sent.coverImagePath,
      coverImageKey: sent.coverImageKey,
    };
    if (sent.replyToMessageId !== undefined) message.replyToMessageId = sent.replyToMessageId;
    if (sent.replyInThread !== undefined) message.replyInThread = sent.replyInThread;
    if (sent.chunkIds) message.chunkIds = sent.chunkIds;
    return message;
  } catch (cause) {
    if (cause?.code === DAEMON_ERROR_CODES.INVALID_REQUEST) throw cause;
    throw createSendError(cause, agentSessionId, chatId);
  }
}

async function downloadResource(resourceClient, agentSessionId, body, resourceMatch) {
  if (!resourceClient?.downloadResource) {
    throw createResourceDownloadError(
      new Error("resource client is unavailable"),
      agentSessionId,
      body.messageId,
      body.fileKey,
    );
  }

  ensureSupportedResource(resourceMatch.resource);

  try {
    return await resourceClient.downloadResource({
      agentSessionId,
      messageId: resourceMatch.message.id,
      resource: resourceMatch.resource,
      outputDir: body.outputDir,
    });
  } catch (cause) {
    if (cause?.code === DAEMON_ERROR_CODES.INVALID_REQUEST) throw cause;
    throw createResourceDownloadError(cause, agentSessionId, body.messageId, body.fileKey);
  }
}

export function createDaemonHttpServer(options = {}) {
  const runtime = options.runtime ?? createDaemonRuntime(options.runtimeOptions);
  const host = options.host ?? DEFAULT_DAEMON_HOST;
  const port = options.port ?? DEFAULT_DAEMON_PORT;
  const reactionClient = options.reactionClient;
  const messageClient = options.messageClient;
  const chatClient = options.chatClient;
  const resourceClient = options.resourceClient;
  const ackReactionEmojiType = options.ackReactionEmojiType ?? DEFAULT_ACK_REACTION_EMOJI_TYPE;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? host}`);
      const { pathname } = url;

      if (request.method === "GET" && pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && pathname === "/status") {
        sendJson(response, 200, runtime.getStatus());
        return;
      }

      if (request.method === "POST" && pathname === "/bindings") {
        const body = await readJsonBody(request);
        sendJson(response, 201, { binding: runtime.bindSession(body) });
        return;
      }

      if (request.method === "POST" && pathname === "/chats/search") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await searchChats(chatClient, body));
        return;
      }

      if (request.method === "POST" && pathname === "/direct-chat/signals/wait") {
        const body = await readJsonBody(request);
        const signal = await runtime.waitForDirectChatSignal(
          normalizeDirectChatSignalWaitBody(body),
        );
        sendJson(response, 200, { signal });
        return;
      }

      if (request.method === "POST" && pathname === "/shutdown") {
        runtime.getStatus();
        sendJson(response, 200, { state: "stopping" });
        queueMicrotask(() => {
          options.onShutdown?.();
        });
        return;
      }

      const messagesRoute = routeSessionMessages(pathname);
      if (request.method === "GET" && messagesRoute) {
        if (messagesRoute.wait) {
          const timeoutMs = Number(url.searchParams.get("timeout_ms") ?? 30_000);
          const messages = await runtime.waitForMessages(messagesRoute.agentSessionId, {
            timeoutMs,
          });
          sendJson(response, 200, waitMessagesBody(messagesRoute.agentSessionId, messages));
          return;
        }

        sendJson(response, 200, {
          messages: runtime.pollMessages(messagesRoute.agentSessionId),
        });
        return;
      }

      const ackRoute = routeAck(pathname);
      if (request.method === "POST" && ackRoute) {
        const body = await readJsonBody(request);
        const pendingMessage = runtime.getMessageForAck(ackRoute.messageId, body);
        const reaction = await addAckReaction(
          reactionClient,
          pendingMessage,
          ackReactionEmojiType,
        );
        const message = runtime.ackMessage(ackRoute.messageId, body);
        sendJson(response, 200, {
          message,
          reaction,
        });
        return;
      }

      const sendRoute = routeSessionSendMessage(pathname);
      if (request.method === "POST" && sendRoute) {
        const body = await readJsonBody(request);
        const chatId = requireBoundChat(runtime, sendRoute.agentSessionId);
        const message = await sendTextMessage(
          messageClient,
          sendRoute.agentSessionId,
          chatId,
          body,
        );
        sendJson(response, 200, { message });
        return;
      }

      const sendFileRoute = routeSessionSendFile(pathname);
      if (request.method === "POST" && sendFileRoute) {
        const body = await readJsonBody(request);
        const chatId = requireBoundChat(runtime, sendFileRoute.agentSessionId);
        const message = await sendFileMessage(
          messageClient,
          sendFileRoute.agentSessionId,
          chatId,
          body,
        );
        sendJson(response, 200, { message });
        return;
      }

      const sendImageRoute = routeSessionSendImage(pathname);
      if (request.method === "POST" && sendImageRoute) {
        const body = await readJsonBody(request);
        const chatId = requireBoundChat(runtime, sendImageRoute.agentSessionId);
        const message = await sendImageMessage(
          messageClient,
          sendImageRoute.agentSessionId,
          chatId,
          body,
        );
        sendJson(response, 200, { message });
        return;
      }

      const sendVideoRoute = routeSessionSendVideo(pathname);
      if (request.method === "POST" && sendVideoRoute) {
        const body = await readJsonBody(request);
        const chatId = requireBoundChat(runtime, sendVideoRoute.agentSessionId);
        const message = await sendVideoMessage(
          messageClient,
          sendVideoRoute.agentSessionId,
          chatId,
          body,
        );
        sendJson(response, 200, { message });
        return;
      }

      const downloadResourceRoute = routeSessionDownloadResource(pathname);
      if (request.method === "POST" && downloadResourceRoute) {
        const body = await readJsonBody(request);
        const messageId = requireString(body.messageId, "messageId");
        const fileKey = requireString(body.fileKey, "fileKey");
        const resourceMatch = runtime.findMessageResource(
          downloadResourceRoute.agentSessionId,
          messageId,
          fileKey,
        );
        const download = await downloadResource(
          resourceClient,
          downloadResourceRoute.agentSessionId,
          { ...body, messageId, fileKey },
          resourceMatch,
        );
        sendJson(response, 200, { download });
        return;
      }

      throw notFound(pathname);
    } catch (error) {
      sendJson(response, statusForError(error), errorBody(error));
    }
  });

  return {
    runtime,
    listen() {
      if (!isLoopbackHost(host)) {
        throw new Error("daemon host must be a loopback address");
      }
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          resolve({ host, port: address.port });
        });
      });
    },

    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },

    address() {
      const address = server.address();
      if (!address || typeof address === "string") return undefined;
      return { host, port: address.port };
    },
  };
}
