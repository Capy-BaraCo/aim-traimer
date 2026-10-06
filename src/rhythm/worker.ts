/**
 * Analysis worker (T9): downmixes a decoded song to mono, runs analyse() then structure(), and posts
 * progress, so the heavy work never blocks the page. Started by prepare() in src/core/songs.ts as
 * `new Worker(new URL('../rhythm/worker.ts', import.meta.url), { type: 'module' })`.
 */
import { analyse } from './analysis';
import { structure } from './sections';
import { downmixToMono, type AnalyseRequest, type WorkerReply } from './worker-protocol';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<AnalyseRequest>) => void) | null;
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, channels, sampleRate } = e.data;
  try {
    scope.postMessage({ id, type: 'progress', stage: 'analysing', fraction: 0 });
    const analysis = analyse(downmixToMono(channels), sampleRate);
    scope.postMessage({ id, type: 'progress', stage: 'sections', fraction: 0 });
    const s = structure(analysis);
    scope.postMessage({ id, type: 'done', analysis, structure: s }, [analysis.onsetEnv.buffer]);
  } catch (err) {
    scope.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
