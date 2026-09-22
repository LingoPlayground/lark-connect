import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

describe("private plugin repository", () => {
  it("has no published CLI or old SDK dependency", () => {
    assert.equal(pkg.private, true);
    assert.equal("bin" in pkg, false);
    assert.equal("@larksuiteoapi/node-sdk" in (pkg.dependencies || {}), false);
    assert.equal(pkg.engines.node, ">=22");
  });

  it("checks only the shipped script and plugin tests", () => {
    assert.match(pkg.scripts.build, /node --check/);
    assert.equal(pkg.scripts.test, "node --test");
    assert.match(pkg.scripts.lint, /eslint/);
    assert.equal(pkg.scripts.quality, "npm run build && npm run lint && npm test");
  });
});
