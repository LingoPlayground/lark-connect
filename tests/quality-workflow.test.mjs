import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/quality.yml", "utf8");

describe("quality workflow", () => {
  it("keeps the required pull request check on Node 22", () => {
    assert.match(workflow, /^name: Node Tool Gates$/m);
    assert.match(workflow, /node-version: "22"/);
    assert.match(workflow, /run: npm ci/);
    assert.match(workflow, /run: npm run quality/);
  });
});
