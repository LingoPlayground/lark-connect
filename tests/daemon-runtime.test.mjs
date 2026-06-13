import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DAEMON_ERROR_CODES } from "../src/daemon/errors.js";
import { createDaemonRuntime } from "../src/daemon/runtime.js";

function createTestRuntime() {
  let now = 1_000;
  const runtime = createDaemonRuntime({
    idleTimeoutMs: 3_600_000,
    now: () => now,
  });

  return {
    runtime,
    advance(ms) {
      now += ms;
    },
    now() {
      return now;
    },
  };
}

function binding(overrides = {}) {
  return {
    chatId: "oc_target",
    agentKind: "codex",
    agentSessionId: "thread_a",
    workspace: "/workspace/app",
    ...overrides,
  };
}

function larkMessage(overrides = {}) {
  return {
    messageId: "om_1",
    chatId: "oc_target",
    chatType: "group",
    senderId: "ou_sender",
    senderName: "Designer",
    content: "Please tighten the title spacing",
    rawContentType: "text",
    mentionedBot: true,
    resources: [],
    rootId: "om_root",
    threadId: "omt_thread",
    replyToMessageId: "om_parent",
    createTime: 1_781_331_418_258,
    ...overrides,
  };
}

describe("daemon runtime bindings", () => {
  it("binds one chat to one explicit agent session", () => {
    const { runtime } = createTestRuntime();

    // VAL-BIND-001: bind request records the chat and agent session.
    const result = runtime.bindSession(binding());

    assert.equal(result.chatId, "oc_target");
    assert.equal(result.agentKind, "codex");
    assert.equal(result.agentSessionId, "thread_a");
    assert.equal(result.workspace, "/workspace/app");
    assert.deepEqual(runtime.snapshot().bindings, [result]);
  });

  it("rejects incomplete bindings before mutating runtime state", () => {
    const { runtime } = createTestRuntime();

    for (const [field, value] of [
      ["chatId", ""],
      ["agentKind", ""],
      ["agentSessionId", ""],
      ["workspace", ""],
    ]) {
      assert.throws(
        () => runtime.bindSession(binding({ [field]: value })),
        (error) =>
          error?.code === DAEMON_ERROR_CODES.INVALID_REQUEST &&
          error?.details?.field === field,
      );
    }

    assert.deepEqual(runtime.snapshot().bindings, []);
    assert.deepEqual(runtime.snapshot().sessions, []);
  });

  it("rejects any second binding unless replace is explicit", () => {
    const { runtime } = createTestRuntime();
    runtime.bindSession(binding());

    // VAL-BIND-002: the original binding survives a non-replace conflict.
    assert.throws(
      () =>
        runtime.bindSession(
          binding({ chatId: "oc_other", agentSessionId: "thread_b" }),
        ),
      (error) => error?.code === "BINDING_CONFLICT",
    );

    assert.deepEqual(runtime.snapshot().bindings.map((item) => item.agentSessionId), ["thread_a"]);
  });

  it("replaces an existing binding and drops the old session queue", () => {
    const { runtime } = createTestRuntime();
    runtime.bindSession(binding());
    runtime.receiveLarkMessage(larkMessage({ messageId: "om_before_replace" }));
    assert.equal(runtime.pollMessages("thread_a").length, 1);

    // VAL-BIND-003 and VAL-BIND-004: replace makes the new session unique and old messages disappear.
    runtime.bindSession(binding({ chatId: "oc_other", agentSessionId: "thread_b", replace: true }));

    assert.deepEqual(runtime.snapshot().bindings.map((item) => item.agentSessionId), ["thread_b"]);
    assert.deepEqual(runtime.snapshot().bindings.map((item) => item.chatId), ["oc_other"]);
    assert.throws(
      () => runtime.pollMessages("thread_a"),
      (error) => error?.code === DAEMON_ERROR_CODES.SESSION_NOT_BOUND,
    );
    assert.deepEqual(runtime.receiveLarkMessage(larkMessage({ messageId: "om_old_chat" })), {
      accepted: false,
      reason: "unrouted",
    });
    runtime.receiveLarkMessage(
      larkMessage({ messageId: "om_after_replace", chatId: "oc_other" }),
    );
    assert.deepEqual(
      runtime.pollMessages("thread_b").map((message) => message.larkMessageId),
      ["om_after_replace"],
    );
  });

  it("finds only resources attached to messages in the bound session", () => {
    const { runtime } = createTestRuntime();
    runtime.bindSession(binding());
    const payload = larkMessage({
      messageId: "om_resource",
      resources: [
        {
          type: "image",
          fileKey: "img_1",
          fileName: "screen.png",
        },
      ],
    });
    runtime.receiveLarkMessage(payload);

    assert.deepEqual(runtime.findMessageResource("thread_a", "om_resource", "img_1"), {
      message: {
        id: "om_resource",
        larkMessageId: "om_resource",
        chatId: "oc_target",
        agentSessionId: "thread_a",
        status: "pending",
        payload,
        receivedAt: 1_000,
        deliveredAt: undefined,
        acknowledgedAt: undefined,
      },
      resource: {
        type: "image",
        fileKey: "img_1",
        fileName: "screen.png",
      },
    });

    assert.throws(
      () => runtime.findMessageResource("thread_a", "om_resource", "missing_key"),
      (error) =>
        error?.code === DAEMON_ERROR_CODES.RESOURCE_NOT_FOUND &&
        error?.details?.messageId === "om_resource" &&
        error?.details?.fileKey === "missing_key",
    );
    assert.throws(
      () => runtime.findMessageResource("thread_a", "om_missing", "img_1"),
      (error) => error?.code === DAEMON_ERROR_CODES.MESSAGE_NOT_FOUND,
    );
    assert.throws(
      () => runtime.findMessageResource("thread_unbound", "om_resource", "img_1"),
      (error) => error?.code === DAEMON_ERROR_CODES.SESSION_NOT_BOUND,
    );
  });
});

