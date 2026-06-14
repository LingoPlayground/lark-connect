import { createDaemonRuntime } from "./runtime.js";
import { createDaemonHttpServer } from "./http-server.js";
import { createJsonlLogger } from "./logger.js";
import { createLarkChannelRunner } from "../lark/channel-runner.js";
import { createLarkChatContextClient } from "../lark/chat-context.js";
import { createLarkChatMembersClient } from "../lark/chat-members.js";
import { createLarkChatClient } from "../lark/chats.js";
import { createLarkMessageClient } from "../lark/messages.js";
import { createLarkReactionClient } from "../lark/reactions.js";
import { createLarkResourceClient } from "../lark/resources.js";

function nextIdleDelay(runtime) {
  return Math.max(0, runtime.snapshot().idleDeadlineAt - Date.now());
}

export async function startDaemon(config, options = {}) {
  const logger = options.logger ?? createJsonlLogger();
  function writeLog(event, details = {}) {
    try {
      logger.write(event, details);
    } catch {
      // Logging is diagnostic only; daemon lifecycle must not depend on it.
    }
  }
  const runtime =
    options.runtime ??
    createDaemonRuntime({
      idleTimeoutMs: config.daemonIdleTimeoutMs,
      logger,
    });
  const channelRunner =
    options.channelRunner ??
    createLarkChannelRunner(config, {
      runtime,
      channelFactory: options.channelFactory,
    });
  const reactionClient =
    options.reactionClient ??
    (options.httpServer
      ? undefined
      : await createLarkReactionClient(config, {
          channelFactory: options.reactionChannelFactory,
        }));
  const messageClient =
    options.messageClient ??
    (options.httpServer
      ? undefined
      : await createLarkMessageClient(config, {
          channelFactory: options.messageChannelFactory,
        }));
  const chatClient =
    options.chatClient ??
    (options.httpServer
      ? undefined
      : await createLarkChatClient(config, {
          channelFactory: options.chatChannelFactory,
        }));
  const chatContextClient =
    options.chatContextClient ??
    (options.httpServer
      ? undefined
      : await createLarkChatContextClient(config, {
          channelFactory: options.chatContextChannelFactory,
        }));
  const chatMembersClient =
    options.chatMembersClient ??
    (options.httpServer
      ? undefined
      : await createLarkChatMembersClient(config, {
          channelFactory: options.chatMembersChannelFactory,
        }));
  const resourceClient =
    options.resourceClient ??
    (options.httpServer
      ? undefined
      : await createLarkResourceClient(config, {
          channelFactory: options.resourceChannelFactory,
        }));

  let idleTimer;
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  let closePromise;

  const httpServer =
    options.httpServer ??
    createDaemonHttpServer({
      runtime,
      host: config.daemonHost,
      port: config.daemonPort,
      reactionClient,
      messageClient,
      chatClient,
      chatContextClient,
      chatMembersClient,
      resourceClient,
      onShutdown: () => close(),
    });

  async function close() {
    if (closePromise) return closePromise;

    closePromise = (async () => {
      writeLog("daemon_stopping");
      if (idleTimer) clearTimeout(idleTimer);
      await channelRunner.stop?.();
      await reactionClient?.close?.();
      await messageClient?.close?.();
      await chatClient?.close?.();
      await chatContextClient?.close?.();
      await chatMembersClient?.close?.();
      await resourceClient?.close?.();
      await httpServer.close();
      writeLog("daemon_stopped");
      resolveClosed();
    })();

    return closePromise;
  }

  function scheduleIdleCheck() {
    if (idleTimer) clearTimeout(idleTimer);
    const delay = nextIdleDelay(runtime);
    idleTimer = setTimeout(() => {
      if (nextIdleDelay(runtime) <= 0) {
        close();
        return;
      }
      scheduleIdleCheck();
    }, delay);
    idleTimer.unref?.();
  }

  writeLog("daemon_starting", {
    host: config.daemonHost,
    port: config.daemonPort,
    idleTimeoutMs: config.daemonIdleTimeoutMs,
  });
  await channelRunner.start();
  const address = await httpServer.listen();
  writeLog("daemon_started", {
    host: address.host,
    port: address.port,
    idleTimeoutMs: config.daemonIdleTimeoutMs,
  });
  scheduleIdleCheck();

  return {
    address,
    runtime,
    close,
    waitUntilClosed() {
      return closed;
    },
  };
}
