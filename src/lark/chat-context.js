import { createDefaultLarkChannel, requireLarkAppConfig } from "./channel.js";
import { DEFAULT_LARK_REQUEST_TIMEOUT_MS, withTimeout } from "./timeouts.js";

export const DEFAULT_CHAT_CONTEXT_LIMIT = 10;
export const MAX_CHAT_CONTEXT_LIMIT = 50;
const DEFAULT_CHAT_CONTEXT_TIMEOUT_MS = DEFAULT_LARK_REQUEST_TIMEOUT_MS;

function normalizeRequiredString(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${fieldName} is required`);
  return text;
}

function normalizeOptionalString(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function normalizeLimit(value) {
  if (value === undefined) return DEFAULT_CHAT_CONTEXT_LIMIT;

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHAT_CONTEXT_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_CHAT_CONTEXT_LIMIT}`);
  }
  return limit;
}

function parseContent(rawContent) {
  if (rawContent === undefined) return undefined;
  if (typeof rawContent !== "string") return rawContent;

  try {
    return JSON.parse(rawContent);
  } catch {
    return rawContent;
  }
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (typeof content?.text === "string") return content.text;
  return undefined;
}

function normalizeSender(sender = {}) {
  return {
    id: sender.id,
    idType: sender.id_type,
    type: sender.sender_type,
    name: sender.sender_name,
  };
}

function normalizeMention(mention = {}) {
  return {
    key: mention.key,
    id: mention.id,
    idType: mention.id_type,
    name: mention.name,
  };
}

function normalizeMessage(item = {}) {
  const content = parseContent(item.body?.content);
  return {
    messageId: item.message_id,
    larkMessageId: item.message_id,
    chatId: item.chat_id,
    sender: normalizeSender(item.sender),
    msgType: item.msg_type,
    text: extractText(content),
    content,
    createTime: item.create_time,
    updateTime: item.update_time,
    rootId: item.root_id,
    replyToMessageId: item.parent_id,
    threadId: item.thread_id,
    mentions: (item.mentions ?? []).map(normalizeMention),
    deleted: item.deleted,
    updated: item.updated,
  };
}

export async function createLarkChatContextClient(config, options = {}) {
  requireLarkAppConfig(config, "chat context");

  const channelFactory = options.channelFactory ?? createDefaultLarkChannel;
  const channel = await channelFactory(config);
  const chatContextTimeoutMs =
    options.chatContextTimeoutMs ?? DEFAULT_CHAT_CONTEXT_TIMEOUT_MS;

  return {
    async getChatContext(input = {}) {
      const chatId = normalizeRequiredString(input.chatId, "chatId");
      const limit = normalizeLimit(input.limit);
      const pageToken = normalizeOptionalString(input.pageToken);

      if (!channel.rawClient?.im?.v1?.message?.list) {
        throw new Error("Feishu message history client is unavailable");
      }

      const params = {
        container_id_type: "chat",
        container_id: chatId,
        page_size: limit,
        sort_type: "ByCreateTimeDesc",
      };
      if (pageToken) params.page_token = pageToken;

      const result = await withTimeout(
        channel.rawClient.im.v1.message.list({ params }),
        chatContextTimeoutMs,
        `Feishu chat context timed out after ${chatContextTimeoutMs}ms`,
      );
      const data = result?.data ?? {};
      const messages = (data.items ?? [])
        .map(normalizeMessage)
        .filter((message) => message.messageId);

      return {
        chatId,
        limit,
        messages,
        hasMore: Boolean(data.has_more ?? data.hasMore),
        pageToken: normalizeOptionalString(data.page_token ?? data.next_page_token) ?? "",
      };
    },

    async close() {
      await channel.disconnect?.();
    },
  };
}
