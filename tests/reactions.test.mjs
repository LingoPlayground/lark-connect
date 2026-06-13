import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createLarkReactionClient,
  DEFAULT_ACK_REACTION_EMOJI_TYPE,
} from "../src/lark/reactions.js";

describe("lark reactions", () => {
  it("adds the default acknowledgment reaction through the channel client", async () => {
    const observedCalls = [];
    const client = await createLarkReactionClient(
      {
        appId: "cli_test",
        appSecret: "secret",
        chatId: "oc_target",
      },
      {
        channelFactory: async () => ({
          async addReaction(messageId, emojiType) {
            observedCalls.push({ messageId, emojiType });
            return "reaction_1";
          },
        }),
      },
    );

    const result = await client.addMessageReaction("om_1");

    assert.equal(DEFAULT_ACK_REACTION_EMOJI_TYPE, "OK");
    assert.deepEqual(observedCalls, [
      {
        messageId: "om_1",
        emojiType: "OK",
      },
    ]);
    assert.deepEqual(result, {
      messageId: "om_1",
      emojiType: "OK",
      reactionId: "reaction_1",
    });
  });
});
