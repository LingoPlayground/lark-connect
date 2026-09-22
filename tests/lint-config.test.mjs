import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";

const eslint = new ESLint();
const scriptConfig = await eslint.calculateConfigForFile("plugins/lark-connect/skills/lark-chat-session/scripts/session.mjs");

describe("lint configuration", () => {
  it("checks the shipped script for common mistakes", () => {
    assert.deepEqual(scriptConfig.rules.eqeqeq, [2, "always", { null: "ignore" }]);
    assert.deepEqual(scriptConfig.rules["no-eval"], [2, { allowIndirect: false }]);
    assert.deepEqual(scriptConfig.rules["no-var"], [2]);
  });
});
