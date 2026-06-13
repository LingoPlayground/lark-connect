import {
  createDefaultLarkChannel,
  normalizeMessage,
  requireLarkAppConfig,
} from "./listener.js";

export function createLarkChannelRunner(config, options = {}) {
  requireLarkAppConfig(config, "daemon");
  const runtime = options.runtime;
  if (!runtime) throw new Error("runtime is required for lark channel runner");

  const channelFactory = options.channelFactory ?? createDefaultLarkChannel;
  let channel;
  let unsubscribe;
  let started = false;

  return {
    async start() {
      if (started) return { state: "connected" };

      channel = await channelFactory(config);
      unsubscribe = channel.on("message", (message) => {
        runtime.receiveLarkMessage(normalizeMessage(message));
      });
      await channel.connect();
      started = true;
      return { state: "connected" };
    },

    async stop() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = undefined;
      }
      await channel?.disconnect?.();
      channel = undefined;
      started = false;
    },
  };
}
