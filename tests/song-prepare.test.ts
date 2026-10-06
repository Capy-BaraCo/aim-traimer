import { describe, expect, it } from 'vitest';
import { ANALYSIS_FAILED_MESSAGE, SongLibraryError, UNREADABLE_MESSAGE, describeDecodeError } from '../src/core/songs';
import { downmixToMono } from '../src/rhythm/worker-protocol';

describe('decode error mapping', () => {
  it('turns a decoder failure into plain words', () => {
    const e = describeDecodeError(new DOMException('Unable to decode audio data', 'EncodingError'));
    expect(e).toBeInstanceOf(SongLibraryError);
    expect(e.message).toBe(UNREADABLE_MESSAGE);
  });
  it('uses the given words for an analysis failure', () => {
    expect(describeDecodeError(new Error('boom'), ANALYSIS_FAILED_MESSAGE).message).toBe(ANALYSIS_FAILED_MESSAGE);
  });
  it('passes library errors through unchanged', () => {
    const own = new SongLibraryError('Already plain.');
    expect(describeDecodeError(own)).toBe(own);
  });
});

describe('downmixToMono', () => {
  it('returns a single channel as is', () => {
    const c = new Float32Array([1, 2]);
    expect(downmixToMono([c])).toBe(c);
  });
  it('averages channels', () => {
    const m = downmixToMono([new Float32Array([1, 0, -1]), new Float32Array([0, 1, -1])]);
    expect(Array.from(m)).toEqual([0.5, 0.5, -1]);
  });
  it('handles no channels', () => {
    expect(downmixToMono([]).length).toBe(0);
  });
});
