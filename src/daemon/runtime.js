import { DAEMON_ERROR_CODES, DaemonRuntimeError } from "./errors.js";
import { createNoopLogger } from "./logger.js";

const DEFAULT_IDLE_TIMEOUT_MS = 3_600_000;
const DEFAULT_DIRECT_CHAT_SIGNAL_TIMEOUT_MS = 60_000;
const MAX_DIRECT_CHAT_SIGNAL_BUFFER_SIZE = 50;
const DEFAULT_DIRECT_CHAT_SIGNAL_BUFFER_TTL_MS = 300_000;
const MAX_RUNTIME_WAIT_TIMEOUT_MS = 2_147_483_647;

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
  const logger = options.logger ?? createNoopLogger();
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const directChatSignalBufferTtlMs =
    options.directChatSignalBufferTtlMs ?? DEFAULT_DIRECT_CHAT_SIGNAL_BUFFER_TTL_MS;
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

  function writeLog(event, details = {}) {
    try {
      logger.write(event, details);
    } catch {
      // Logging is diagnostic only; it must not break message delivery.
    }
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
      replace: normalizeReplace(input?.replace),
    };
  }

  function normalizeReplace(value) {
    if (value === undefined) return false;
    if (typeof value !== "boolean") {
      throw new DaemonRuntimeError(
        DAEMON_ERROR_CODES.INVALID_REQUEST,
        "replace must be a boolean",
        { field: "replace" },
      );
    }
    return value;
  }

  function normalizeTimeoutMs(value, defaultValue) {
    if (value === undefined) return defaultValue;
    const timeoutMs = Number(value);
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 0 ||
      timeoutMs > MAX_RUNTIME_WAIT_TIMEOUT_MS
    ) {
      throw new DaemonRuntimeError(
        DAEMON_ERROR_CODES.INVALID_REQUEST,
        `timeoutMs must be a non-negative integer up to ${MAX_RUNTIME_WAIT_TIMEOUT_MS}`,
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

  function pruneDirectChatSignalBuffer() {
    const cutoff = now() - directChatSignalBufferTtlMs;
    for (let index = directChatSignalBuffer.length - 1; index >= 0; index -= 1) {
      if (directChatSignalBuffer[index].receivedAt < cutoff) {
        directChatSignalBuffer.splice(index, 1);
      }
    }
  }

  function hasBufferedDirectChatSignal(payload) {
    return Boolean(
      payload.messageId &&
        directChatSignalBuffer.some((entry) => entry.payload.messageId === payload.messageId),
    );
  }

  function rememberDirectChatSignal(payload) {
    pruneDirectChatSignalBuffer();
    directChatSignalBuffer.push({
      payload: clone(payload),
      receivedAt: now(),
    });
    markMessageSeen(payload);
    while (directChatSignalBuffer.length > MAX_DIRECT_CHAT_SIGNAL_BUFFER_SIZE) {
      directChatSignalBuffer.shift();
    }
  }

  function markMessageSeen(payload) {
    if (payload.messageId) seenLarkMessageIds.add(payload.messageId);
  }

  function findBufferedDirectChatSignal(input) {
    pruneDirectChatSignalBuffer();
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

  function clearPendingWaiters() {
    for (const waiters of waitersBySessionId.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve([]);
      }
    }
    waitersBySessionId.clear();

    while (directChatSignalWaiters.length > 0) {
      const waiter = directChatSignalWaiters.shift();
      clearTimeout(waiter.timeout);
      waiter.resolve(null);
    }
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

  function getSessionDiagnostics(agentSessionId) {
    const session = getBoundSession(agentSessionId);
    const messages = Array.from(session.messages.values());
    return {
      agentSessionId,
      pendingCount: countMessages(messages, "pending"),
      deliveredCount: countMessages(messages, "delivered"),
      acknowledgedCount: countMessages(messages, "acknowledged"),
      waiterCount: waitersBySessionId.get(agentSessionId)?.length ?? 0,
    };
  }

  function deliverPendingMessages(agentSessionId, options = {}) {
    const session = getBoundSession(agentSessionId);
    const deliverySource = options.deliverySource ?? "unknown";

    const deliveredAt = now();
    const messages = [];
    for (const message of session.messages.values()) {
      if (message.status !== "pending") continue;
      message.status = "delivered";
      message.deliveredAt = deliveredAt;
      messages.push(serializeMessage(message));
    }
    if (messages.length > 0) {
      writeLog("message_delivered", {
        agentSessionId,
        deliverySource,
        messageIds: messages.map((message) => message.larkMessageId),
      });
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
      const waiter = waiters[0];
      const messages = deliverPendingMessages(agentSessionId, {
        deliverySource: waiter.deliverySource,
      });
      if (messages.length === 0) return;
      waiters.shift();
      clearTimeout(waiter.timeout);
      waiter.resolve(messages);
      writeLog("wait_resolved", {
        agentSessionId,
        deliverySource: waiter.deliverySource,
        messageIds: messages.map((message) => message.larkMessageId),
      });
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
        clearPendingWaiters();
        bindingsByChatId.clear();
        sessionsById.clear();
        directChatSignalBuffer.length = 0;
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
      writeLog("binding_created", serializeBinding(binding));
      return serializeBinding(binding);
    },

    receiveLarkMessage(payload) {
      touch();

      const binding = bindingsByChatId.get(payload.chatId);
      const directMessage = payload.chatType === "p2p";
      writeLog("lark_event_received", {
        agentSessionId: binding?.agentSessionId,
        messageId: payload.messageId,
        chatId: payload.chatId,
        chatType: payload.chatType,
        mentionedBot: Boolean(payload.mentionedBot),
      });
      if (!binding && directMessage) {
        pruneDirectChatSignalBuffer();
        if (
          payload.messageId &&
          (seenLarkMessageIds.has(payload.messageId) || hasBufferedDirectChatSignal(payload))
        ) {
          return { accepted: false, reason: "duplicate" };
        }

        const signal = resolveDirectChatSignalWaiter(payload);
        if (signal) {
          return { accepted: true, reason: "direct_chat_signal", signal };
        }

        rememberDirectChatSignal(payload);
        return { accepted: false, reason: "direct_chat_signal_buffered" };
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
      writeLog("message_enqueued", {
        agentSessionId: binding.agentSessionId,
        chatId: payload.chatId,
        messageId: id,
        larkMessageId: id,
      });
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

    pollMessages(agentSessionId, options = {}) {
      touch();
      return deliverPendingMessages(agentSessionId, {
        deliverySource: options.deliverySource,
      });
    },

    waitForMessages(agentSessionId, options = {}) {
      touch();

      const deliverySource = options.deliverySource ?? "unknown_wait";
      const messages = deliverPendingMessages(agentSessionId, { deliverySource });
      if (messages.length > 0) {
        writeLog("wait_resolved", {
          agentSessionId,
          deliverySource,
          messageIds: messages.map((message) => message.larkMessageId),
        });
        return Promise.resolve(messages);
      }

      const timeoutMs = options.timeoutMs ?? 30_000;
      if (timeoutMs <= 0) {
        writeLog("wait_timeout", {
          agentSessionId,
          deliverySource,
          timeoutMs,
        });
        return Promise.resolve([]);
      }

      return new Promise((resolve) => {
        const waiter = {
          deliverySource,
          resolve,
          timeout: setTimeout(() => {
            removeWaiter(agentSessionId, waiter);
            writeLog("wait_timeout", {
              agentSessionId,
              deliverySource,
              timeoutMs,
            });
            resolve([]);
          }, timeoutMs),
        };
        const waiters = waitersBySessionId.get(agentSessionId) ?? [];
        waiters.push(waiter);
        waitersBySessionId.set(agentSessionId, waiters);
        writeLog("wait_registered", {
          agentSessionId,
          deliverySource,
          timeoutMs,
        });
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
      writeLog("message_acknowledged", {
        agentSessionId,
        messageId: message.id,
        larkMessageId: message.larkMessageId,
      });
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

    getSessionDiagnostics,
    snapshot,
  };
}
