import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildLarkChannelPolicy } from "../src/lark/channel.js";

describe("lark channel", () => {
  it("opens direct message events while still requiring group mentions", () => {
    assert.deepEqual(buildLarkChannelPolicy(), {
      requireMention: true,
      dmMode: "open",
    });
  });

  it("includes a group allowlist only when configured", () => {
    assert.deepEqual(buildLarkChannelPolicy({ groupAllowlist: ["oc_target"] }), {
      requireMention: true,
      dmMode: "open",
      groupAllowlist: ["oc_target"],
    });
  });
});
