import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DAEMON_ERROR_CODES, DAEMON_START_COMMAND, DaemonHttpError } from "../src/daemon/errors.js";
import { handleMcpMessage } from "../src/mcp/server.js";

function toolCall(name, args = {}) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  };
}

function parseToolJson(response) {
  return JSON.parse(response.result.content[0].text);
}

describe("mcp daemon tools", () => {
  it("exposes daemon binding and message tools", async () => {
    const response = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    assert.deepEqual(
      response.result.tools.map((tool) => tool.name),
      [
        "lark_connect_daemon_status",
        "lark_connect_bind_session",
        "lark_connect_poll_messages",
        "lark_connect_wait_messages",
        "lark_connect_ack_message",
        "lark_connect_send_message",
        "lark_connect_send_file",
        "lark_connect_send_image",
        "lark_connect_send_video",
        "lark_connect_download_resource",
      ],
    );
  });

  it("rejects removed setup_url without creating a daemon client", async () => {
    const response = await handleMcpMessage(toolCall("setup_url"), {
      createDaemonHttpClientImpl: () => {
        throw new Error("daemon client should not be created");
      },
    });

    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /unknown tool: setup_url/);
  });

  it("forwards session binding calls to the local daemon client", async () => {
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_bind_session", {
        chatId: "oc_target",
        agentKind: "codex",
        agentSessionId: "thread_a",
        workspace: "/workspace/app",
        replace: true,
      }),
      {
        createDaemonHttpClientImpl: () => ({
          bindSession: async (args) => {
            observedArgs = args;
            return { binding: args };
          },
        }),
      },
    );

    assert.deepEqual(observedArgs, {
      chatId: "oc_target",
      agentKind: "codex",
      agentSessionId: "thread_a",
      workspace: "/workspace/app",
      replace: true,
    });
    assert.deepEqual(parseToolJson(response), {
      binding: observedArgs,
    });
  });

  it("returns daemon-not-running as a tool error with a start command", async () => {
    const response = await handleMcpMessage(toolCall("lark_connect_daemon_status"), {
      createDaemonHttpClientImpl: () => ({
        status: async () => {
          throw new DaemonHttpError(
            DAEMON_ERROR_CODES.DAEMON_NOT_RUNNING,
            `lark-connect daemon is not running. Start it with: ${DAEMON_START_COMMAND}`,
            { command: DAEMON_START_COMMAND },
          );
        },
      }),
    });

    assert.equal(response.result.isError, true);
    assert.deepEqual(parseToolJson(response), {
      code: "DAEMON_NOT_RUNNING",
      message: `lark-connect daemon is not running. Start it with: ${DAEMON_START_COMMAND}`,
      command: DAEMON_START_COMMAND,
    });
  });

  it("returns session-not-bound as a tool error before polling a bound session", async () => {
    const response = await handleMcpMessage(
      toolCall("lark_connect_poll_messages", { agentSessionId: "thread_unbound" }),
      {
        createDaemonHttpClientImpl: () => ({
          pollMessages: async () => {
            throw new DaemonHttpError(
              DAEMON_ERROR_CODES.SESSION_NOT_BOUND,
              "No Feishu chat is bound to agentSessionId thread_unbound. Call lark_connect_bind_session first.",
              {
                status: 404,
                details: { agentSessionId: "thread_unbound" },
              },
            );
          },
        }),
      },
    );

    assert.equal(response.result.isError, true);
    assert.deepEqual(parseToolJson(response), {
      code: "SESSION_NOT_BOUND",
      message:
        "No Feishu chat is bound to agentSessionId thread_unbound. Call lark_connect_bind_session first.",
      details: { agentSessionId: "thread_unbound" },
    });
  });

  it("forwards text send calls to the local daemon client", async () => {
    let observedAgentSessionId;
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_send_message", {
        agentSessionId: "thread_a",
        text: "处理完成",
        replyToMessageId: "om_original",
        replyInThread: true,
      }),
      {
        createDaemonHttpClientImpl: () => ({
          sendMessage: async (agentSessionId, args) => {
            observedAgentSessionId = agentSessionId;
            observedArgs = args;
            return {
              message: {
                id: "om_sent",
                larkMessageId: "om_sent",
                chatId: "oc_target",
                agentSessionId,
                ...args,
              },
            };
          },
        }),
      },
    );

    assert.equal(observedAgentSessionId, "thread_a");
    assert.deepEqual(observedArgs, {
      text: "处理完成",
      replyToMessageId: "om_original",
      replyInThread: true,
    });
    assert.deepEqual(parseToolJson(response), {
      message: {
        id: "om_sent",
        larkMessageId: "om_sent",
        chatId: "oc_target",
        agentSessionId: "thread_a",
        text: "处理完成",
        replyToMessageId: "om_original",
        replyInThread: true,
      },
    });
  });

  it("forwards file send calls to the local daemon client", async () => {
    let observedAgentSessionId;
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_send_file", {
        agentSessionId: "thread_a",
        filePath: "/tmp/lark-connect/screen.mov",
        fileName: "screen.mov",
        replyToMessageId: "om_original",
        replyInThread: true,
      }),
      {
        createDaemonHttpClientImpl: () => ({
          sendFile: async (agentSessionId, args) => {
            observedAgentSessionId = agentSessionId;
            observedArgs = args;
            return {
              message: {
                id: "om_file",
                larkMessageId: "om_file",
                chatId: "oc_target",
                agentSessionId,
                ...args,
              },
            };
          },
        }),
      },
    );

    assert.equal(observedAgentSessionId, "thread_a");
    assert.deepEqual(observedArgs, {
      filePath: "/tmp/lark-connect/screen.mov",
      fileName: "screen.mov",
      replyToMessageId: "om_original",
      replyInThread: true,
    });
    assert.deepEqual(parseToolJson(response), {
      message: {
        id: "om_file",
        larkMessageId: "om_file",
        chatId: "oc_target",
        agentSessionId: "thread_a",
        filePath: "/tmp/lark-connect/screen.mov",
        fileName: "screen.mov",
        replyToMessageId: "om_original",
        replyInThread: true,
      },
    });
  });

  it("forwards image send calls to the local daemon client", async () => {
    let observedAgentSessionId;
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_send_image", {
        agentSessionId: "thread_a",
        imagePath: "/tmp/lark-connect/screen.png",
        replyToMessageId: "om_original",
        replyInThread: true,
      }),
      {
        createDaemonHttpClientImpl: () => ({
          sendImage: async (agentSessionId, args) => {
            observedAgentSessionId = agentSessionId;
            observedArgs = args;
            return {
              message: {
                id: "om_image",
                larkMessageId: "om_image",
                chatId: "oc_target",
                agentSessionId,
                ...args,
              },
            };
          },
        }),
      },
    );

    assert.equal(observedAgentSessionId, "thread_a");
    assert.deepEqual(observedArgs, {
      imagePath: "/tmp/lark-connect/screen.png",
      replyToMessageId: "om_original",
      replyInThread: true,
    });
    assert.deepEqual(parseToolJson(response), {
      message: {
        id: "om_image",
        larkMessageId: "om_image",
        chatId: "oc_target",
        agentSessionId: "thread_a",
        imagePath: "/tmp/lark-connect/screen.png",
        replyToMessageId: "om_original",
        replyInThread: true,
      },
    });
  });

  it("forwards video send calls to the local daemon client", async () => {
    let observedAgentSessionId;
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_send_video", {
        agentSessionId: "thread_a",
        videoPath: "/tmp/lark-connect/demo.mp4",
        coverImagePath: "/tmp/lark-connect/demo-cover.png",
        replyToMessageId: "om_original",
        replyInThread: true,
      }),
      {
        createDaemonHttpClientImpl: () => ({
          sendVideo: async (agentSessionId, args) => {
            observedAgentSessionId = agentSessionId;
            observedArgs = args;
            return {
              message: {
                id: "om_video",
                larkMessageId: "om_video",
                chatId: "oc_target",
                agentSessionId,
                coverImageKey: "img_cover",
                ...args,
              },
            };
          },
        }),
      },
    );

    assert.equal(observedAgentSessionId, "thread_a");
    assert.deepEqual(observedArgs, {
      videoPath: "/tmp/lark-connect/demo.mp4",
      coverImagePath: "/tmp/lark-connect/demo-cover.png",
      replyToMessageId: "om_original",
      replyInThread: true,
    });
    assert.deepEqual(parseToolJson(response), {
      message: {
        id: "om_video",
        larkMessageId: "om_video",
        chatId: "oc_target",
        agentSessionId: "thread_a",
        videoPath: "/tmp/lark-connect/demo.mp4",
        coverImagePath: "/tmp/lark-connect/demo-cover.png",
        coverImageKey: "img_cover",
        replyToMessageId: "om_original",
        replyInThread: true,
      },
    });
  });

  it("forwards resource download calls to the local daemon client", async () => {
    let observedAgentSessionId;
    let observedArgs;
    const response = await handleMcpMessage(
      toolCall("lark_connect_download_resource", {
        agentSessionId: "thread_a",
        messageId: "om_resource",
        fileKey: "img_1",
        outputDir: "/tmp/lark-connect-downloads",
      }),
      {
        createDaemonHttpClientImpl: () => ({
          downloadResource: async (agentSessionId, args) => {
            observedAgentSessionId = agentSessionId;
            observedArgs = args;
            return {
              download: {
                agentSessionId,
                messageId: args.messageId,
                fileKey: args.fileKey,
                resourceType: "image",
                fileName: "screen.png",
                filePath: "/tmp/lark-connect-downloads/screen.png",
                size: 12,
              },
            };
          },
        }),
      },
    );

    assert.equal(observedAgentSessionId, "thread_a");
    assert.deepEqual(observedArgs, {
      messageId: "om_resource",
      fileKey: "img_1",
      outputDir: "/tmp/lark-connect-downloads",
    });
    assert.deepEqual(parseToolJson(response), {
      download: {
        agentSessionId: "thread_a",
        messageId: "om_resource",
        fileKey: "img_1",
        resourceType: "image",
        fileName: "screen.png",
        filePath: "/tmp/lark-connect-downloads/screen.png",
        size: 12,
      },
    });
  });
});
