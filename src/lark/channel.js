export function requireLarkAppConfig(config, featureName = "listen") {
  if (!config.appId) throw new Error(`FEISHU_APP_ID is required for ${featureName}`);
  if (!config.appSecret) throw new Error(`FEISHU_APP_SECRET is required for ${featureName}`);
}

export function buildLarkChannelPolicy(options = {}) {
  const policy = {
    requireMention: true,
    dmMode: "open",
  };
  if (options.groupAllowlist?.length) policy.groupAllowlist = options.groupAllowlist;
  return policy;
}

export async function createDefaultLarkChannel(config, options = {}) {
  const lark = await import("@larksuiteoapi/node-sdk");

  return lark.createLarkChannel({
    appId: config.appId,
    appSecret: config.appSecret,
    loggerLevel: lark.LoggerLevel.warn,
    policy: buildLarkChannelPolicy(options),
    includeRawInMessage: true,
  });
}
