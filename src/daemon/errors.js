export const DAEMON_ERROR_CODES = {
  DAEMON_NOT_RUNNING: "DAEMON_NOT_RUNNING",
  BINDING_CONFLICT: "BINDING_CONFLICT",
  SESSION_NOT_BOUND: "SESSION_NOT_BOUND",
  INVALID_REQUEST: "INVALID_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  MESSAGE_NOT_FOUND: "MESSAGE_NOT_FOUND",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  LARK_REACTION_FAILED: "LARK_REACTION_FAILED",
  LARK_SEND_FAILED: "LARK_SEND_FAILED",
  LARK_CHAT_SEARCH_FAILED: "LARK_CHAT_SEARCH_FAILED",
  LARK_CHAT_CONTEXT_FAILED: "LARK_CHAT_CONTEXT_FAILED",
  LARK_RESOURCE_DOWNLOAD_FAILED: "LARK_RESOURCE_DOWNLOAD_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

export const DAEMON_START_COMMAND = "npx -y curiosea-lark-connect@latest daemon start";

export class DaemonRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DaemonRuntimeError";
    this.code = code;
    this.details = details;
  }
}

export class DaemonHttpError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "DaemonHttpError";
    this.code = code;
    this.status = options.status;
    this.details = options.details;
    this.command = options.command;
  }
}

export function createDaemonNotRunningError() {
  return new DaemonHttpError(
    DAEMON_ERROR_CODES.DAEMON_NOT_RUNNING,
    `lark-connect daemon is not running. Start it with: ${DAEMON_START_COMMAND}`,
    {
      command: DAEMON_START_COMMAND,
    },
  );
}
