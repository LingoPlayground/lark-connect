import { createReadStream } from "node:fs";
import { basename } from "node:path";

import { createDefaultLarkChannel } from "./channel.js";

function requireMessageConfig(config) {
  if (!config.appId) throw new Error("FEISHU_APP_ID is required for messages");
  if (!config.appSecret) throw new Error("FEISHU_APP_SECRET is required for messages");
}

function normalizeOptionalText(text) {
  return String(text ?? "").trim();
}

function normalizeMentionTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new Error("mentions items must be objects");
  }

  const openId = String(target.openId ?? target.open_id ?? "").trim();
  if (!openId) throw new Error("mentions.openId is required");

  const mention = { openId };
  const name = String(target.name ?? "").trim();
  if (name) mention.name = name;
  if (target.isBot !== undefined) {
    if (typeof target.isBot !== "boolean") throw new Error("mentions.isBot must be a boolean");
    mention.isBot = target.isBot;
  }
  return mention;
}

function normalizeMentions(mentions) {
  if (mentions === undefined) return undefined;
  if (!Array.isArray(mentions)) throw new Error("mentions must be an array");
  const normalized = mentions.map(normalizeMentionTarget);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTextMessageInput(input) {
  const text = normalizeOptionalText(input.text);
  const mentions = normalizeMentions(input.mentions);
  if (!text && !mentions) throw new Error("text or mentions is required");
  return { text, mentions };
}

function normalizeFilePath(filePath) {
  const normalized = String(filePath ?? "").trim();
  if (!normalized) throw new Error("filePath is required");
  return normalized;
}

function normalizeRequiredPath(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

function resolveFileName(filePath, fileName) {
  const normalized = String(fileName ?? "").trim();
  if (normalized) return normalized;

  const derived = basename(filePath);
  if (!derived) throw new Error("fileName is required");
  return derived;
}

async function uploadMessageImage(channel, imagePath) {
  if (!channel.rawClient?.im?.v1?.image?.create) {
    throw new Error("Feishu image upload client is unavailable");
  }

  const result = await channel.rawClient.im.v1.image.create({
    data: {
      image_type: "message",
      image: createReadStream(imagePath),
    },
  });
  const imageKey = result?.data?.image_key ?? result?.image_key;
  if (!imageKey) throw new Error("Feishu image upload did not return image_key");
  return imageKey;
}

export async function createLarkMessageClient(config, options = {}) {
  requireMessageConfig(config);

  const channelFactory = options.channelFactory ?? createDefaultLarkChannel;
  const channel = await channelFactory(config);

  return {
    async sendTextMessage(input) {
      const { text, mentions } = normalizeTextMessageInput(input);
      const sendOptions = {
        replyTo: input.replyToMessageId,
        replyInThread: input.replyInThread,
      };
      if (mentions) sendOptions.mentions = mentions;

      const result = await channel.send(input.chatId, { text }, sendOptions);

      const message = {
        chatId: input.chatId,
        text,
        messageId: result.messageId,
      };
      if (input.replyToMessageId !== undefined) message.replyToMessageId = input.replyToMessageId;
      if (input.replyInThread !== undefined) message.replyInThread = input.replyInThread;
      if (mentions) message.mentions = mentions;
      if (result.chunkIds) message.chunkIds = result.chunkIds;
      return message;
    },

    async sendFileMessage(input) {
      const filePath = normalizeFilePath(input.filePath);
      const fileName = resolveFileName(filePath, input.fileName);
      const result = await channel.send(
        input.chatId,
        {
          file: {
            source: filePath,
            fileName,
          },
        },
        {
          replyTo: input.replyToMessageId,
          replyInThread: input.replyInThread,
        },
      );

      const message = {
        chatId: input.chatId,
        filePath,
        fileName,
        messageId: result.messageId,
        replyToMessageId: input.replyToMessageId,
        replyInThread: input.replyInThread,
      };
      if (result.chunkIds) message.chunkIds = result.chunkIds;
      return message;
    },

    async sendImageMessage(input) {
      const imagePath = normalizeRequiredPath(input.imagePath, "imagePath");
      const result = await channel.send(
        input.chatId,
        {
          image: {
            source: imagePath,
          },
        },
        {
          replyTo: input.replyToMessageId,
          replyInThread: input.replyInThread,
        },
      );

      const message = {
        chatId: input.chatId,
        imagePath,
        messageId: result.messageId,
        replyToMessageId: input.replyToMessageId,
        replyInThread: input.replyInThread,
      };
      if (result.chunkIds) message.chunkIds = result.chunkIds;
      return message;
    },

    async sendVideoMessage(input) {
      const videoPath = normalizeRequiredPath(input.videoPath, "videoPath");
      const coverImagePath = normalizeRequiredPath(input.coverImagePath, "coverImagePath");
      const coverImageKey = await uploadMessageImage(channel, coverImagePath);
      const result = await channel.send(
        input.chatId,
        {
          video: {
            source: videoPath,
            coverImageKey,
          },
        },
        {
          replyTo: input.replyToMessageId,
          replyInThread: input.replyInThread,
        },
      );

      const message = {
        chatId: input.chatId,
        videoPath,
        coverImagePath,
        coverImageKey,
        messageId: result.messageId,
        replyToMessageId: input.replyToMessageId,
        replyInThread: input.replyInThread,
      };
      if (result.chunkIds) message.chunkIds = result.chunkIds;
      return message;
    },

    async close() {
      await channel.disconnect?.();
    },
  };
}
