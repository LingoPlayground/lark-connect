import { createDefaultLarkChannel, requireLarkAppConfig } from "./channel.js";
import { DEFAULT_LARK_REQUEST_TIMEOUT_MS, withTimeout } from "./timeouts.js";

export const DEFAULT_CHAT_MEMBERS_PAGE_SIZE = 50;
export const MAX_CHAT_MEMBERS_PAGE_SIZE = 100;
const DEFAULT_CHAT_MEMBERS_TIMEOUT_MS = DEFAULT_LARK_REQUEST_TIMEOUT_MS;

const BOT_COVERAGE_NOTE =
  "Feishu members/bots API returns bot open_id values for bots currently in the chat.";

function normalizeRequiredString(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${fieldName} is required`);
  return text;
}

function normalizeOptionalString(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function normalizePageSize(value) {
  if (value === undefined) return DEFAULT_CHAT_MEMBERS_PAGE_SIZE;
  const pageSize = Number(value);
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_CHAT_MEMBERS_PAGE_SIZE
  ) {
    throw new Error(`pageSize must be an integer between 1 and ${MAX_CHAT_MEMBERS_PAGE_SIZE}`);
  }
  return pageSize;
}

function normalizeMember(item = {}) {
  return {
    memberId: item.member_id ?? item.memberId,
    memberIdType: item.member_id_type ?? item.memberIdType,
    memberType: item.member_type ?? item.memberType ?? "user",
    name: normalizeOptionalString(item.name),
    tenantKey: item.tenant_key ?? item.tenantKey,
  };
}

function normalizeBot(item = {}) {
  const botId = normalizeOptionalString(item.bot_id ?? item.botId);
  if (!botId) return undefined;
  const bot = {
    botId,
    openId: botId,
    memberId: botId,
    memberIdType: "open_id",
    memberType: "bot",
    source: "chat_member_bots_api",
  };
  const name = normalizeOptionalString(item.bot_name ?? item.botName);
  if (name) bot.name = name;
  return bot;
}

function collectBotSources(bots) {
  return Array.from(new Set(bots.map((bot) => bot.source).filter(Boolean)));
}

function getChatMembersEndpoint(rawClient) {
  return rawClient?.im?.v1?.chatMembers?.get ?? rawClient?.im?.v1?.chat?.members?.get;
}

function getChatBotsEndpoint(rawClient) {
  if (!rawClient?.request) return undefined;
  return (chatId) =>
    rawClient.request({
      method: "GET",
      url: `/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members/bots`,
    });
}

export async function createLarkChatMembersClient(config, options = {}) {
  requireLarkAppConfig(config, "chat members");

  const channelFactory = options.channelFactory ?? createDefaultLarkChannel;
  const channel = await channelFactory(config);
  const chatMembersTimeoutMs =
    options.chatMembersTimeoutMs ?? DEFAULT_CHAT_MEMBERS_TIMEOUT_MS;

  return {
    async getChatMembers(input = {}) {
      const chatId = normalizeRequiredString(input.chatId, "chatId");
      const pageSize = normalizePageSize(input.pageSize);
      const pageToken = normalizeOptionalString(input.pageToken);

      const chatMembersGet = getChatMembersEndpoint(channel.rawClient);
      if (!chatMembersGet) {
        throw new Error("Feishu chat members client is unavailable");
      }
      const chatBotsGet = getChatBotsEndpoint(channel.rawClient);
      if (!chatBotsGet) {
        throw new Error("Feishu chat bots client is unavailable");
      }

      const memberParams = {
        member_id_type: "open_id",
        page_size: pageSize,
      };
      if (pageToken) memberParams.page_token = pageToken;

      const memberResult = await withTimeout(
        chatMembersGet({
          path: { chat_id: chatId },
          params: memberParams,
        }),
        chatMembersTimeoutMs,
        `Feishu chat members timed out after ${chatMembersTimeoutMs}ms`,
      );
      const memberData = memberResult?.data ?? {};
      const members = (memberData.items ?? [])
        .map(normalizeMember)
        .filter((member) => member.memberId);

      const botResult = await withTimeout(
        chatBotsGet(chatId),
        chatMembersTimeoutMs,
        `Feishu chat bots timed out after ${chatMembersTimeoutMs}ms`,
      );
      const bots = (botResult?.data?.items ?? []).map(normalizeBot).filter(Boolean);

      return {
        chatId,
        pageSize,
        memberIdType: "open_id",
        members,
        bots,
        botCoverage: "direct",
        botSources: collectBotSources(bots),
        notes: [BOT_COVERAGE_NOTE],
        hasMore: Boolean(memberData.has_more ?? memberData.hasMore),
        pageToken: normalizeOptionalString(
          memberData.page_token ?? memberData.next_page_token,
        ) ?? "",
        memberTotal: memberData.member_total ?? memberData.memberTotal,
        triggerSecurityConfLimit: Boolean(
          memberData.trigger_security_conf_limit ?? memberData.triggerSecurityConfLimit,
        ),
        securityConfLimit: memberData.security_conf_limit ?? memberData.securityConfLimit,
      };
    },

    async close() {
      await channel.disconnect?.();
    },
  };
}
