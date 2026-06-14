import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runLiveDoctor } from "../src/lark/doctor.js";

function createFetchStub(routes) {
  return async (url, options = {}) => {
    const route = routes.shift();
    assert.ok(route, `unexpected fetch call to ${url}`);
    assert.equal(url, route.url);
    assert.equal(options.method ?? "GET", route.method);
    if (route.expectAuth) {
      assert.equal(options.headers.Authorization, route.expectAuth);
    }

    return {
      ok: true,
      status: 200,
      async json() {
        return route.body;
      },
    };
  };
}

describe("runLiveDoctor", () => {
  it("checks token, bot identity, and chat access", async () => {
    const fetchImpl = createFetchStub([
      {
        method: "POST",
        url: "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        body: {
          code: 0,
          tenant_access_token: "t-token",
          expire: 7200,
        },
      },
      {
        method: "GET",
        url: "https://open.feishu.cn/open-apis/bot/v3/info",
        expectAuth: "Bearer t-token",
        body: {
          code: 0,
          bot: {
            open_id: "ou_bot",
            app_name: "测试机器人",
          },
        },
      },
      {
        method: "GET",
        url: "https://open.feishu.cn/open-apis/im/v1/chats/oc_test",
        expectAuth: "Bearer t-token",
        body: {
          code: 0,
          data: {
            name: "示例测试群",
            chat_mode: "group",
          },
        },
      },
    ]);

    const result = await runLiveDoctor(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_test",
        appBaseInfoUrl: "https://open.feishu.cn/app/cli_test/baseinfo",
      },
      { fetchImpl },
    );

    assert.deepEqual(result.checks, {
      tenantAccessToken: true,
      botInfo: true,
      chatAccess: true,
    });
    assert.equal(result.bot.openId, "ou_bot");
    assert.equal(result.chat.name, "示例测试群");
  });

  it("fails before network calls when credentials are missing", async () => {
    await assert.rejects(
      () =>
        runLiveDoctor(
          { appId: "cli_test", appSecret: "", chatId: "oc_test", appBaseInfoUrl: "" },
          {
            fetchImpl: async () => {
              throw new Error("should not fetch");
            },
          },
        ),
      /FEISHU_APP_SECRET/,
    );
  });

  it("preserves the original response parsing error when live checks receive non-JSON", async () => {
    const parseError = new SyntaxError("unexpected token");

    await assert.rejects(
      () =>
        runLiveDoctor(
          { appId: "cli_test", appSecret: "secret", chatId: "", appBaseInfoUrl: "" },
          {
            fetchImpl: async () => ({
              ok: true,
              status: 200,
              async json() {
                throw parseError;
              },
            }),
          },
        ),
      (error) => {
        assert.match(error.message, /tenant_access_token returned a non-JSON response/);
        assert.equal(error.cause, parseError);
        return true;
      },
    );
  });

  it("checks app credentials and bot identity without requiring a chat id", async () => {
    const fetchImpl = createFetchStub([
      {
        method: "POST",
        url: "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        body: {
          code: 0,
          tenant_access_token: "t-token",
          expire: 7200,
        },
      },
      {
        method: "GET",
        url: "https://open.feishu.cn/open-apis/bot/v3/info",
        expectAuth: "Bearer t-token",
        body: {
          code: 0,
          bot: {
            open_id: "ou_bot",
            app_name: "测试机器人",
          },
        },
      },
    ]);

    const result = await runLiveDoctor(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "",
        appBaseInfoUrl: "https://open.feishu.cn/app/cli_test/baseinfo",
      },
      { fetchImpl },
    );

    assert.deepEqual(result.checks, {
      tenantAccessToken: true,
      botInfo: true,
      chatAccess: null,
    });
    assert.equal(result.chat, null);
  });
});
