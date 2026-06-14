import { DAEMON_ERROR_CODES, DaemonRuntimeError } from "./errors.js";

const DEFAULT_IDLE_TIMEOUT_MS = 3_600_000;
const DEFAULT_DIRECT_CHAT_SIGNAL_TIMEOUT_MS = 60_000;
const MAX_DIRECT_CHAT_SIGNAL_BUFFER_SIZE = 50;

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
  const directChatSignalWaiters = [];
  const directChatSignalBuffer = [];
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
      chat_id: binding.chatId,
      agentKind: binding.agentKind,
      agent_kind: binding.agentKind,
      agentSessionId: binding.agentSessionId,
      agent_session_id: binding.agentSessionId,
      workspace: binding.workspace,
      createdAt: binding.createdAt,
    };
  }

  function requireNonEmptyString(input, field) {
    const value = String(input?.[field] ?? "").trim();
    if (!value) {
      throw new DaemonRuntimeError(
        DAEMON_ERROR_CODES.INVALID_REQUEST,
        `${field} is required`,
        { field },
      );
    }
    return value;
  }

  function normalizeBindingInput(input) {
    return {
      chatId: requireNonEmptyString(input, "chatId"),
      agentKind: requireNonEmptyString(input, "agentKind"),
      agentSessionId: requireNonEmptyString(input, "agentSessionId"),
      workspace: requireNonEmptyString(input, "workspace"),
      replace: Boolean(input?.replace),
    };
  }

  function normalizeTimeoutMs(value, defaultValue) {
    if (value === undefined) return defaultValue;
    const timeoutMs = Number(value);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
      throw new DaemonRuntimeError(
        DAEMON_ERROR_CODES.INVALID_REQUEST,
        "timeoutMs must be a non-negative integer",
        { field: "timeoutMs" },
      );
    }
    return timeoutMs;
  }

  function normalizeDirectChatSignalInput(input) {
    return {
      challengeText: requireNonEmptyString(input, "challengeText"),
      agentKind: requireNonEmptyString(input, "agentKind"),
      agentSessionId: requireNonEmptyString(input, "agentSessionId"),
      workspace: requireNonEmptyString(input, "workspace"),
      timeoutMs: normalizeTimeoutMs(
        input?.timeoutMs,
        DEFAULT_DIRECT_CHAT_SIGNAL_TIMEOUT_MS,
      ),
    };
  }

  function createMessageNotFoundError(messageId) {
    return new DaemonRuntimeError(
      DAEMON_ERROR_CODES.MESSAGE_NOT_FOUND,
      `message ${messageId} was not found`,
      { messageId },
    );
  }

  function requireAgentSessionId(options = {}) {
    const agentSessionId = String(options.agentSessionId ?? "").trim();
    if (!agentSessionId) {
      throw new DaemonRuntimeError(
        DAEMON_ERROR_CODES.INVALID_REQUEST,
        "agentSessionId is required",
        { field: "agentSessionId" },
      );
    }
    return agentSessionId;
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

  function normalizeMessageContent(value) {
    return String(value ?? "").trim();
  }

  function directChatSignalMatches(payload, challengeText) {
    return (
      payload.chatType === "p2p" &&
      normalizeMessageContent(payload.content) === challengeText
    );
  }

  function serializeDirectChatSignal(payload, input) {
    return {
      chatId: payload.chatId,
      chatType: payload.chatType,
      messageId: payload.messageId,
      larkMessageId: payload.messageId,
      senderId: payload.senderId,
      senderName: payload.senderName,
      content: payload.content,
      rawContentType: payload.rawContentType,
      createTime: payload.createTime,
      matchedChallenge: input.challengeText,
      bindingInput: {
        chatId: payload.chatId,
        agentKind: input.agentKind,
        agentSessionId: input.agentSessionId,
        workspace: input.workspace,
      },
    };
  }

  function rememberDirectChatSignal(payload) {
    directChatSignalBuffer.push({
      payload: clone(payload),
      receivedAt: now(),
    });
    while (directChatSignalBuffer.length > MAX_DIRECT_CHAT_SIGNAL_BUFFER_SIZE) {
      directChatSignalBuffer.shift();
    }
  }

  function markMessageSeen(payload) {
    if (payload.messageId) seenLarkMessageIds.add(payload.messageId);
  }

  function findBufferedDirectChatSignal(input) {
    const index = directChatSignalBuffer.findIndex((entry) =>
      directChatSignalMatches(entry.payload, input.challengeText),
    );
    if (index === -1) return undefined;
    const [entry] = directChatSignalBuffer.splice(index, 1);
    markMessageSeen(entry.payload);
    return serializeDirectChatSignal(entry.payload, input);
  }

  function removeDirectChatSignalWaiter(waiter) {
    const index = directChatSignalWaiters.indexOf(waiter);
    if (index !== -1) directChatSignalWaiters.splice(index, 1);
  }

  function resolveDirectChatSignalWaiter(payload) {
    const waiter = directChatSignalWaiters.find((candidate) =>
      directChatSignalMatches(payload, candidate.input.challengeText),
    );
    if (!waiter) return undefined;

    removeDirectChatSignalWaiter(waiter);
    clearTimeout(waiter.timeout);
    markMessageSeen(payload);
    const signal = serializeDirectChatSignal(payload, waiter.input);
    waiter.resolve(signal);
    return signal;
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
      const next = normalizeBindingInput(input);

      const existing = bindingsByChatId.get(next.chatId) ?? bindingsByChatId.values().next().value;
      if (existing && !next.replace) {
        throw new DaemonRuntimeError(
          DAEMON_ERROR_CODES.BINDING_CONFLICT,
          `chat ${existing.chatId} is already bound to ${existing.agentSessionId}`,
          { chatId: existing.chatId, agentSessionId: existing.agentSessionId },
        );
      }

      if (existing) {
        bindingsByChatId.clear();
        sessionsById.clear();
      }

      const binding = {
        chatId: next.chatId,
        agentKind: next.agentKind,
        agentSessionId: next.agentSessionId,
        workspace: next.workspace,
        createdAt: now(),
      };
      bindingsByChatId.set(next.chatId, binding);
      getOrCreateSession(next.agentSessionId);
      return serializeBinding(binding);
    },

    receiveLarkMessage(payload) {
      touch();

      const binding = bindingsByChatId.get(payload.chatId);
      const directMessage = payload.chatType === "p2p";
      if (!binding && directMessage) {
        if (payload.messageId && seenLarkMessageIds.has(payload.messageId)) {
          return { accepted: false, reason: "duplicate" };
        }

        const signal = resolveDirectChatSignalWaiter(payload);
        if (signal) {
          return { accepted: true, reason: "direct_chat_signal", signal };
        }

        rememberDirectChatSignal(payload);
        return { accepted: false, reason: "unrouted" };
      }

      if (!binding || (!directMessage && !payload.mentionedBot)) {
        return { accepted: false, reason: "unrouted" };
      }

      const larkMessageId = payload.messageId;
      if (larkMessageId && seenLarkMessageIds.has(larkMessageId)) {
        return { accepted: false, reason: "duplicate" };
      }
      if (larkMessageId) seenLarkMessageIds.add(larkMessageId);

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

    waitForDirectChatSignal(input) {
      touch();
      const next = normalizeDirectChatSignalInput(input);
      const buffered = findBufferedDirectChatSignal(next);
      if (buffered) return Promise.resolve(buffered);
      if (next.timeoutMs <= 0) return Promise.resolve(null);

      return new Promise((resolve) => {
        const waiter = {
          input: next,
          resolve,
          timeout: setTimeout(() => {
            removeDirectChatSignalWaiter(waiter);
            resolve(null);
          }, next.timeoutMs),
        };
        directChatSignalWaiters.push(waiter);
      });
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

    getMessageForAck(messageId, options = {}) {
      touch();
      const agentSessionId = requireAgentSessionId(options);
      const session = getBoundSession(agentSessionId);
      const message = session.messages.get(messageId);
      if (!message) throw createMessageNotFoundError(messageId);
      return serializeMessage(message);
    },

    ackMessage(messageId, options = {}) {
      touch();
      const agentSessionId = requireAgentSessionId(options);
      const session = getBoundSession(agentSessionId);
      const message = session.messages.get(messageId);
      if (!message) throw createMessageNotFoundError(messageId);

      message.status = "acknowledged";
      message.acknowledgedAt = now();
      return serializeMessage(message);
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
