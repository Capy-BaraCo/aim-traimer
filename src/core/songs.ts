/**
 * Song library (Overdrive, D11): the player's own audio files, kept in IndexedDB.
 *
 * Audio, song details and cached analysis live in the database "azimuth-songs", never in the
 * localStorage profile, so the Settings backup export (Store.exportJson) holds no audio. Three
 * object stores, all keyed by song id (SHA-256 hex of the file bytes): `songs` (SongMeta),
 * `blobs` (the audio) and `analyses` (cached analysis + structure). They are separate so list()
 * never loads audio. The pure helpers need no DOM, so vitest runs them in node; the database
 * calls need a browser.
 */
import { ANALYSIS_VERSION } from '../rhythm/analysis';
import { structure as buildStructure } from '../rhythm/sections';
import type { Analysis, Difficulty, PresetId, SongMeta, Structure } from '../rhythm/types';
import type { AnalyseRequest, WorkerReply } from '../rhythm/worker-protocol';
import type { Audio } from './audio';

const DB_NAME = 'azimuth-songs';
const DB_VERSION = 1;
const S_SONGS = 'songs';
const S_BLOBS = 'blobs';
const S_ANALYSES = 'analyses';

/** What the library caches for a song once it has been analysed (T9). */
export interface CachedAnalysis {
  analysis: Analysis;
  structure: Structure;
}

/** The message shown when the browser has no room left for songs. */
export const QUOTA_MESSAGE = 'Your browser is out of space for songs. Delete one and try again.';

/** An error from the song library whose `message` is plain words, ready to show the player. */
export class SongLibraryError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'SongLibraryError';
  }
}

/** Turn any failure into plain words for the player (quota, unavailable or blocked storage, anything else). */
export function describeSongError(e: unknown): string {
  if (e instanceof SongLibraryError) return e.message;
  const name = (e as { name?: unknown } | null)?.name;
  const msg = String((e as { message?: unknown } | null)?.message ?? '');
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(msg)) {
    return QUOTA_MESSAGE;
  }
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'UnknownError' || name === 'VersionError') {
    return "Your browser won't let this page keep songs. A private window can cause this; try a normal window.";
  }
  return 'Something went wrong with your song library. Try again.';
}

/** Wrap any failure as a SongLibraryError with plain words. */
function wrap(e: unknown): SongLibraryError {
  return e instanceof SongLibraryError ? e : new SongLibraryError(describeSongError(e), e);
}

/** SHA-256 of some bytes as lowercase hex: a song's id, so the same file is only kept once. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A song's display name: the file name without its extension ("Better by Moonlight.mp3" becomes "Better by Moonlight"). */
export function songNameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf('.');
  const name = dot > 0 ? base.slice(0, dot) : base;
  return name.trim() || 'Untitled song';
}

const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', webm: 'audio/webm',
};

/** A file's mime type: the one the browser reported, else a guess from its extension. */
export function mimeForFile(fileName: string, reported: string): string {
  if (reported) return reported;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'audio/mpeg';
}

// ---------------------------------------------------------------------------------------------
// Database plumbing
// ---------------------------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new SongLibraryError("Songs can't be saved in this browser."));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(wrap(e));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of [S_SONGS, S_BLOBS, S_ANALYSES]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onblocked = () => reject(new SongLibraryError('Your song library is open in another tab. Close the other tab and try again.'));
    req.onerror = () => reject(wrap(req.error));
    req.onsuccess = () => {
      const db = req.result;
      // Another tab wants to upgrade: let go of our connection and reopen next time.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
  }).catch((e) => {
    dbPromise = null; // let the next call try again
    throw wrap(e);
  });
  return dbPromise;
}

function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Resolves when the transaction has committed; rejects (with the quota error if that is why) if it aborts. */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('aborted', 'AbortError'));
  });
}