describe("daemon runtime messages", () => {
  it("queues bound mentions, marks them delivered on poll, and consumes them only on ack", () => {
    const { runtime } = createTestRuntime();
    runtime.bindSession(binding());

    // VAL-MSG-001: a bound mention enters the bound agent session queue.
    runtime.receiveLarkMessage(larkMessage());
    const delivered = runtime.pollMessages("thread_a");

    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].id, "om_1");
    assert.equal(delivered[0].larkMessageId, "om_1");
    assert.equal(delivered[0].agentSessionId, "thread_a");
    assert.equal(delivered[0].payload.rootId, "om_root");

    // VAL-MSG-003: delivered but unacknowledged messages stay visible in status.
    assert.equal(runtime.snapshot().sessions[0].messages[0].status, "delivered");
    assert.deepEqual(runtime.pollMessages("thread_a"), []);

    // VAL-MSG-004: ack removes the message from pending work.
    runtime.ackMessage("om_1", { agentSessionId: "thread_a" });
    assert.equal(runtime.snapshot().sessions[0].messages[0].status, "acknowledged");
    assert.deepEqual(runtime.pollMessages("thread_a"), []);
  });

  it("does not route unbound chat messages to any existing session", () => {
    const { runtime } = createTestRuntime();
    runtime.bindSession(binding());

    // VAL-MSG-002: unbound chat messages are not delivered to other sessions.
    runtime.receiveLarkMessage(larkMessage({ messageId: "om_other", chatId: "oc_other" }));

    assert.deepEqual(runtime.pollMessages("thread_a"), []);
  });

  it("does not route bound chat messages that did not mention the bot", () => {
    const { runtime } = createTestRuntime();
    runtime.bindSession(binding());

    const result = runtime.receiveLarkMessage(
      larkMessage({ messageId: "om_no_mention", mentionedBot: false }),
    );

    assert.deepEqual(result, { accepted: false, reason: "unrouted" });
    assert.deepEqual(runtime.pollMessages("thread_a"), []);
  });

  it("deduplicates repeated lark message events in memory", () => {
    const { runtime } = createTestRuntime();
    runtime.bindSession(binding());

    runtime.receiveLarkMessage(larkMessage({ messageId: "om_duplicate" }));
    runtime.receiveLarkMessage(larkMessage({ messageId: "om_duplicate" }));

    assert.deepEqual(
      runtime.pollMessages("thread_a").map((message) => message.larkMessageId),
      ["om_duplicate"],
    );
  });

  it("returns an empty result when immediate polling has no messages", () => {
    const { runtime } = createTestRuntime();
    runtime.bindSession(binding());

    // VAL-MSG-005: empty immediate poll is a successful empty result.
    assert.deepEqual(runtime.pollMessages("thread_a"), []);
  });

  it("resolves a waiting poll when a new bound message arrives", async () => {
    const { runtime } = createTestRuntime();
    runtime.bindSession(binding());

    const pending = runtime.waitForMessages("thread_a", { timeoutMs: 1_000 });
    runtime.receiveLarkMessage(larkMessage({ messageId: "om_waited" }));

    const messages = await pending;
    assert.deepEqual(
      messages.map((message) => message.larkMessageId),
      ["om_waited"],
    );
    assert.equal(runtime.snapshot().sessions[0].messages[0].status, "delivered");
  });

  it("resolves a waiting poll with an empty result on timeout", async () => {
    const { runtime } = createTestRuntime();
    runtime.bindSession(binding());

    // VAL-MSG-006: wait timeout is not a system error.
    const messages = await runtime.waitForMessages("thread_a", { timeoutMs: 0 });

    assert.deepEqual(messages, []);
  });

  it("reports an unbound session before polling, waiting, or acknowledging", () => {
    const { runtime } = createTestRuntime();

    // VAL-BIND-005: missing bind is different from a bound session with no messages.
    for (const call of [
      () => runtime.pollMessages("thread_unbound"),
      () => runtime.waitForMessages("thread_unbound", { timeoutMs: 0 }),
      () => runtime.ackMessage("om_missing", { agentSessionId: "thread_unbound" }),
    ]) {
      assert.throws(
        call,
        (error) =>
          error?.code === DAEMON_ERROR_CODES.SESSION_NOT_BOUND &&
          error?.details?.agentSessionId === "thread_unbound",
      );
    }

    assert.throws(
      () => runtime.ackMessage("om_missing"),
      (error) =>
        error?.code === DAEMON_ERROR_CODES.INVALID_REQUEST &&
        error?.details?.field === "agentSessionId",
    );
  });
});

describe("daemon runtime activity", () => {
  it("refreshes the idle deadline when any lark event arrives", () => {
    const harness = createTestRuntime();
    const { runtime } = harness;
    const initialDeadline = runtime.snapshot().idleDeadlineAt;
    harness.advance(2_000);

    // VAL-DAEM-004: even an unbound event restarts idle countdown.
    runtime.receiveLarkMessage(larkMessage({ chatId: "oc_unbound" }));

    assert.equal(runtime.snapshot().idleDeadlineAt, harness.now() + 3_600_000);
    assert.notEqual(runtime.snapshot().idleDeadlineAt, initialDeadline);
  });

  it("refreshes the idle deadline when a local call arrives", () => {
    const harness = createTestRuntime();
    const { runtime } = harness;
    harness.advance(2_000);

    // VAL-DAEM-005: binding is a local daemon call and restarts idle countdown.
    runtime.bindSession(binding());

    assert.equal(runtime.snapshot().idleDeadlineAt, harness.now() + 3_600_000);
  });
});
