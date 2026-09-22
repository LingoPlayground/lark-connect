import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/release.yml", "utf8");

describe("plugin release", () => {
  it("validates the version tag and creates a GitHub release without publishing npm", () => {
    assert.match(workflow, /TAG_VERSION=.*GITHUB_REF_NAME/);
    assert.match(workflow, /npm run quality/);
    assert.match(workflow, /gh release create/);
    assert.doesNotMatch(workflow, /npm publish|npm pack|registry-url|id-token: write/);
  });
});
