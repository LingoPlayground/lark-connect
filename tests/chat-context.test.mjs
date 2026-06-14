import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createLarkChatContextClient,
  DEFAULT_CHAT_CONTEXT_LIMIT,
  MAX_CHAT_CONTEXT_LIMIT,
} from "../src/lark/chat-context.js";

describe("lark chat context", () => {
  it("loads the latest bound chat messages with a default limit", async () => {
    const observedCalls = [];
    const client = await createLarkChatContextClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                message: {
                  async list(payload) {
                    observedCalls.push(payload);
                    return {
                      data: {
                        has_more: true,
                        page_token: "next_page",
                        items: [
                          {
                            message_id: "om_latest",
                            root_id: "om_root",
                            parent_id: "om_parent",
                            thread_id: "omt_thread",
                            msg_type: "text",
                            create_time: "1760000000000",
                            update_time: "1760000001000",
                            chat_id: "oc_target",
                            sender: {
                              id: "ou_pm",
                              id_type: "open_id",
                              sender_type: "user",
                              sender_name: "产品经理",
                            },
                            body: {
                              content: "{\"text\":\"@Bot 请看最新设计\"}",
                            },
                            mentions: [
                              {
                                key: "@_user_1",
                                id: "ou_bot",
                                id_type: "open_id",
                                name: "Review Bot",
                              },
                            ],
                          },
                        ],
                      },
                    };
                  },
                },
              },
            },
          },
          async disconnect() {},
        }),
      },
    );

    const result = await client.getChatContext({ chatId: "oc_target" });

    assert.deepEqual(observedCalls, [
      {
        params: {
          container_id_type: "chat",
          container_id: "oc_target",
          page_size: DEFAULT_CHAT_CONTEXT_LIMIT,
          sort_type: "ByCreateTimeDesc",
        },
      },
    ]);
    assert.deepEqual(result, {
      chatId: "oc_target",
      limit: DEFAULT_CHAT_CONTEXT_LIMIT,
      messages: [
        {
          messageId: "om_latest",
          larkMessageId: "om_latest",
          chatId: "oc_target",
          sender: {
            id: "ou_pm",
            idType: "open_id",
            type: "user",
            name: "产品经理",
          },
          msgType: "text",
          text: "@Bot 请看最新设计",
          content: { text: "@Bot 请看最新设计" },
          createTime: "1760000000000",
          updateTime: "1760000001000",
          rootId: "om_root",
          replyToMessageId: "om_parent",
          threadId: "omt_thread",
          mentions: [
            {
              key: "@_user_1",
              id: "ou_bot",
              idType: "open_id",
              name: "Review Bot",
            },
          ],
          deleted: undefined,
          updated: undefined,
        },
      ],
      hasMore: true,
      pageToken: "next_page",
    });
  });

  it("passes explicit limit and page token to Feishu", async () => {
    const observedCalls = [];
    const client = await createLarkChatContextClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                message: {
                  async list(payload) {
                    observedCalls.push(payload);
                    return { data: { items: [] } };
                  },
                },
              },
            },
          },
        }),
      },
    );

    await client.getChatContext({
      chatId: "oc_target",
      limit: 3,
      pageToken: "previous_page",
    });

    assert.deepEqual(observedCalls, [
      {
        params: {
          container_id_type: "chat",
          container_id: "oc_target",
          page_size: 3,
          sort_type: "ByCreateTimeDesc",
          page_token: "previous_page",
        },
      },
    ]);
  });

  it("rejects invalid limits before calling Feishu", async () => {
    let called = false;
    const client = await createLarkChatContextClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                message: {
                  async list() {
                    called = true;
                  },
                },
              },
            },
          },
        }),
      },
    );

    for (const limit of [0, MAX_CHAT_CONTEXT_LIMIT + 1, 1.5, Number.NaN]) {
      await assert.rejects(
        () => client.getChatContext({ chatId: "oc_target", limit }),
        /limit/,
      );
    }
    assert.equal(called, false);
  });

  it("times out when Feishu message history does not respond", async () => {
    const client = await createLarkChatContextClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        chatContextTimeoutMs: 1,
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                message: {
                  async list() {
                    return new Promise(() => {});
                  },
                },
              },
            },
          },
        }),
      },
    );

    await assert.rejects(
      () =>
        Promise.race([
          client.getChatContext({ chatId: "oc_target" }),
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error("test timed out waiting for client timeout")),
              25,
            );
          }),
        ]),
      /Feishu chat context timed out after 1ms/,
    );
  });

  it("reports an unavailable Feishu message history client", async () => {
    const client = await createLarkChatContextClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {},
            },
          },
        }),
      },
    );

    await assert.rejects(
      () => client.getChatContext({ chatId: "oc_target" }),
      /Feishu message history client is unavailable/,
    );
  });
});
