import { describe, expect, it } from 'vitest';
import { QUOTA_MESSAGE, SongLibraryError, describeSongError, mimeForFile, sha256Hex, songNameFromFile } from '../src/core/songs';
import { store } from '../src/core/store';

describe('song library helpers', () => {
  it('hashes bytes to lowercase SHA-256 hex', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('names a song from its file name without the extension', () => {
    expect(songNameFromFile('Better by Moonlight.mp3')).toBe('Better by Moonlight');
    expect(songNameFromFile('a.b.c.flac')).toBe('a.b.c');
    expect(songNameFromFile('noext')).toBe('noext');
    expect(songNameFromFile('.mp3')).toBe('.mp3');
  });
  it('falls back to the extension for the mime type', () => {
    expect(mimeForFile('x.mp3', '')).toBe('audio/mpeg');
    expect(mimeForFile('x.M4A', '')).toBe('audio/mp4');
    expect(mimeForFile('x.wav', 'audio/x-wav')).toBe('audio/x-wav');
  });
  it('maps a quota error to the plain-words message', () => {
    const exact = 'Your browser is out of space for songs. Delete one and try again.';
    expect(QUOTA_MESSAGE).toBe(exact);
    expect(describeSongError({ name: 'QuotaExceededError' })).toBe(exact);
    expect(describeSongError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(exact);
    expect(describeSongError(new SongLibraryError(exact))).toBe(exact);
  });
  it('gives plain words for blocked storage and unknown failures', () => {
    expect(describeSongError({ name: 'SecurityError' })).toMatch(/private window/);
    expect(describeSongError(new Error('boom'))).toMatch(/Something went wrong/);
  });
  it('keeps songs out of the backup export', () => {
    const json = store.exportJson();
    expect(json).not.toMatch(/azimuth-songs|onsetEnv|audio\//);
    expect(Object.keys(JSON.parse(json).profile)).not.toContain('songs');
  });
});
