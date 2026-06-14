import { createDefaultLarkChannel, requireLarkAppConfig } from "./channel.js";

export const DEFAULT_CHAT_MEMBERS_PAGE_SIZE = 50;
export const MAX_CHAT_MEMBERS_PAGE_SIZE = 100;
export const DEFAULT_CHAT_MEMBERS_BOT_HISTORY_LIMIT = 20;
export const MAX_CHAT_MEMBERS_BOT_HISTORY_LIMIT = 100;

const BOT_COVERAGE_NOTE =
  "Feishu chat member API does not return bot members; bots are limited to the configured app and recent app senders visible in chat history.";

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

function normalizeBotHistoryLimit(value) {
  if (value === undefined) return DEFAULT_CHAT_MEMBERS_BOT_HISTORY_LIMIT;
  const limit = Number(value);
  if (
    !Number.isInteger(limit) ||
    limit < 0 ||
    limit > MAX_CHAT_MEMBERS_BOT_HISTORY_LIMIT
  ) {
    throw new Error(
      `botHistoryLimit must be an integer between 0 and ${MAX_CHAT_MEMBERS_BOT_HISTORY_LIMIT}`,
    );
  }
  return limit;
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

function normalizeConfiguredBot(appId) {
  const normalizedAppId = normalizeOptionalString(appId);
  if (!normalizedAppId) return undefined;
  return {
    appId: normalizedAppId,
    memberType: "bot",
    source: "configured_app",
  };
}

function normalizeRecentBotSender(item = {}) {
  const sender = item.sender ?? {};
  const senderType = normalizeOptionalString(sender.sender_type ?? sender.senderType);
  if (senderType !== "app") return undefined;

  const appId = normalizeOptionalString(sender.id ?? sender.sender_id?.app_id);
  if (!appId) return undefined;

  const bot = {
    appId,
    memberType: "bot",
    source: "recent_message_sender",
    messageId: normalizeOptionalString(item.message_id ?? item.messageId),
    createTime: normalizeOptionalString(item.create_time ?? item.createTime),
  };
  const name = normalizeOptionalString(sender.sender_name ?? sender.name);
  if (name) bot.name = name;
  return bot;
}

function addBot(botsByAppId, bot) {
  if (!bot?.appId) return;
  if (!botsByAppId.has(bot.appId)) {
    botsByAppId.set(bot.appId, bot);
    return;
  }

  const existing = botsByAppId.get(bot.appId);
  botsByAppId.set(bot.appId, {
    ...bot,
    ...existing,
    name: existing.name ?? bot.name,
    messageId: existing.messageId ?? bot.messageId,
    createTime: existing.createTime ?? bot.createTime,
  });
}

function collectBotSources(bots) {
  return Array.from(new Set(bots.map((bot) => bot.source).filter(Boolean)));
}

function getChatMembersEndpoint(rawClient) {
  return rawClient?.im?.v1?.chatMembers?.get ?? rawClient?.im?.v1?.chat?.members?.get;
}

export async function createLarkChatMembersClient(config, options = {}) {
  requireLarkAppConfig(config, "chat members");

  const channelFactory = options.channelFactory ?? createDefaultLarkChannel;
  const channel = await channelFactory(config);

  return {
    async getChatMembers(input = {}) {
      const chatId = normalizeRequiredString(input.chatId, "chatId");
      const pageSize = normalizePageSize(input.pageSize);
      const pageToken = normalizeOptionalString(input.pageToken);
      const botHistoryLimit = normalizeBotHistoryLimit(input.botHistoryLimit);

      const chatMembersGet = getChatMembersEndpoint(channel.rawClient);
      if (!chatMembersGet) {
        throw new Error("Feishu chat members client is unavailable");
      }
      if (!channel.rawClient?.im?.v1?.message?.list) {
        throw new Error("Feishu message history client is unavailable");
      }

      const memberParams = {
        member_id_type: "open_id",
        page_size: pageSize,
      };
      if (pageToken) memberParams.page_token = pageToken;

      const memberResult = await chatMembersGet({
        path: { chat_id: chatId },
        params: memberParams,
      });
      const memberData = memberResult?.data ?? {};
      const members = (memberData.items ?? [])
        .map(normalizeMember)
        .filter((member) => member.memberId);

      const botsByAppId = new Map();
      addBot(botsByAppId, normalizeConfiguredBot(config.appId));

      if (botHistoryLimit > 0) {
        const historyResult = await channel.rawClient.im.v1.message.list({
          params: {
            container_id_type: "chat",
            container_id: chatId,
            page_size: botHistoryLimit,
            sort_type: "ByCreateTimeDesc",
          },
        });
        for (const item of historyResult?.data?.items ?? []) {
          addBot(botsByAppId, normalizeRecentBotSender(item));
        }
      }

      const bots = Array.from(botsByAppId.values());
      return {
        chatId,
        pageSize,
        memberIdType: "open_id",
        members,
        bots,
        botCoverage: "partial",
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
