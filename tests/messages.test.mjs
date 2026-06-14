import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { createLarkMessageClient } from "../src/lark/messages.js";

describe("lark messages", () => {
  it("sends text to a chat and preserves reply options", async () => {
    const observedCalls = [];
    const client = await createLarkMessageClient(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
      },
      {
        channelFactory: async () => ({
          async send(to, input, options) {
            observedCalls.push({ to, input, options });
            return { messageId: "om_sent" };
          },
        }),
      },
    );

    const result = await client.sendTextMessage({
      chatId: "oc_target",
      text: "处理完成",
      replyToMessageId: "om_original",
      replyInThread: true,
    });

    assert.deepEqual(observedCalls, [
      {
        to: "oc_target",
        input: { text: "处理完成" },
        options: {
          replyTo: "om_original",
          replyInThread: true,
        },
      },
    ]);
    assert.deepEqual(result, {
      chatId: "oc_target",
      text: "处理完成",
      messageId: "om_sent",
      replyToMessageId: "om_original",
      replyInThread: true,
    });
  });

  it("sends text with mentions for humans and bots", async () => {
    const observedCalls = [];
    const client = await createLarkMessageClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          async send(to, input, options) {
            observedCalls.push({ to, input, options });
            return { messageId: "om_mention" };
          },
        }),
      },
    );

    const mentions = [
      { openId: "ou_designer", name: "设计师" },
      { openId: "ou_agent_bot", name: "Agent Bot", isBot: true },
    ];
    const result = await client.sendTextMessage({
      chatId: "oc_target",
      text: "请一起看下这个变更",
      mentions,
    });

    assert.deepEqual(observedCalls, [
      {
        to: "oc_target",
        input: { text: "请一起看下这个变更" },
        options: {
          replyTo: undefined,
          replyInThread: undefined,
          mentions,
        },
      },
    ]);
    assert.deepEqual(result, {
      chatId: "oc_target",
      text: "请一起看下这个变更",
      mentions,
      messageId: "om_mention",
    });
  });

  it("allows sending a mention-only text message", async () => {
    const observedCalls = [];
    const client = await createLarkMessageClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          async send(to, input, options) {
            observedCalls.push({ to, input, options });
            return { messageId: "om_only_mention" };
          },
        }),
      },
    );

    const mentions = [{ openId: "ou_pm", name: "产品经理" }];
    const result = await client.sendTextMessage({
      chatId: "oc_target",
      mentions,
    });

    assert.deepEqual(observedCalls, [
      {
        to: "oc_target",
        input: { text: "" },
        options: {
          replyTo: undefined,
          replyInThread: undefined,
          mentions,
        },
      },
    ]);
    assert.deepEqual(result, {
      chatId: "oc_target",
      text: "",
      mentions,
      messageId: "om_only_mention",
    });
  });

  it("rejects text messages without text or mentions", async () => {
    const client = await createLarkMessageClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          async send() {
            throw new Error("send should not be called");
          },
        }),
      },
    );

    await assert.rejects(
      () => client.sendTextMessage({ chatId: "oc_target", text: "   " }),
      /text or mentions is required/,
    );
  });

  it("sends a local file to a chat and derives a display name", async () => {
    const observedCalls = [];
    const client = await createLarkMessageClient(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
      },
      {
        channelFactory: async () => ({
          async send(to, input, options) {
            observedCalls.push({ to, input, options });
            return { messageId: "om_file" };
          },
        }),
      },
    );

    const result = await client.sendFileMessage({
      chatId: "oc_target",
      filePath: "/tmp/lark-connect/screen.mov",
      replyToMessageId: "om_original",
      replyInThread: true,
    });

    assert.deepEqual(observedCalls, [
      {
        to: "oc_target",
        input: {
          file: {
            source: "/tmp/lark-connect/screen.mov",
            fileName: "screen.mov",
          },
        },
        options: {
          replyTo: "om_original",
          replyInThread: true,
        },
      },
    ]);
    assert.deepEqual(result, {
      chatId: "oc_target",
      filePath: "/tmp/lark-connect/screen.mov",
      fileName: "screen.mov",
      messageId: "om_file",
      replyToMessageId: "om_original",
      replyInThread: true,
    });
  });

  it("uses the explicit display name when sending a local file", async () => {
    const observedCalls = [];
    const client = await createLarkMessageClient(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
      },
      {
        channelFactory: async () => ({
          async send(to, input, options) {
            observedCalls.push({ to, input, options });
            return { messageId: "om_file" };
          },
        }),
      },
    );

    await client.sendFileMessage({
      chatId: "oc_target",
      filePath: "/tmp/lark-connect/raw-output.bin",
      fileName: "trace.log",
    });

    assert.equal(observedCalls[0].input.file.fileName, "trace.log");
  });

  it("sends a local image to a chat as an image message", async () => {
    const observedCalls = [];
    const client = await createLarkMessageClient(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
      },
      {
        channelFactory: async () => ({
          async send(to, input, options) {
            observedCalls.push({ to, input, options });
            return { messageId: "om_image" };
          },
        }),
      },
    );

    const result = await client.sendImageMessage({
      chatId: "oc_target",
      imagePath: "/tmp/lark-connect/screen.png",
      replyToMessageId: "om_original",
      replyInThread: true,
    });

    assert.deepEqual(observedCalls, [
      {
        to: "oc_target",
        input: {
          image: {
            source: "/tmp/lark-connect/screen.png",
          },
        },
        options: {
          replyTo: "om_original",
          replyInThread: true,
        },
      },
    ]);
    assert.deepEqual(result, {
      chatId: "oc_target",
      imagePath: "/tmp/lark-connect/screen.png",
      messageId: "om_image",
      replyToMessageId: "om_original",
      replyInThread: true,
    });
  });

  it("uploads a cover image before sending a local video message", async () => {
    const coverImagePath = fileURLToPath(new URL("../README.md", import.meta.url));
    const observedUploads = [];
    const observedCalls = [];
    const client = await createLarkMessageClient(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                image: {
                  async create(payload) {
                    observedUploads.push({
                      imageType: payload.data.image_type,
                      imagePath: payload.data.image.path,
                    });
                    return { data: { image_key: "img_cover" } };
                  },
                },
              },
            },
          },
          async send(to, input, options) {
            observedCalls.push({ to, input, options });
            return { messageId: "om_video" };
          },
        }),
      },
    );

    const result = await client.sendVideoMessage({
      chatId: "oc_target",
      videoPath: "/tmp/lark-connect/demo.mp4",
      coverImagePath,
      replyToMessageId: "om_original",
      replyInThread: true,
    });

    assert.deepEqual(observedUploads, [
      {
        imageType: "message",
        imagePath: coverImagePath,
      },
    ]);
    assert.deepEqual(observedCalls, [
      {
        to: "oc_target",
        input: {
          video: {
            source: "/tmp/lark-connect/demo.mp4",
            coverImageKey: "img_cover",
          },
        },
        options: {
          replyTo: "om_original",
          replyInThread: true,
        },
      },
    ]);
    assert.deepEqual(result, {
      chatId: "oc_target",
      videoPath: "/tmp/lark-connect/demo.mp4",
      coverImagePath,
      coverImageKey: "img_cover",
      messageId: "om_video",
      replyToMessageId: "om_original",
      replyInThread: true,
    });
  });
});
