import { createDaemonRuntime } from "./runtime.js";
import { createDaemonHttpServer } from "./http-server.js";
import { createLarkChannelRunner } from "../lark/channel-runner.js";
import { createLarkMessageClient } from "../lark/messages.js";
import { createLarkReactionClient } from "../lark/reactions.js";
import { createLarkResourceClient } from "../lark/resources.js";

function nextIdleDelay(runtime) {
  return Math.max(0, runtime.snapshot().idleDeadlineAt - Date.now());
}

export async function startDaemon(config, options = {}) {
  const runtime =
    options.runtime ??
    createDaemonRuntime({
      idleTimeoutMs: config.daemonIdleTimeoutMs,
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
      resourceClient,
      onShutdown: () => close(),
    });

  async function close() {
    if (closePromise) return closePromise;

    closePromise = (async () => {
      if (idleTimer) clearTimeout(idleTimer);
      await channelRunner.stop?.();
      await reactionClient?.close?.();
      await messageClient?.close?.();
      await resourceClient?.close?.();
      await httpServer.close();
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

  await channelRunner.start();
  const address = await httpServer.listen();
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
