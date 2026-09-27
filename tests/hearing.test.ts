import { describe, expect, it } from 'vitest';
import { echoCorrect, summariseEcho, type EchoRecord } from '../src/core/analytics';
import { Audio, relativeDirection } from '../src/core/audio';
import { hearingFindings } from '../src/core/coach';

const ORIGIN = { x: 0, y: 1.6, z: 0 };
const UP = { x: 0, y: 1, z: 0 };
const NORTH = { x: 0, y: 0, z: -1 }; // three.js cameras look down -z

describe('where a sound is, relative to you', () => {
  it('reads ahead, right, left and behind', () => {
    const at = (x: number, z: number) => relativeDirection(ORIGIN, NORTH, UP, { x, y: 1.6, z }).az;
    expect(at(0, -5)).toBeCloseTo(0, 6);
    expect(at(5, 0)).toBeCloseTo(90, 6);
    expect(at(-5, 0)).toBeCloseTo(-90, 6);
    expect(Math.abs(at(0, 5))).toBeCloseTo(180, 6);
  });

  it('turns with you: facing east, north is on your left', () => {
    const east = { x: 1, y: 0, z: 0 };
    expect(relativeDirection(ORIGIN, east, UP, { x: 0, y: 1.6, z: -5 }).az).toBeCloseTo(-90, 6);
  });

  it('reports elevation and distance', () => {
    const d = relativeDirection(ORIGIN, NORTH, UP, { x: 0, y: 1.6 + 5, z: -5 });
    expect(d.el).toBeCloseTo(45, 6);
    expect(d.dist).toBeCloseTo(Math.SQRT2 * 5, 6);
  });

  it('places audio-check pings where it says they are', () => {
    const a = new Audio();
    a.listen({ x: 3, y: 1.6, z: -2 }, { x: Math.sin(0.7), y: 0, z: -Math.cos(0.7) }, UP);
    for (const az of [-150, -90, -20, 0, 45, 90, 179]) expect(a.directionOf(a.pointAround(az)).az).toBeCloseTo(az, 6);
  });
});

const rec = (rel: number, turnDir: number, turnMs: number | null = 300): EchoRecord => ({
  rel,
  turnDir,
  turnMs,
  seenMs: 500,
  hit: true,
  totalMs: 900,
});

describe('first turn: short way or long way', () => {
  it('judges the first turn against where the sound was', () => {
    expect(echoCorrect(rec(120, 1))).toBe(true);
    expect(echoCorrect(rec(120, -1))).toBe(false);
    expect(echoCorrect(rec(-60, -1))).toBe(true);
  });

  it('does not judge dead-behind sounds or no turn at all', () => {
    expect(echoCorrect(rec(172, -1))).toBeNull();
    expect(echoCorrect(rec(-178, 1))).toBeNull();
    expect(echoCorrect(rec(100, 0, null))).toBeNull();
  });

  it('splits front and behind', () => {
    const s = summariseEcho([rec(40, 1), rec(-70, -1), rec(80, 1), rec(130, -1), rec(-120, 1), rec(150, 1), rec(175, 1)]);
    expect(s.judged).toBe(6);
    expect(s.front).toEqual({ n: 3, rate: 1 });
    expect(s.behind.n).toBe(3);
    expect(s.behind.rate).toBeCloseTo(1 / 3, 6);
  });

  it('coaches wrong-way turns and behind confusion', () => {
    const s = summariseEcho([rec(40, 1), rec(-70, -1), rec(80, 1), rec(60, 1), rec(130, -1), rec(-120, 1), rec(150, -1), rec(-140, 1)]);
    const ids = hearingFindings(s).map((f) => f.id);
    expect(ids).toContain('wrong-way');
    expect(ids).toContain('behind-confusion');
  });

  it('notices waiting to see before turning', () => {
    const s = summariseEcho(Array.from({ length: 6 }, (_, i) => rec(90 + i, 1, 650)));
    expect(hearingFindings(s).map((f) => f.id)).toContain('wait-to-see');
  });
});
