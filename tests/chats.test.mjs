import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createLarkChatClient } from "../src/lark/chats.js";

describe("lark chats", () => {
  it("searches visible chats and normalizes group fields", async () => {
    const observedCalls = [];
    const client = await createLarkChatClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                chat: {
                  async search(payload) {
                    observedCalls.push(payload);
                    return {
                      data: {
                        items: [
                          {
                            chat_id: "oc_test",
                            name: "lark-connect 测试群",
                            description: "验收用",
                            avatar: "https://example.com/avatar.png",
                            chat_mode: "group",
                            chat_type: "private",
                            chat_status: "normal",
                            member_count: 3,
                            owner_id: "ou_owner",
                          },
                        ],
                        has_more: false,
                        page_token: "",
                      },
                    };
                  },
                },
              },
            },
          },
        }),
      },
    );

    const result = await client.searchChats({ query: "测试群", pageSize: 10 });

    assert.deepEqual(observedCalls, [
      {
        params: {
          query: "测试群",
          page_size: 10,
        },
      },
    ]);
    assert.deepEqual(result, {
      query: "测试群",
      items: [
        {
          chatId: "oc_test",
          name: "lark-connect 测试群",
          description: "验收用",
          avatar: "https://example.com/avatar.png",
          chatMode: "group",
          chatType: "private",
          chatStatus: "normal",
          memberCount: 3,
          ownerId: "ou_owner",
        },
      ],
      hasMore: false,
      pageToken: "",
      nextSteps: [],
    });
  });

  it("passes and returns pagination tokens", async () => {
    const observedCalls = [];
    const client = await createLarkChatClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                chat: {
                  async search(payload) {
                    observedCalls.push(payload);
                    return {
                      data: {
                        items: [{ chat_id: "oc_next", name: "下一页群" }],
                        has_more: true,
                        next_page_token: "next-token",
                      },
                    };
                  },
                },
              },
            },
          },
        }),
      },
    );

    const result = await client.searchChats({
      query: "测试群",
      pageSize: 2,
      pageToken: "current-token",
    });

    assert.deepEqual(observedCalls, [
      {
        params: {
          query: "测试群",
          page_size: 2,
          page_token: "current-token",
        },
      },
    ]);
    assert.equal(result.hasMore, true);
    assert.equal(result.pageToken, "next-token");
  });

  it("returns setup guidance when no visible chats match", async () => {
    const client = await createLarkChatClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                chat: {
                  async search() {
                    return {
                      data: {
                        items: [],
                        has_more: false,
                      },
                    };
                  },
                },
              },
            },
          },
        }),
      },
    );

    const result = await client.searchChats({ query: "不存在的群" });

    assert.deepEqual(result.items, []);
    assert.match(result.nextSteps.join("\n"), /创建群/);
    assert.match(result.nextSteps.join("\n"), /机器人拉入群/);
  });

  it("rejects invalid page sizes before calling Feishu", async () => {
    const client = await createLarkChatClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                chat: {
                  async search() {
                    throw new Error("should not call Feishu");
                  },
                },
              },
            },
          },
        }),
      },
    );

    for (const pageSize of [0, 101, 1.5]) {
      await assert.rejects(
        () => client.searchChats({ query: "测试群", pageSize }),
        /pageSize/,
      );
    }
  });

  it("accepts the maximum chat search page size", async () => {
    const observedCalls = [];
    const client = await createLarkChatClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                chat: {
                  async search(payload) {
                    observedCalls.push(payload);
                    return {
                      data: {
                        items: [],
                      },
                    };
                  },
                },
              },
            },
          },
        }),
      },
    );

    await client.searchChats({ query: "测试群", pageSize: 100 });

    assert.deepEqual(observedCalls, [
      {
        params: {
          query: "测试群",
          page_size: 100,
        },
      },
    ]);
  });

  it("times out chat search calls", async () => {
    const client = await createLarkChatClient(
      {
        appId: "cli_test",
        appSecret: "secret",
      },
      {
        searchTimeoutMs: 1,
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                chat: {
                  async search() {
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
      () => client.searchChats({ query: "测试群" }),
      /timed out after 1ms/,
    );
  });
});
