import { createDefaultLarkChannel, requireLarkAppConfig } from "./channel.js";
import { DEFAULT_LARK_REQUEST_TIMEOUT_MS, withTimeout } from "./timeouts.js";

const DEFAULT_CHAT_SEARCH_PAGE_SIZE = 20;
export const MAX_CHAT_SEARCH_PAGE_SIZE = 100;
const DEFAULT_CHAT_SEARCH_TIMEOUT_MS = DEFAULT_LARK_REQUEST_TIMEOUT_MS;

function normalizeQuery(value) {
  const query = String(value ?? "").trim();
  if (!query) throw new Error("query is required");
  return query;
}

function normalizePageSize(value) {
  if (value === undefined) return DEFAULT_CHAT_SEARCH_PAGE_SIZE;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CHAT_SEARCH_PAGE_SIZE) {
    throw new Error(`pageSize must be an integer between 1 and ${MAX_CHAT_SEARCH_PAGE_SIZE}`);
  }
  return parsed;
}

function normalizeOptionalString(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function normalizeChatItem(item = {}) {
  const chatId = normalizeOptionalString(item.chat_id ?? item.chatId);
  return {
    chatId,
    name: normalizeOptionalString(item.name),
    description: normalizeOptionalString(item.description),
    avatar: normalizeOptionalString(item.avatar),
    chatMode: normalizeOptionalString(item.chat_mode ?? item.chatMode),
    chatType: normalizeOptionalString(item.chat_type ?? item.chatType),
    chatStatus: normalizeOptionalString(item.chat_status ?? item.chatStatus),
    memberCount: item.member_count ?? item.memberCount,
    ownerId: normalizeOptionalString(item.owner_id ?? item.ownerId),
  };
}

function emptySearchNextSteps(query) {
  return [
    `没有找到名称匹配“${query}”且机器人可见的群聊。`,
    "请用户确认群名是否正确；如果目标群还不存在，请先创建群。",
    "如果群已经存在，请把当前飞书应用的机器人拉入群后再搜索。",
  ];
}

export async function createLarkChatClient(config, options = {}) {
  requireLarkAppConfig(config, "chat search");

  const channelFactory = options.channelFactory ?? createDefaultLarkChannel;
  const channel = await channelFactory(config);
  const searchTimeoutMs = options.searchTimeoutMs ?? DEFAULT_CHAT_SEARCH_TIMEOUT_MS;

  return {
    async searchChats(input = {}) {
      const query = normalizeQuery(input.query);
      const pageSize = normalizePageSize(input.pageSize);
      const pageToken = normalizeOptionalString(input.pageToken);

      if (!channel.rawClient?.im?.v1?.chat?.search) {
        throw new Error("Feishu chat search client is unavailable");
      }

      const params = {
        query,
        page_size: pageSize,
      };
      if (pageToken) params.page_token = pageToken;

      const result = await withTimeout(
        channel.rawClient.im.v1.chat.search({ params }),
        searchTimeoutMs,
        `Feishu chat search timed out after ${searchTimeoutMs}ms`,
      );
      const data = result?.data ?? {};
      const items = (data.items ?? []).map(normalizeChatItem).filter((item) => item.chatId);

      return {
        query,
        items,
        hasMore: Boolean(data.has_more ?? data.hasMore),
        pageToken: normalizeOptionalString(data.page_token ?? data.next_page_token) ?? "",
        nextSteps: items.length === 0 ? emptySearchNextSteps(query) : [],
      };
    },

    async close() {
      await channel.disconnect?.();
    },
  };
}
