import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

function encodeMessage(message) {
  return `${JSON.stringify(message)}\n`;
}

function createMcpClient() {
  const child = spawn("node", ["src/cli.js", "mcp"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = Buffer.alloc(0);
  const responses = [];

  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = buffer.subarray(0, newlineIndex).toString("utf8").replace(/\r$/, "");
      responses.push(JSON.parse(line));
      buffer = buffer.subarray(newlineIndex + 1);
    }
  });

  return {
    child,
    send(message) {
      child.stdin.write(encodeMessage(message));
    },
    async nextResponse() {
      const started = Date.now();
      while (Date.now() - started < 2000) {
        if (responses.length > 0) return responses.shift();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Timed out waiting for MCP response");
    },
    async close() {
      child.stdin.end();
      child.kill();
    },
  };
}

describe("mcp server", () => {
  it("initializes without exposing setup_url", async () => {
    const client = createMcpClient();
    try {
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      });
      const initialized = await client.nextResponse();
      assert.equal(initialized.id, 1);
      assert.equal(initialized.result.serverInfo.name, "curiosea-lark-connect");

      client.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      const tools = await client.nextResponse();
      assert.equal(tools.id, 2);
      const toolNames = tools.result.tools.map((tool) => tool.name);
      assert.equal(toolNames.includes("setup_url"), false);
      assert.equal(toolNames.includes("lark_connect_daemon_status"), true);

      client.send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "setup_url",
          arguments: { appId: "cli_test_app" },
        },
      });
      const call = await client.nextResponse();
      assert.equal(call.id, 3);
      assert.equal(call.error.code, -32602);
      assert.match(call.error.message, /unknown tool: setup_url/);
    } finally {
      await client.close();
    }
  });

  it("returns a parse error for invalid JSON without exiting", async () => {
    const client = createMcpClient();
    try {
      client.child.stdin.write("{bad json}\n");
      const parseError = await client.nextResponse();
      assert.equal(parseError.id, null);
      assert.equal(parseError.error.code, -32700);

      client.send({ jsonrpc: "2.0", id: 4, method: "tools/list" });
      const tools = await client.nextResponse();
      assert.equal(tools.id, 4);
      assert.equal(Array.isArray(tools.result.tools), true);
    } finally {
      await client.close();
    }
  });
});
