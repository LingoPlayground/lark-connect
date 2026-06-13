export function requireLarkAppConfig(config, featureName = "listen") {
  if (!config.appId) throw new Error(`FEISHU_APP_ID is required for ${featureName}`);
  if (!config.appSecret) throw new Error(`FEISHU_APP_SECRET is required for ${featureName}`);
}

export function requireListenerConfig(config) {
  requireLarkAppConfig(config);
  if (!config.chatId) throw new Error("FEISHU_CHAT_ID is required for listen");
}

export function normalizeMessage(message) {
  return {
    messageId: message.messageId,
    chatId: message.chatId,
    chatType: message.chatType,
    senderId: message.senderId,
    senderName: message.senderName,
    content: message.content,
    rawContentType: message.rawContentType,
    mentionedBot: Boolean(message.mentionedBot),
    mentionAll: Boolean(message.mentionAll),
    mentions: message.mentions ?? [],
    resources: message.resources ?? [],
    rootId: message.rootId,
    threadId: message.threadId,
    replyToMessageId: message.replyToMessageId,
    createTime: message.createTime,
  };
}

export async function createDefaultLarkChannel(config, options = {}) {
  const lark = await import("@larksuiteoapi/node-sdk");
  const policy = {
    requireMention: true,
    dmMode: "open",
  };
  if (options.groupAllowlist?.length) policy.groupAllowlist = options.groupAllowlist;

  return lark.createLarkChannel({
    appId: config.appId,
    appSecret: config.appSecret,
    loggerLevel: lark.LoggerLevel.warn,
    policy,
    includeRawInMessage: true,
  });
}

export async function listenOnce(config, options = {}) {
  requireListenerConfig(config);

  const timeoutMs = options.timeoutMs ?? 120_000;
  const channelFactory = options.channelFactory ?? createDefaultLarkChannel;
  const channel = await channelFactory(config, { groupAllowlist: [config.chatId] });

  let timeout;
  let unsubscribe;
  let settled = false;

  const cleanup = async () => {
    if (timeout) clearTimeout(timeout);
    if (unsubscribe) unsubscribe();
    await channel.disconnect?.();
  };

  return new Promise((resolve, reject) => {
    const settle = async (fn, value) => {
      if (settled) return;
      settled = true;
      try {
        await cleanup();
      } catch {
        // A disconnect failure should not hide the message or timeout result.
      }
      fn(value);
    };

    timeout = setTimeout(() => {
      settle(reject, new Error(`Timed out waiting for a Lark mention after ${timeoutMs}ms`));
    }, timeoutMs);

    unsubscribe = channel.on("message", (message) => {
      if (message.chatId !== config.chatId) return;
      if (message.chatType !== "p2p" && !message.mentionedBot) return;
      settle(resolve, normalizeMessage(message));
    });

    channel.connect().catch((error) => {
      settle(reject, error);
    });
  });
}
