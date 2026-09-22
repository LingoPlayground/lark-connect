import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const pkg = json("package.json");
const codex = json("plugins/lark-connect/.codex-plugin/plugin.json");
const claude = json("plugins/lark-connect/.claude-plugin/plugin.json");
const codexMarketplace = json(".agents/plugins/marketplace.json");
const claudeMarketplace = json(".claude-plugin/marketplace.json");

describe("skill-only plugin packaging", () => {
  it("exposes the same plugin and version to both runtimes without MCP services", () => {
    assert.equal(codex.name, "lark-connect");
    assert.equal(claude.name, codex.name);
    assert.equal(codex.version, pkg.version);
    assert.equal(claude.version, pkg.version);
    assert.equal(codex.skills, "./skills/");
    assert.equal("mcpServers" in codex, false);
    assert.equal(existsSync("plugins/lark-connect/codex.mcp.json"), false);
    assert.equal(existsSync("plugins/lark-connect/.mcp.json"), false);
    assert.equal(codexMarketplace.plugins[0].version, pkg.version);
    assert.equal(claudeMarketplace.plugins[0].version, pkg.version);
  });

  it("ships the session script and teaches direct profile-bound lark-cli calls", () => {
    const skill = readFileSync("plugins/lark-connect/skills/lark-connect/SKILL.md", "utf8");
    assert.equal(existsSync("plugins/lark-connect/skills/lark-connect-setup"), false);
    assert.equal(existsSync("plugins/lark-connect/skills/lark-connect/scripts/session.mjs"), true);
    assert.match(skill, /session\.mjs start/);
    assert.match(skill, /session\.mjs checkpoint/);
    assert.match(skill, /--profile/);
    assert.match(skill, /--as bot\|user/);
    assert.match(skill, /event consume im\.message\.receive_v1/);
    assert.match(skill, /only_thread_root_messages/);
    assert.match(skill, /\+messages-reply/);
    assert.match(skill, /lark-cli config init/);
    assert.match(skill, /auth login/);
    assert.doesNotMatch(skill, /lark-connect-setup|lark_connect_\w+|DAEMON_NOT_RUNNING|curiosea-lark-connect@latest/);
  });
});
