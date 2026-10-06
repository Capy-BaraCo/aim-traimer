/**
 * Messages between the main thread and the analysis worker (T9), plus the one pure helper they share.
 * No DOM and no worker globals here, so vitest can run it in node.
 */
import type { Analysis, Structure } from './types';

/** Main thread to worker: analyse one decoded song. `channels` are transferred, one Float32Array per audio channel. */
export interface AnalyseRequest {
  id: number;
  channels: Float32Array[];
  sampleRate: number;
}

/** Worker to main thread: how far along an analysis is. */
export interface ProgressMessage {
  id: number;
  type: 'progress';
  stage: 'analysing' | 'sections';
  fraction: number;
}

/** Worker to main thread: the finished analysis and structure (`analysis.onsetEnv` is transferred). */
export interface DoneMessage {
  id: number;
  type: 'done';
  analysis: Analysis;
  structure: Structure;
}

/** Worker to main thread: the analysis failed. `message` is for developers, not the player. */
export interface FailMessage {
  id: number;
  type: 'error';
  message: string;
}

/** Everything the worker can post back. */
export type WorkerReply = ProgressMessage | DoneMessage | FailMessage;

/** Average channels into one mono signal. One channel is returned as is (no copy). */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i];
  const k = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}
