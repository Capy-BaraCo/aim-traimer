import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

export const FONTS = {
  display: '"Big Shoulders Display", "Arial Narrow", sans-serif',
  mono: '"Martian Mono", ui-monospace, monospace',
  serif: '"Instrument Serif", Georgia, serif',
};

export async function fontsReady(): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    await Promise.all([
      document.fonts.load(`900 120px ${FONTS.display}`),
      document.fonts.load(`700 120px ${FONTS.display}`),
      document.fonts.load(`400 40px ${FONTS.mono}`),
      document.fonts.load(`italic 400 60px ${FONTS.serif}`),
    ]);
  } catch {
    // Fall back to system fonts; nothing else depends on this.
  }
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  t.minFilter = LinearMipmapLinearFilter;
  return t;
}
