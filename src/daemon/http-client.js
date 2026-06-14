import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from "../config.js";
import { createDaemonNotRunningError, DaemonHttpError } from "./errors.js";

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  return JSON.parse(text);
}

export function createDaemonHttpClient(options = {}) {
  const host = options.host ?? DEFAULT_DAEMON_HOST;
  const port = options.port ?? DEFAULT_DAEMON_PORT;
  const baseUrl = `http://${host}:${port}`;

  async function request(path, requestOptions = {}) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: requestOptions.method ?? "GET",
        headers: {
          "content-type": "application/json",
        },
        body:
          requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
      });
    } catch {
      throw createDaemonNotRunningError();
    }

    const body = await parseJsonResponse(response);
    if (response.ok) return body;

    const error = body.error ?? {};
    throw new DaemonHttpError(error.code, error.message ?? "daemon request failed", {
      status: response.status,
      details: error.details,
      command: error.command,
    });
  }

  return {
    health() {
      return request("/health");
    },

    status() {
      return request("/status");
    },

    bindSession(input) {
      return request("/bindings", {
        method: "POST",
        body: input,
      });
    },

    searchChats(input = {}) {
      return request("/chats/search", {
        method: "POST",
        body: input,
      });
    },

    waitDirectChatSignal(input = {}) {
      return request("/direct-chat/signals/wait", {
        method: "POST",
        body: input,
      });
    },

    pollMessages(agentSessionId) {
      return request(`/sessions/${encodeURIComponent(agentSessionId)}/messages`);
    },

    waitForMessages(agentSessionId, options = {}) {
      const query = new URLSearchParams();
      if (options.timeoutMs !== undefined) query.set("timeout_ms", String(options.timeoutMs));
      const suffix = query.size > 0 ? `?${query}` : "";
      return request(
        `/sessions/${encodeURIComponent(agentSessionId)}/messages/wait${suffix}`,
      );
    },

    getChatContext(agentSessionId, input = {}) {
      return request(`/sessions/${encodeURIComponent(agentSessionId)}/chat-context`, {
        method: "POST",
        body: input,
      });
    },

    getChatMembers(agentSessionId, input = {}) {
      return request(`/sessions/${encodeURIComponent(agentSessionId)}/chat-members`, {
        method: "POST",
        body: input,
      });
    },

    ackMessage(messageId, input = {}) {
      return request(`/messages/${encodeURIComponent(messageId)}/ack`, {
        method: "POST",
        body: input,
      });
    },

    sendMessage(agentSessionId, input = {}) {
      return request(`/sessions/${encodeURIComponent(agentSessionId)}/send-message`, {
        method: "POST",
        body: input,
      });
    },

    sendFile(agentSessionId, input = {}) {
      return request(`/sessions/${encodeURIComponent(agentSessionId)}/send-file`, {
        method: "POST",
        body: input,
      });
    },

    sendImage(agentSessionId, input = {}) {
      return request(`/sessions/${encodeURIComponent(agentSessionId)}/send-image`, {
        method: "POST",
        body: input,
      });
    },

    sendVideo(agentSessionId, input = {}) {
      return request(`/sessions/${encodeURIComponent(agentSessionId)}/send-video`, {
        method: "POST",
        body: input,
      });
    },

    downloadResource(agentSessionId, input = {}) {
      return request(`/sessions/${encodeURIComponent(agentSessionId)}/resources/download`, {
        method: "POST",
        body: input,
      });
    },

    shutdown() {
      return request("/shutdown", {
        method: "POST",
      });
    },
  };
}
