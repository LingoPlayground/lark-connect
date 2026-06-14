import { createDefaultLarkChannel, requireLarkAppConfig } from "./channel.js";
import { normalizeMessage } from "./listener.js";

export function createLarkChannelRunner(config, options = {}) {
  requireLarkAppConfig(config, "daemon");
  const runtime = options.runtime;
  if (!runtime) throw new Error("runtime is required for lark channel runner");

  const channelFactory = options.channelFactory ?? createDefaultLarkChannel;
  const state = {
    channel: undefined,
    startPromise: undefined,
    unsubscribe: undefined,
    started: false,
  };

  async function createConnectedChannel() {
    const nextChannel = await channelFactory(config);
    const nextUnsubscribe = nextChannel.on("message", (message) => {
      runtime.receiveLarkMessage(normalizeMessage(message));
    });

    try {
      await nextChannel.connect();
    } catch (error) {
      nextUnsubscribe();
      await nextChannel.disconnect?.();
      throw error;
    }

    return { channel: nextChannel, unsubscribe: nextUnsubscribe };
  }

  function storeConnectedChannel(connectedChannel) {
    state.channel = connectedChannel.channel;
    state.unsubscribe = connectedChannel.unsubscribe;
    state.started = true;
    return { state: "connected" };
  }

  return {
    async start() {
      if (state.started) return { state: "connected" };

      state.startPromise ??= createConnectedChannel()
        .then(storeConnectedChannel)
        .finally(() => {
          state.startPromise = undefined;
        });
      return state.startPromise;
    },

    async stop() {
      await state.startPromise;
      if (state.unsubscribe) {
        state.unsubscribe();
        state.unsubscribe = undefined;
      }
      await state.channel?.disconnect?.();
      state.channel = undefined;
      state.started = false;
    },
  };
}
