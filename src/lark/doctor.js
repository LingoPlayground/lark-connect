const FEISHU_OPEN_API = "https://open.feishu.cn";

function requireField(config, key, envName) {
  if (!config[key]) {
    throw new Error(`${envName} is required for live doctor checks`);
  }
}

async function readJsonResponse(response, context) {
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`${context} returned a non-JSON response`);
  }

  if (!response.ok) {
    throw new Error(`${context} failed with HTTP ${response.status}`);
  }
  if (payload.code !== 0) {
    throw new Error(`${context} failed: ${payload.msg ?? `code ${payload.code}`}`);
  }
  return payload;
}

async function requestTenantAccessToken(config, fetchImpl) {
  const response = await fetchImpl(`${FEISHU_OPEN_API}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret,
    }),
  });
  const payload = await readJsonResponse(response, "tenant_access_token");
  if (!payload.tenant_access_token) {
    throw new Error("tenant_access_token response is missing token");
  }
  return payload.tenant_access_token;
}

async function getBotInfo(token, fetchImpl) {
  const response = await fetchImpl(`${FEISHU_OPEN_API}/open-apis/bot/v3/info`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = await readJsonResponse(response, "bot info");
  const bot = payload.bot ?? {};
  return {
    openId: bot.open_id ?? "",
    appName: bot.app_name ?? "",
  };
}

async function getChatInfo(chatId, token, fetchImpl) {
  const response = await fetchImpl(`${FEISHU_OPEN_API}/open-apis/im/v1/chats/${chatId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = await readJsonResponse(response, "chat info");
  const data = payload.data ?? {};
  return {
    chatId,
    name: data.name ?? "",
    chatMode: data.chat_mode ?? "",
  };
}

export async function runLiveDoctor(config, options = {}) {
  requireField(config, "appId", "FEISHU_APP_ID");
  requireField(config, "appSecret", "FEISHU_APP_SECRET");

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable in this Node.js runtime");
  }

  const token = await requestTenantAccessToken(config, fetchImpl);
  const bot = await getBotInfo(token, fetchImpl);
  const chat = config.chatId ? await getChatInfo(config.chatId, token, fetchImpl) : null;

  return {
    appId: config.appId,
    chatId: config.chatId,
    appBaseInfoUrl: config.appBaseInfoUrl,
    checks: {
      tenantAccessToken: true,
      botInfo: Boolean(bot.openId),
      chatAccess: chat ? Boolean(chat.name || chat.chatMode) : null,
    },
    bot,
    chat,
  };
}
