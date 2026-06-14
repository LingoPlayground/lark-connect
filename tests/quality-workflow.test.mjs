import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/quality.yml", "utf8");

describe("quality workflow contract", () => {
  it("defines a stable required check for pull requests", () => {
    assert.match(workflow, /^name: Node Tool Gates$/m);
    assert.match(workflow, /^\s{2}pull_request:$/m);
    assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review\]/);
    assert.match(workflow, /^\s{4}name: Node Tool Gates$/m);
    assert.match(workflow, /github\.event\.pull_request\.draft == false/);
  });

  it("runs the repository quality entry on the supported Node version", () => {
    assert.match(workflow, /uses: actions\/checkout@v5/);
    assert.match(workflow, /uses: actions\/setup-node@v5/);
    assert.match(workflow, /node-version: "22"/);
    assert.match(workflow, /run: npm ci/);
    assert.match(workflow, /run: npm run quality/);
  });
});
