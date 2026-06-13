import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginRoot = join(repoRoot, "plugins", "lark-connect");

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));
}

function readText(relativePath) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function assertNpxMcpServer(server) {
  assert.equal(server.command, "npx");
  assert.deepEqual(server.args, ["-y", "curiosea-lark-connect@latest", "mcp"]);
  assert.deepEqual(server.env, {});
}

function assertClaudeNpxMcpServer(server) {
  assert.equal(server.type, "stdio");
  assertNpxMcpServer(server);
}

describe("dual runtime plugin packaging", () => {
  it("defines Codex and Claude plugin manifests for the same plugin", () => {
    const codexManifest = readJson("plugins/lark-connect/.codex-plugin/plugin.json");
    assert.equal(codexManifest.name, "lark-connect");
    assert.equal(codexManifest.version, "0.1.3");
    assert.equal(codexManifest.skills, "./skills/");
    assert.equal(codexManifest.mcpServers, "./codex.mcp.json");
    assert.match(codexManifest.description, /飞书/);
    assert.match(codexManifest.description, /搜索群聊/);
    assert.match(codexManifest.interface.shortDescription, /搜索飞书群聊/);
    assert.match(codexManifest.interface.longDescription, /lark_connect_search_chats|搜索机器人可见/);
    assert.match(codexManifest.interface.longDescription, /已绑定单聊不要求提及/);
    assert.match(codexManifest.interface.defaultPrompt.join("\n"), /帮我配置/);
    assert.match(codexManifest.interface.defaultPrompt.join("\n"), /搜索目标飞书群/);

    const claudeManifest = readJson("plugins/lark-connect/.claude-plugin/plugin.json");
    assert.equal(claudeManifest.name, "lark-connect");
    assert.equal(claudeManifest.version, codexManifest.version);
    assert.match(claudeManifest.description, /飞书/);
    assert.match(claudeManifest.description, /搜索群聊/);
    assert.match(claudeManifest.description, /聊天消息/);
  });

  it("registers the plugin in Codex and Claude marketplaces", () => {
    const codexMarketplace = readJson(".agents/plugins/marketplace.json");
    const codexEntry = codexMarketplace.plugins.find((entry) => entry.name === "lark-connect");
    assert.equal(codexEntry.source.path, "./plugins/lark-connect");
    assert.equal(codexEntry.policy.installation, "AVAILABLE");
    assert.equal(codexEntry.policy.authentication, "ON_INSTALL");

    const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
    assert.match(claudeMarketplace.description, /飞书/);
    assert.match(claudeMarketplace.description, /搜索/);
    const claudeEntry = claudeMarketplace.plugins.find((entry) => entry.name === "lark-connect");
    assert.match(claudeEntry.description, /飞书/);
    assert.match(claudeEntry.description, /搜索群聊/);
    assert.equal(claudeEntry.source, "./plugins/lark-connect");
    assert.equal(claudeEntry.category, "productivity");
  });

  it("ships MCP configs in the format expected by each runtime", () => {
    assert.equal(existsSync(join(repoRoot, ".mcp.json")), false);
    assert.equal(existsSync(join(repoRoot, ".codex", "config.toml")), false);
    assert.equal(existsSync(join(pluginRoot, "codex.mcp.json")), true);
    assert.equal(existsSync(join(pluginRoot, ".mcp.json")), true);

    const codexMcp = readJson("plugins/lark-connect/codex.mcp.json");
    assert.deepEqual(Object.keys(codexMcp), ["lark-connect"]);
    assertNpxMcpServer(codexMcp["lark-connect"]);

    const claudeMcp = readJson("plugins/lark-connect/.mcp.json");
    assertClaudeNpxMcpServer(claudeMcp.mcpServers["lark-connect"]);
  });

  it("ships setup and lark-connect skills at the plugin root", () => {
    assert.equal(pluginRoot.endsWith(join("plugins", "lark-connect")), true);

    const setupSkill = readText("plugins/lark-connect/skills/lark-connect-setup/SKILL.md");
    const setupOpenai = readText("plugins/lark-connect/skills/lark-connect-setup/agents/openai.yaml");
    assert.match(setupSkill, /^name: lark-connect-setup$/m);
    assert.match(setupOpenai, /display_name: "lark-connect-setup"/);
    assert.match(setupSkill, /^# 飞书连接配置$/m);
    assert.match(setupSkill, /npx -y curiosea-lark-connect@latest setup/);
    assert.match(setupSkill, /npx -y curiosea-lark-connect@latest doctor --live/);
    assert.match(setupSkill, /npx -y curiosea-lark-connect@latest daemon start/);
    assert.match(setupSkill, /机器人.*加入目标群/);

    assert.equal(
      existsSync(join(pluginRoot, "skills", "lark-connect-group-responder")),
      false,
    );

    const responderSkill = readText(
      "plugins/lark-connect/skills/lark-connect/SKILL.md",
    );
    const responderOpenai = readText(
      "plugins/lark-connect/skills/lark-connect/agents/openai.yaml",
    );
    assert.match(responderSkill, /^name: lark-connect$/m);
    assert.match(responderOpenai, /display_name: "lark-connect"/);
    assert.match(responderSkill, /^# 飞书连接$/m);
    assert.doesNotMatch(responderSkill, /验收/);
    assert.match(responderSkill, /lark_connect_search_chats/);
    assert.match(responderSkill, /创建群/);
    assert.match(responderSkill, /机器人拉入群/);
    assert.match(responderSkill, /lark_connect_bind_session/);
    assert.match(responderSkill, /不要编造/);
    assert.match(responderSkill, /单聊/);
    assert.match(responderSkill, /lark_connect_wait_messages/);
    assert.match(responderSkill, /timeoutMs.*60000/);
    assert.match(responderSkill, /thread automation/);
    assert.match(responderSkill, /background shell/);
    assert.match(
      responderSkill,
      /npx -y curiosea-lark-connect@latest wait --agent-session-id <绑定时使用的 agentSessionId> --timeout-ms 300000/,
    );
    assert.match(responderSkill, /5 分钟/);
    assert.match(responderSkill, /最多循环 10 次/);
    assert.match(responderSkill, /lark_connect_ack_message/);
  });
});
