import { OfflineAudioContext } from 'node-web-audio-api';

/**
 * node-web-audio-api exposes suspend, and that call can throw
 * InvalidStateError while a render is already moving. Firefox's offline
 * context has no suspend, so the output chain patches the route before the
 * first sample. Node renders that go through the chain use this same path.
 */
export function offlineContextWithoutSuspend(
  channels: number,
  length: number,
  sampleRate: number,
): OfflineAudioContext {
  const context = new OfflineAudioContext(channels, length, sampleRate);
  Object.defineProperty(context, 'suspend', {
    configurable: true,
    value: undefined,
  });
  return context;
}
