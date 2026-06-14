import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

describe("package quality gate contract", () => {
  it("keeps the npm CLI entry publishable", () => {
    assert.equal(pkg.bin["curiosea-lark-connect"], "src/cli.js");
    assert.equal(existsSync(pkg.bin["curiosea-lark-connect"]), true);
    assert.equal(
      readFileSync(pkg.bin["curiosea-lark-connect"], "utf8").startsWith(
        "#!/usr/bin/env node\n",
      ),
      true,
    );
  });

  it("keeps quality gate scripts wired to the repository checks", () => {
    assert.match(pkg.scripts.build, /node --check/);
    assert.equal(pkg.scripts.test, "node --test");
    assert.equal(pkg.scripts.typecheck, "npm run build");
    assert.equal(pkg.scripts["pack:check"], "npm pack --dry-run --json");
    assert.equal(
      pkg.scripts.quality,
      "npm run build && npm test && npm run pack:check",
    );
  });

  it("keeps npm package metadata aligned with the runtime support policy", () => {
    assert.deepEqual(pkg.files, ["src", "README.md"]);
    assert.equal(pkg.engines.node, ">=22");
    assert.equal(pkg.license, "MIT");
    assert.equal(pkg.repository.type, "git");
    assert.match(pkg.repository.url, /LingoPlayground\/lark-connect\.git$/);
  });
});
