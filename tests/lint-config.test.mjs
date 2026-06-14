import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ESLint } from "eslint";

const eslint = new ESLint();
const libraryConfig = await eslint.calculateConfigForFile("src/lark/doctor.js");
const cliConfig = await eslint.calculateConfigForFile("src/cli.js");

describe("lint configuration contract", () => {
  it("enables stricter bug-prevention rules for source and tests", () => {
    assert.deepEqual(libraryConfig.rules.eqeqeq, [2, "always", { null: "ignore" }]);
    assert.deepEqual(libraryConfig.rules["no-var"], [2]);
    assert.deepEqual(libraryConfig.rules["prefer-const"], [
      2,
      { destructuring: "all", ignoreReadBeforeAssign: true },
    ]);
    assert.deepEqual(libraryConfig.rules["no-implicit-coercion"], [
      2,
      {
        allow: [],
        boolean: true,
        disallowTemplateShorthand: false,
        number: true,
        string: true,
      },
    ]);
    assert.deepEqual(libraryConfig.rules["no-unused-expressions"], [
      2,
      {
        allowShortCircuit: false,
        allowTaggedTemplates: false,
        allowTernary: false,
        enforceForJSX: false,
        ignoreDirectives: false,
      },
    ]);
    assert.deepEqual(libraryConfig.rules["no-param-reassign"], [2, { props: false }]);
    assert.deepEqual(libraryConfig.rules.radix, [2]);
  });

  it("prevents dynamic execution and unstructured promise failures", () => {
    assert.deepEqual(libraryConfig.rules["no-eval"], [2, { allowIndirect: false }]);
    assert.deepEqual(libraryConfig.rules["no-new-func"], [2]);
    assert.deepEqual(libraryConfig.rules["no-implied-eval"], [2]);
    assert.deepEqual(libraryConfig.rules["no-promise-executor-return"], [2, { allowVoid: false }]);
    assert.deepEqual(libraryConfig.rules["prefer-promise-reject-errors"], [
      2,
      { allowEmptyReject: false },
    ]);
  });

  it("allows console output only in the CLI entrypoint", () => {
    assert.deepEqual(libraryConfig.rules["no-console"], [2, { allow: ["warn", "error"] }]);
    assert.deepEqual(cliConfig.rules["no-console"], [0, { allow: ["warn", "error"] }]);
  });
});
