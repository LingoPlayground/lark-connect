import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js", "tests/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "array-callback-return": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-implicit-coercion": ["error", { boolean: true, number: true, string: true }],
      "no-new-func": "error",
      "no-param-reassign": ["error", { props: false }],
      "no-promise-executor-return": "error",
      "no-return-assign": ["error", "always"],
      "no-unused-expressions": "error",
      "no-use-before-define": ["error", { functions: false, classes: true, variables: true }],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all", ignoreReadBeforeAssign: true }],
      "prefer-promise-reject-errors": "error",
      radix: "error",
    },
  },
  {
    files: ["src/cli.js"],
    rules: {
      "no-console": "off",
    },
  },
];
