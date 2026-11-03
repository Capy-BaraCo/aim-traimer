import { describe, expect, it } from 'vitest';
import { sha256 } from '../src/core/sha256';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
/** Reference digest from the platform's SubtleCrypto (available in the node test runner). */
const ref = async (b: Uint8Array) => hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', b as BufferSource)));

describe('plain-JS SHA-256 (fallback for plain-HTTP pages without SubtleCrypto)', () => {
  it('matches the standard test vectors', () => {
    expect(hex(sha256(new Uint8Array()))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches SubtleCrypto across padding boundaries', async () => {
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 65537]) {
      const b = new Uint8Array(n).map((_, i) => (i * 37 + n) & 0xff);
      expect(hex(sha256(b)), `length ${n}`).toBe(await ref(b));
    }
  });
});