/** Run `work` in one transaction over `stores`; failures become SongLibraryError. */
async function run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  try {
    const db = await openDb();
    const tx = db.transaction(stores, mode);
    const done = txDone(tx);
    done.catch(() => {}); // the failure is reported through whichever of work/done rejects first
    let result: T;
    try {
      result = await work(tx);
    } catch (e) {
      try { tx.abort(); } catch { /* already finished */ }
      await done.catch(() => {});
      throw e;
    }
    await done;
    return result;
  } catch (e) {
    throw wrap(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/**
 * Add a song file to the library. The id is the SHA-256 of its bytes, so adding the same file
 * again returns the existing song with `added: false` and leaves its presets alone. A new song
 * starts with preset 'mixed' and difficulty 'normal' unless `opts` say otherwise. Its duration
 * is 0 until saveAnalysis() records it (the audio has to be decoded first, T9).
 */
export async function add(
  file: File,
  opts: { preset?: PresetId; difficulty?: Difficulty } = {},
): Promise<{ meta: SongMeta; added: boolean }> {
  let id: string;
  try {
    id = await sha256Hex(await file.arrayBuffer());
  } catch (e) {
    throw new SongLibraryError("Couldn't read that file. Pick it again and retry.", e);
  }
  const meta: SongMeta = {
    id,
    name: songNameFromFile(file.name),
    mime: mimeForFile(file.name, file.type),
    duration: 0,
    addedAt: new Date().toISOString(),
    preset: opts.preset ?? 'mixed',
    difficulty: opts.difficulty ?? 'normal',
  };
  return run([S_SONGS, S_BLOBS], 'readwrite', async (tx) => {
    const existing = (await reqDone(tx.objectStore(S_SONGS).get(id))) as SongMeta | undefined;
    if (existing) return { meta: existing, added: false };
    tx.objectStore(S_SONGS).put(meta, id);
    tx.objectStore(S_BLOBS).put(file.slice(0, file.size, meta.mime), id);
    return { meta, added: true };
  });
}

/** Every song's details, newest first. Never loads audio. */
export async function list(): Promise<SongMeta[]> {
  const all = await run([S_SONGS], 'readonly', (tx) => reqDone(tx.objectStore(S_SONGS).getAll() as IDBRequest<SongMeta[]>));
  return all.sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
}

/** One song's details and its audio, or null if it isn't in the library. */
export async function get(id: string): Promise<{ meta: SongMeta; blob: Blob } | null> {
  return run([S_SONGS, S_BLOBS], 'readonly', async (tx) => {
    const meta = (await reqDone(tx.objectStore(S_SONGS).get(id))) as SongMeta | undefined;
    const blob = (await reqDone(tx.objectStore(S_BLOBS).get(id))) as Blob | undefined;
    return meta && blob ? { meta, blob } : null;
  });
}

/** The cached analysis and structure for a song, or null if it hasn't been analysed yet. */
export async function getAnalysis(id: string): Promise<CachedAnalysis | null> {
  const found = await run([S_ANALYSES], 'readonly', (tx) => reqDone(tx.objectStore(S_ANALYSES).get(id)));
  return (found as CachedAnalysis | undefined) ?? null;
}

/** Delete a song: its details, its audio and its cached analysis, together. */
export async function remove(id: string): Promise<void> {
  await run([S_SONGS, S_BLOBS, S_ANALYSES], 'readwrite', async (tx) => {
    tx.objectStore(S_SONGS).delete(id);
    tx.objectStore(S_BLOBS).delete(id);
    tx.objectStore(S_ANALYSES).delete(id);
  });
}

/** Cache a song's analysis and structure, and record its length (meta.duration) from analysis.duration. No-op if the song is gone. */
export async function saveAnalysis(id: string, analysis: Analysis, structure: Structure): Promise<void> {
  await run([S_SONGS, S_ANALYSES], 'readwrite', async (tx) => {
    const meta = (await reqDone(tx.objectStore(S_SONGS).get(id))) as SongMeta | undefined;
    if (!meta) return;
    tx.objectStore(S_ANALYSES).put({ analysis, structure } satisfies CachedAnalysis, id);
    tx.objectStore(S_SONGS).put({ ...meta, duration: analysis.duration }, id);
  });
}

/** Change a song's Style preset and Difficulty. Returns the updated details, or null if the song is gone. */
export async function setPresets(id: string, preset: PresetId, difficulty: Difficulty): Promise<SongMeta | null> {
  return run([S_SONGS], 'readwrite', async (tx) => {
    const meta = (await reqDone(tx.objectStore(S_SONGS).get(id))) as SongMeta | undefined;
    if (!meta) return null;
    const next = { ...meta, preset, difficulty };
    tx.objectStore(S_SONGS).put(next, id);
    return next;
  });
}

// ---------------------------------------------------------------------------------------------
// Decoding and analysis (T9)
// ---------------------------------------------------------------------------------------------

/** The message shown when a file can't be decoded as audio. */
export const UNREADABLE_MESSAGE = "We couldn't read that song. Try an MP3, OGG or WAV file.";

/** The message shown when listening to a song (the analysis) fails. */
export const ANALYSIS_FAILED_MESSAGE = "We couldn't find the beat in that song. Try a different file.";

/** Where a song is up to while prepare() works through it. */
export interface PrepareProgress {
  stage: 'decoding' | 'analysing' | 'sections' | 'ready';
  /** 0..1 within the stage. */
  fraction: number;
}

/** Everything the drill needs to play a song: its details, the decoded audio, and its analysis and structure. */
export interface PreparedSong {
  meta: SongMeta;
  buffer: AudioBuffer;
  analysis: Analysis;
  structure: Structure;
}

/** Wrap a failure to decode (or analyse) a file as a SongLibraryError in plain words; library errors pass through. */
export function describeDecodeError(e: unknown, fallback: string = UNREADABLE_MESSAGE): SongLibraryError {
  return e instanceof SongLibraryError ? e : new SongLibraryError(fallback, e);
}

let nextRequestId = 1;

/** Resolve on a later task, so the browser can draw and handle input between chunks of main-thread work. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Run the analysis worker on some channels (transferred) and resolve with its analysis and structure. One worker per call, ended when it finishes. */
function analyseInWorker(
  channels: Float32Array[],
  sampleRate: number,
  onProgress: (p: PrepareProgress) => void,
): Promise<CachedAnalysis> {
  return new Promise<CachedAnalysis>((resolve, reject) => {
    const id = nextRequestId++;
    let worker: Worker;
    try {
      worker = new Worker(new URL('../rhythm/worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      reject(describeDecodeError(e, ANALYSIS_FAILED_MESSAGE));
      return;
    }
    const finish = (settle: () => void): void => {
      worker.terminate();
      settle();
    };
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data;
      if (m.id !== id) return; // not ours
      if (m.type === 'progress') onProgress({ stage: m.stage, fraction: m.fraction });
      else if (m.type === 'done') finish(() => resolve({ analysis: m.analysis, structure: m.structure }));
      else finish(() => reject(describeDecodeError(new Error(m.message), ANALYSIS_FAILED_MESSAGE)));
    };
    worker.onerror = (e) => finish(() => reject(describeDecodeError(new Error(e.message), ANALYSIS_FAILED_MESSAGE)));
    const req: AnalyseRequest = { id, channels, sampleRate };
    worker.postMessage(req, channels.map((c) => c.buffer));
  });
}

/**
 * Get a song ready to play: decode it with the shared AudioContext, then take its analysis from the
 * cache or, if it has none (or one from an older ANALYSIS_VERSION), analyse it in a worker and cache
 * the result. The Structure is always rebuilt from the Analysis, so retuned sections reach songs
 * already in the library. A cache hit starts no worker. Errors are SongLibraryError in plain words.
 */
export async function prepare(
  id: string,
  audio: Audio,
  onProgress: (p: PrepareProgress) => void = () => {},
): Promise<PreparedSong> {
  const found = await get(id);
  if (!found) throw new SongLibraryError("That song isn't in your library any more.");
  const cached = await getAnalysis(id).catch(() => null); // a broken cache just means analysing again
  const fresh = cached && cached.analysis.version === ANALYSIS_VERSION ? cached.analysis : null;

  onProgress({ stage: 'decoding', fraction: 0 });
  let buffer: AudioBuffer;
  try {
    buffer = await audio.decode(await found.blob.arrayBuffer());
    if (buffer.length === 0) throw new Error('empty audio');
  } catch (e) {
    throw describeDecodeError(e);
  }
  onProgress({ stage: 'decoding', fraction: 1 });

  let analysis: Analysis;
  let structure: Structure;
  if (fresh) {
    onProgress({ stage: 'sections', fraction: 0 });
    analysis = fresh;
    structure = buildStructure(fresh);
  } else {
    // Copy each channel out in its own task (about 20 ms each for four minutes), so no one task runs long.
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      await nextTask();
      const data = new Float32Array(buffer.length);
      buffer.copyFromChannel(data, c);
      channels.push(data);
    }
    await nextTask();
    ({ analysis, structure } = await analyseInWorker(channels, buffer.sampleRate, onProgress));
    await saveAnalysis(id, analysis, structure);
  }
  const meta: SongMeta = { ...found.meta, duration: analysis.duration };
  onProgress({ stage: 'ready', fraction: 1 });
  return { meta, buffer, analysis, structure };
}
