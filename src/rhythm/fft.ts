/**
 * A small radix-2 FFT for Overdrive's song analysis (T3). Pure: no DOM, no WebAudio, no npm
 * packages, so vitest can run it in node.
 *
 * Build one FFT per frame size and reuse it for every frame: the twiddle factors and the
 * bit-reversal table are computed once in the constructor, and transform() allocates nothing.
 */

/** A buffer of samples; analysis uses Float64Array for its FFT buffers. */
export type Samples = Float32Array | Float64Array;

export class FFT {
  /** Number of points; a power of two, at least 2. */
  readonly size: number;
  /** cos and sin of -2πk/size for k < size/2 (the forward-transform twiddles). */
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  /** Bit-reversed index of every input position. */
  private readonly rev: Uint32Array;

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
      throw new RangeError('FFT size must be a power of two, at least 2');
    }
    this.size = size;
    const half = size >> 1;
    this.cos = new Float64Array(half);
    this.sin = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      this.cos[k] = Math.cos((-2 * Math.PI * k) / size);
      this.sin[k] = Math.sin((-2 * Math.PI * k) / size);
    }
    const bits = Math.round(Math.log2(size));
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
      this.rev[i] = r;
    }
  }

  /**
   * Forward transform in place: (re, im) holds the input and receives X[k] = Σ x[n]·e^(-2πikn/N).
   * Both arrays must have exactly `size` entries. Unnormalised (no 1/N).
   */
  transform(re: Samples, im: Samples): void {
    const n = this.size;
    if (re.length !== n || im.length !== n) throw new RangeError(`FFT buffers must have ${n} entries`);
    const { rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const a = start + k;
          const b = a + half;
          const wr = cos[t];
          const wi = sin[t];
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}

/**
 * Magnitude |X[k]| of a transformed spectrum for k = 0 .. out.length - 1 (pass out.length =
 * size / 2 + 1 for the non-negative frequencies of a real signal). Returns `out`.
 */
export function magnitudes(re: Samples, im: Samples, out: Samples): Samples {
  for (let k = 0; k < out.length; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  return out;
}
