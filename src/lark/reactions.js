import { createDefaultLarkChannel } from "./channel.js";

export const DEFAULT_ACK_REACTION_EMOJI_TYPE = "OK";

function requireReactionConfig(config) {
  if (!config.appId) throw new Error("FEISHU_APP_ID is required for reactions");
  if (!config.appSecret) throw new Error("FEISHU_APP_SECRET is required for reactions");
}

export async function createLarkReactionClient(config, options = {}) {
  requireReactionConfig(config);

  const channelFactory = options.channelFactory ?? createDefaultLarkChannel;
  const channel = await channelFactory(config);

  return {
    async addMessageReaction(messageId, emojiType = DEFAULT_ACK_REACTION_EMOJI_TYPE) {
      if (!messageId) throw new Error("messageId is required");
      const reactionId = await channel.addReaction(messageId, emojiType);
      return {
        messageId,
        emojiType,
        reactionId,
      };
    },

    async close() {
      await channel.disconnect?.();
    },
  };
}
