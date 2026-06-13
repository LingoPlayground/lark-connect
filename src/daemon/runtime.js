import { DAEMON_ERROR_CODES, DaemonRuntimeError } from "./errors.js";

const DEFAULT_IDLE_TIMEOUT_MS = 3_600_000;

function clone(value) {
  return globalThis.structuredClone(value);
}

function countMessages(messages, status) {
  let count = 0;
  for (const message of messages) {
    if (message.status === status) count += 1;
  }
  return count;
}

export function createDaemonRuntime(options = {}) {
  const now = options.now ?? (() => Date.now());
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const bindingsByChatId = new Map();
  const sessionsById = new Map();
  const seenLarkMessageIds = new Set();
  const waitersBySessionId = new Map();
  let lastActivityAt = now();
  let generatedMessageCount = 0;

  function touch() {
    lastActivityAt = now();
  }

  function getOrCreateSession(agentSessionId) {
    let session = sessionsById.get(agentSessionId);
    if (!session) {
      session = {
        agentSessionId,
        messages: new Map(),
      };
      sessionsById.set(agentSessionId, session);
    }
    return session;
  }

  function createSessionNotBoundError(agentSessionId) {
    return new DaemonRuntimeError(
      DAEMON_ERROR_CODES.SESSION_NOT_BOUND,
      agentSessionId
        ? `No Feishu chat is bound to agentSessionId ${agentSessionId}. Call lark_connect_bind_session first.`
        : "No Feishu chat is bound. Call lark_connect_bind_session first.",
      agentSessionId ? { agentSessionId } : {},
    );
  }

  function getBoundSession(agentSessionId) {
    const session = sessionsById.get(agentSessionId);
    if (!session) throw createSessionNotBoundError(agentSessionId);
    return session;
  }

  function createResourceNotFoundError(messageId, fileKey) {
    return new DaemonRuntimeError(
      DAEMON_ERROR_CODES.RESOURCE_NOT_FOUND,
      `resource ${fileKey} was not found on message ${messageId}`,
      { messageId, fileKey },
    );
  }

  function serializeBinding(binding) {
    return {
      chatId: binding.chatId,
      agentKind: binding.agentKind,
      agentSessionId: binding.agentSessionId,
      workspace: binding.workspace,
      createdAt: binding.createdAt,
    };
  }

  function serializeMessage(message) {
    return {
      id: message.id,
      larkMessageId: message.larkMessageId,
      chatId: message.chatId,
      agentSessionId: message.agentSessionId,
      status: message.status,
      payload: clone(message.payload),
      receivedAt: message.receivedAt,
      deliveredAt: message.deliveredAt,
      acknowledgedAt: message.acknowledgedAt,
    };
  }

  function deliverPendingMessages(agentSessionId) {
    const session = getBoundSession(agentSessionId);

    const deliveredAt = now();
    const messages = [];
    for (const message of session.messages.values()) {
      if (message.status !== "pending") continue;
      message.status = "delivered";
      message.deliveredAt = deliveredAt;
      messages.push(serializeMessage(message));
    }
    return messages;
  }

  function removeWaiter(agentSessionId, waiter) {
    const waiters = waitersBySessionId.get(agentSessionId);
    if (!waiters) return;
    const index = waiters.indexOf(waiter);
    if (index !== -1) waiters.splice(index, 1);
    if (waiters.length === 0) waitersBySessionId.delete(agentSessionId);
  }

  function flushWaiters(agentSessionId) {
    const waiters = waitersBySessionId.get(agentSessionId);
    if (!waiters) return;

    while (waiters.length > 0) {
      const messages = deliverPendingMessages(agentSessionId);
      if (messages.length === 0) return;
      const waiter = waiters.shift();
      clearTimeout(waiter.timeout);
      waiter.resolve(messages);
    }

    waitersBySessionId.delete(agentSessionId);
  }

  function snapshot() {
    const sessions = Array.from(sessionsById.values()).map((session) => {
      const messages = Array.from(session.messages.values());
      return {
        agentSessionId: session.agentSessionId,
        pendingCount: countMessages(messages, "pending"),
        deliveredCount: countMessages(messages, "delivered"),
        acknowledgedCount: countMessages(messages, "acknowledged"),
        messages: messages.map(serializeMessage),
      };
    });

    return {
      idleTimeoutMs,
      lastActivityAt,
      idleDeadlineAt: lastActivityAt + idleTimeoutMs,
      bindings: Array.from(bindingsByChatId.values()).map(serializeBinding),
      sessions,
    };
  }

  return {
    bindSession(input) {
      touch();

      const existing = bindingsByChatId.get(input.chatId);
      if (existing && !input.replace) {
        throw new DaemonRuntimeError(
          DAEMON_ERROR_CODES.BINDING_CONFLICT,
          `chat ${input.chatId} is already bound to ${existing.agentSessionId}`,
          { chatId: input.chatId, agentSessionId: existing.agentSessionId },
        );
      }

      if (existing) {
        sessionsById.delete(existing.agentSessionId);
      }

      const binding = {
        chatId: input.chatId,
        agentKind: input.agentKind,
        agentSessionId: input.agentSessionId,
        workspace: input.workspace,
        createdAt: now(),
      };
      bindingsByChatId.set(input.chatId, binding);
      getOrCreateSession(input.agentSessionId);
      return serializeBinding(binding);
    },

    receiveLarkMessage(payload) {
      touch();

      const larkMessageId = payload.messageId;
      if (larkMessageId && seenLarkMessageIds.has(larkMessageId)) {
        return { accepted: false, reason: "duplicate" };
      }
      if (larkMessageId) seenLarkMessageIds.add(larkMessageId);

      const binding = bindingsByChatId.get(payload.chatId);
      if (!binding || !payload.mentionedBot) {
        return { accepted: false, reason: "unrouted" };
      }

      const session = getOrCreateSession(binding.agentSessionId);
      const id = larkMessageId ?? `message_${++generatedMessageCount}`;
      const message = {
        id,
        larkMessageId: id,
        chatId: payload.chatId,
        agentSessionId: binding.agentSessionId,
        status: "pending",
        payload: clone(payload),
        receivedAt: now(),
      };
      session.messages.set(id, message);
      flushWaiters(binding.agentSessionId);
      return { accepted: true, message: serializeMessage(message) };
    },

    pollMessages(agentSessionId) {
      touch();
      return deliverPendingMessages(agentSessionId);
    },

    waitForMessages(agentSessionId, options = {}) {
      touch();

      const messages = deliverPendingMessages(agentSessionId);
      if (messages.length > 0) return Promise.resolve(messages);

      const timeoutMs = options.timeoutMs ?? 30_000;
      if (timeoutMs <= 0) return Promise.resolve([]);

      return new Promise((resolve) => {
        const waiter = {
          resolve,
          timeout: setTimeout(() => {
            removeWaiter(agentSessionId, waiter);
            resolve([]);
          }, timeoutMs),
        };
        const waiters = waitersBySessionId.get(agentSessionId) ?? [];
        waiters.push(waiter);
        waitersBySessionId.set(agentSessionId, waiters);
      });
    },

    ackMessage(messageId, options = {}) {
      touch();

      const sessions = options.agentSessionId
        ? [getBoundSession(options.agentSessionId)]
        : Array.from(sessionsById.values());
      if (sessions.length === 0) throw createSessionNotBoundError();

      for (const session of sessions) {
        const message = session.messages.get(messageId);
        if (!message) continue;
        message.status = "acknowledged";
        message.acknowledgedAt = now();
        return serializeMessage(message);
      }

      throw new DaemonRuntimeError(
        DAEMON_ERROR_CODES.MESSAGE_NOT_FOUND,
        `message ${messageId} was not found`,
        { messageId },
      );
    },

    findMessageResource(agentSessionId, messageId, fileKey) {
      touch();

      const session = getBoundSession(agentSessionId);
      const message = session.messages.get(messageId);
      if (!message) {
        throw new DaemonRuntimeError(
          DAEMON_ERROR_CODES.MESSAGE_NOT_FOUND,
          `message ${messageId} was not found`,
          { messageId },
        );
      }

      const resources = Array.isArray(message.payload?.resources)
        ? message.payload.resources
        : [];
      const resource = resources.find((item) => item?.fileKey === fileKey);
      if (!resource) throw createResourceNotFoundError(messageId, fileKey);

      return {
        message: serializeMessage(message),
        resource: clone(resource),
      };
    },

    getStatus() {
      touch();
      return snapshot();
    },

    snapshot,
  };
}
