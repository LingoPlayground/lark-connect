import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createLarkChatMembersClient,
  DEFAULT_CHAT_MEMBERS_PAGE_SIZE,
  MAX_CHAT_MEMBERS_PAGE_SIZE,
} from "../src/lark/chat-members.js";

describe("lark chat members", () => {
  it("lists human members and bots for a chat", async () => {
    const observedMemberCalls = [];
    const observedBotCalls = [];
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
              },
            },
            async request(payload) {
              observedBotCalls.push(payload);
              return {
                data: {
                  items: [
                    {
                      bot_id: "ou_bot",
                      bot_name: "另一个 Agent",
                    },
                  ],
                },
              };
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
    assert.deepEqual(observedBotCalls, [
      {
        method: "GET",
        url: "/open-apis/im/v1/chats/oc_target/members/bots",
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
          botId: "ou_bot",
          openId: "ou_bot",
          memberId: "ou_bot",
          memberIdType: "open_id",
          memberType: "bot",
          name: "另一个 Agent",
          source: "chat_member_bots_api",
        },
      ],
      botCoverage: "direct",
      botSources: ["chat_member_bots_api"],
      notes: [
        "Feishu members/bots API returns bot open_id values for bots currently in the chat.",
      ],
      hasMore: true,
      pageToken: "next_members",
      memberTotal: 3,
      triggerSecurityConfLimit: false,
      securityConfLimit: undefined,
    });
  });

  it("passes explicit human member pagination", async () => {
    const observedMemberCalls = [];
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
              },
            },
            async request() {
              return { data: { items: [] } };
            },
          },
        }),
      },
    );

    await client.getChatMembers({
      chatId: "oc_target",
      pageSize: 5,
      pageToken: "members_page",
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
              },
            },
            async request() {
              called = true;
            },
          },
        }),
      },
    );

    for (const input of [
      { pageSize: 0 },
      { pageSize: MAX_CHAT_MEMBERS_PAGE_SIZE + 1 },
    ]) {
      await assert.rejects(
        () => client.getChatMembers({ chatId: "oc_target", ...input }),
        /pageSize/,
      );
    }

    assert.equal(called, false);
  });

  it("times out when Feishu chat members do not respond", async () => {
    const client = await createLarkChatMembersClient(
      {
        appId: "cli_current",
        appSecret: "secret",
      },
      {
        chatMembersTimeoutMs: 1,
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                chatMembers: {
                  async get() {
                    return new Promise(() => {});
                  },
                },
              },
            },
            async request() {
              return { data: { items: [] } };
            },
          },
        }),
      },
    );

    await assert.rejects(
      () =>
        Promise.race([
          client.getChatMembers({ chatId: "oc_target" }),
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error("test timed out waiting for member timeout")),
              25,
            );
          }),
        ]),
      /Feishu chat members timed out after 1ms/,
    );
  });

  it("times out when Feishu chat bots do not respond", async () => {
    const client = await createLarkChatMembersClient(
      {
        appId: "cli_current",
        appSecret: "secret",
      },
      {
        chatMembersTimeoutMs: 1,
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {
                chatMembers: {
                  async get() {
                    return { data: { items: [] } };
                  },
                },
              },
            },
            async request() {
              return new Promise(() => {});
            },
          },
        }),
      },
    );

    await assert.rejects(
      () =>
        Promise.race([
          client.getChatMembers({ chatId: "oc_target" }),
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error("test timed out waiting for bot timeout")),
              25,
            );
          }),
        ]),
      /Feishu chat bots timed out after 1ms/,
    );
  });

  it("reports unavailable Feishu chat member clients", async () => {
    const missingMembersClient = await createLarkChatMembersClient(
      {
        appId: "cli_current",
        appSecret: "secret",
      },
      {
        channelFactory: async () => ({
          rawClient: {
            im: {
              v1: {},
            },
            async request() {
              return { data: { items: [] } };
            },
          },
        }),
      },
    );
    await assert.rejects(
      () => missingMembersClient.getChatMembers({ chatId: "oc_target" }),
      /Feishu chat members client is unavailable/,
    );

    const missingBotsClient = await createLarkChatMembersClient(
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
                    return { data: { items: [] } };
                  },
                },
              },
            },
          },
        }),
      },
    );
    await assert.rejects(
      () => missingBotsClient.getChatMembers({ chatId: "oc_target" }),
      /Feishu chat bots client is unavailable/,
    );
  });
});
