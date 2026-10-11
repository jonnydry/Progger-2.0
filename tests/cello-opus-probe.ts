import { celloFormatOrder, celloSources } from '../lib/drone.ts';
import { prepareCelloBuffer } from '../lib/drone-audio.ts';

type FetchInput = Parameters<typeof fetch>[0];

const fetched: string[] = [];
const realFetch = window.fetch.bind(window);

function urlOf(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

window.fetch = (input, init) => {
  const url = urlOf(input);
  if (url.includes('/audio/')) fetched.push(url);
  return realFetch(input, init);
};

function peakOf(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (const sample of data) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

async function decodeLoop(
  context: BaseAudioContext,
  href: string,
): Promise<{ href: string; peak: number; samples: number; rate: number }> {
  const response = await realFetch(href);
  if (!response.ok) throw new Error(`Fetch failed for ${href}.`);
  const decoded = await context.decodeAudioData((await response.arrayBuffer()).slice(0));
  const looped = prepareCelloBuffer(context, decoded);
  return {
    href,
    peak: peakOf(looped),
    samples: looped.length,
    rate: looped.sampleRate,
  };
}

async function run(): Promise<void> {
  const audioAtStart = fetched.length;
  const probe = document.createElement('audio');
  const canPlay = {
    aac: probe.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
    opus: probe.canPlayType('audio/webm; codecs="opus"'),
  };
  const context = new AudioContext();
  const opusPeaks = [];
  for (const source of celloSources('opus')) {
    opusPeaks.push(await decodeLoop(context, source.href));
  }
  let aac = 'ok';
  try {
    await context.decodeAudioData(
      (await (await realFetch(celloSources('m4a')[0].href)).arrayBuffer()).slice(0),
    );
  } catch (error) {
    aac = error instanceof Error ? error.name : 'failed';
  }
  let fallback = 'missing';
  try {
    await context.decodeAudioData(new Uint8Array(16).buffer);
    fallback = 'garbage-decoded';
  } catch {
    const recovered = await decodeLoop(context, celloSources('opus')[0].href);
    fallback = recovered.peak > 0.2 ? 'opus-after-aac-failure' : 'quiet';
  }
  const natural = celloFormatOrder((mime) => probe.canPlayType(mime));
  await fetch('/result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ua: navigator.userAgent,
      audioAtStart,
      contextState: context.state,
      canPlay,
      natural,
      opusPeaks,
      aac,
      fallback,
    }),
  });
  document.title = 'done';
}

(window as Window & { startCello?: () => void }).startCello = () => {
  void run().catch(async (error: unknown) => {
    await fetch('/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        error:
          error instanceof Error
            ? `${error.message}\n${error.stack ?? ''}`
            : String(error),
      }),
    });
    document.title = 'done';
  });
};
