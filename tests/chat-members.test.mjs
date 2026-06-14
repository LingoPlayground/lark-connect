import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createLarkChatMembersClient,
  DEFAULT_CHAT_MEMBERS_BOT_HISTORY_LIMIT,
  DEFAULT_CHAT_MEMBERS_PAGE_SIZE,
  MAX_CHAT_MEMBERS_BOT_HISTORY_LIMIT,
  MAX_CHAT_MEMBERS_PAGE_SIZE,
} from "../src/lark/chat-members.js";

describe("lark chat members", () => {
  it("lists human members and recognizable bots for a chat", async () => {
    const observedMemberCalls = [];
    const observedHistoryCalls = [];
    const client = await createLarkChatMembersClient(
      {
        appId: "cli_current",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                chatMembers: {
                  async get(payload) {
                    observedMemberCalls.push(payload);
                    return {
                      data: {
                        items: [
                          {
                            member_id: "ou_human",
                            member_id_type: "open_id",
                            name: "产品经理",
                            tenant_key: "tenant_1",
                          },
                        ],
                        has_more: true,
                        page_token: "next_members",
                        member_total: 3,
                      },
                    };
                  },
                },
                message: {
                  async list(payload) {
                    observedHistoryCalls.push(payload);
                    return {
                      data: {
                        items: [
                          {
                            message_id: "om_bot",
                            create_time: "1780000000000",
                            sender: {
                              id: "cli_other_bot",
                              id_type: "app_id",
                              sender_type: "app",
                              sender_name: "另一个 Agent",
                            },
                          },
                          {
                            message_id: "om_user",
                            sender: {
                              id: "ou_human",
                              id_type: "open_id",
                              sender_type: "user",
                              sender_name: "产品经理",
                            },
                          },
                        ],
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

    const result = await client.getChatMembers({ chatId: "oc_target" });

    assert.deepEqual(observedMemberCalls, [
      {
        path: { chat_id: "oc_target" },
        params: {
          member_id_type: "open_id",
          page_size: DEFAULT_CHAT_MEMBERS_PAGE_SIZE,
        },
      },
    ]);
    assert.deepEqual(observedHistoryCalls, [
      {
        params: {
          container_id_type: "chat",
          container_id: "oc_target",
          page_size: DEFAULT_CHAT_MEMBERS_BOT_HISTORY_LIMIT,
          sort_type: "ByCreateTimeDesc",
        },
      },
    ]);
    assert.deepEqual(result, {
      chatId: "oc_target",
      pageSize: DEFAULT_CHAT_MEMBERS_PAGE_SIZE,
      memberIdType: "open_id",
      members: [
        {
          memberId: "ou_human",
          memberIdType: "open_id",
          memberType: "user",
          name: "产品经理",
          tenantKey: "tenant_1",
        },
      ],
      bots: [
        {
          appId: "cli_current",
          memberType: "bot",
          source: "configured_app",
        },
        {
          appId: "cli_other_bot",
          memberType: "bot",
          name: "另一个 Agent",
          source: "recent_message_sender",
          messageId: "om_bot",
          createTime: "1780000000000",
        },
      ],
      botCoverage: "partial",
      botSources: ["configured_app", "recent_message_sender"],
      notes: [
        "Feishu chat member API does not return bot members; bots are limited to the configured app and recent app senders visible in chat history.",
      ],
      hasMore: true,
      pageToken: "next_members",
      memberTotal: 3,
      triggerSecurityConfLimit: false,
      securityConfLimit: undefined,
    });
  });

  it("passes explicit pagination and bot history limits", async () => {
    const observedMemberCalls = [];
    const observedHistoryCalls = [];
    const client = await createLarkChatMembersClient(
      {
        appId: "cli_current",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                chatMembers: {
                  async get(payload) {
                    observedMemberCalls.push(payload);
                    return { data: { items: [] } };
                  },
                },
                message: {
                  async list(payload) {
                    observedHistoryCalls.push(payload);
                    return { data: { items: [] } };
                  },
                },
              },
            },
          },
        }),
      },
    );

    await client.getChatMembers({
      chatId: "oc_target",
      pageSize: 5,
      pageToken: "members_page",
      botHistoryLimit: 7,
    });

    assert.deepEqual(observedMemberCalls, [
      {
        path: { chat_id: "oc_target" },
        params: {
          member_id_type: "open_id",
          page_size: 5,
          page_token: "members_page",
        },
      },
    ]);
    assert.equal(observedHistoryCalls[0].params.page_size, 7);
  });

  it("rejects invalid page sizes before calling Feishu", async () => {
    let called = false;
    const client = await createLarkChatMembersClient(
      {
        appId: "cli_current",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                chatMembers: {
                  async get() {
                    called = true;
                  },
                },
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

    for (const input of [
      { pageSize: 0 },
      { pageSize: MAX_CHAT_MEMBERS_PAGE_SIZE + 1 },
      { botHistoryLimit: -1 },
      { botHistoryLimit: MAX_CHAT_MEMBERS_BOT_HISTORY_LIMIT + 1 },
    ]) {
      await assert.rejects(
        () => client.getChatMembers({ chatId: "oc_target", ...input }),
        /pageSize|botHistoryLimit/,
      );
    }

    assert.equal(called, false);
  });
});
