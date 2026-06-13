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
    assert.equal(codexManifest.skills, "./skills/");
    assert.equal(codexManifest.mcpServers, "./codex.mcp.json");
    assert.match(codexManifest.description, /飞书/);
    assert.match(codexManifest.interface.shortDescription, /群聊/);
    assert.match(codexManifest.interface.longDescription, /只接收明确/);
    assert.match(codexManifest.interface.defaultPrompt.join("\n"), /帮我配置/);

    const claudeManifest = readJson("plugins/lark-connect/.claude-plugin/plugin.json");
    assert.equal(claudeManifest.name, "lark-connect");
    assert.equal(claudeManifest.version, codexManifest.version);
    assert.match(claudeManifest.description, /飞书/);
    assert.match(claudeManifest.description, /群聊/);
  });

  it("registers the plugin in Codex and Claude marketplaces", () => {
    const codexMarketplace = readJson(".agents/plugins/marketplace.json");
    const codexEntry = codexMarketplace.plugins.find((entry) => entry.name === "lark-connect");
    assert.equal(codexEntry.source.path, "./plugins/lark-connect");
    assert.equal(codexEntry.policy.installation, "AVAILABLE");
    assert.equal(codexEntry.policy.authentication, "ON_INSTALL");

    const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
    assert.match(claudeMarketplace.description, /飞书/);
    const claudeEntry = claudeMarketplace.plugins.find((entry) => entry.name === "lark-connect");
    assert.match(claudeEntry.description, /飞书/);
    assert.equal(claudeEntry.source, "./plugins/lark-connect");
    assert.equal(claudeEntry.category, "productivity");
  });

  it("ships MCP configs in the format expected by each runtime", () => {
    assert.equal(existsSync(join(pluginRoot, "codex.mcp.json")), true);
    assert.equal(existsSync(join(pluginRoot, ".mcp.json")), true);

    const codexMcp = readJson("plugins/lark-connect/codex.mcp.json");
    assert.deepEqual(Object.keys(codexMcp), ["lark-connect"]);
    assertNpxMcpServer(codexMcp["lark-connect"]);

    const claudeMcp = readJson("plugins/lark-connect/.mcp.json");
    assertClaudeNpxMcpServer(claudeMcp.mcpServers["lark-connect"]);
  });

  it("ships setup and group responder skills at the plugin root", () => {
    assert.equal(pluginRoot.endsWith(join("plugins", "lark-connect")), true);

    const setupSkill = readText("plugins/lark-connect/skills/lark-connect-setup/SKILL.md");
    assert.match(setupSkill, /^name: lark-connect-setup$/m);
    assert.match(setupSkill, /^# 飞书连接配置$/m);
    assert.match(setupSkill, /npx -y curiosea-lark-connect@latest setup/);
    assert.match(setupSkill, /npx -y curiosea-lark-connect@latest doctor --live/);
    assert.match(setupSkill, /npx -y curiosea-lark-connect@latest daemon start/);
    assert.match(setupSkill, /机器人.*加入目标群/);

    const responderSkill = readText(
      "plugins/lark-connect/skills/lark-connect-group-responder/SKILL.md",
    );
    assert.match(responderSkill, /^name: lark-connect-group-responder$/m);
    assert.match(responderSkill, /^# 飞书群消息响应$/m);
    assert.doesNotMatch(responderSkill, /验收/);
    assert.match(responderSkill, /lark_connect_bind_session/);
    assert.match(responderSkill, /不要编造/);
    assert.match(responderSkill, /lark_connect_wait_messages/);
    assert.match(responderSkill, /timeoutMs.*60000/);
    assert.match(responderSkill, /thread automation/);
    assert.match(responderSkill, /background shell/);
    assert.match(responderSkill, /curiosea-lark-connect@latest wait/);
    assert.match(responderSkill, /5 分钟/);
    assert.match(responderSkill, /最多循环 10 次/);
    assert.match(responderSkill, /lark_connect_ack_message/);
  });
});
