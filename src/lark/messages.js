import { createReadStream } from "node:fs";
import { basename } from "node:path";

import { createDefaultLarkChannel } from "./listener.js";

function requireMessageConfig(config) {
  if (!config.appId) throw new Error("FEISHU_APP_ID is required for messages");
  if (!config.appSecret) throw new Error("FEISHU_APP_SECRET is required for messages");
}

function normalizeText(text) {
  const normalized = String(text ?? "").trim();
  if (!normalized) throw new Error("text is required");
  return normalized;
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
      const text = normalizeText(input.text);
      const result = await channel.send(
        input.chatId,
        { text },
        {
          replyTo: input.replyToMessageId,
          replyInThread: input.replyInThread,
        },
      );

      const message = {
        chatId: input.chatId,
        text,
        messageId: result.messageId,
        replyToMessageId: input.replyToMessageId,
        replyInThread: input.replyInThread,
      };
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
