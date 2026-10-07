import { describe, expect, it } from 'vitest';
import { applyRun, unlockedLevel, type DrillProgress } from '../src/core/progress';
import { store } from '../src/core/store';
import { DRILL_DEFS, levelCount } from '../src/drills/registry';

describe('level ladders', () => {
  it('gives Blink, Duelist and Triad 15 levels and keeps the rest at 10', () => {
    expect(levelCount('blink')).toBe(15);
    expect(levelCount('duelist')).toBe(15);
    expect(levelCount('triad')).toBe(15);
    for (const id of ['snap', 'echo', 'pin', 'corner', 'crossfire']) expect(levelCount(id)).toBe(10);
  });

  it('has a description for every level', () => {
    for (const d of DRILL_DEFS) for (const l of d.levels) expect(l.length).toBeGreaterThan(5);
  });

  it('lets you unlock past level 10 on a 15-level drill, and no further than 15', () => {
    const p: DrillProgress = { levels: {}, runs: 0, lastLevel: 1 };
    for (let lvl = 1; lvl <= 15; lvl++) applyRun(p, lvl, 100, [40, 55, 70], 15);
    expect(unlockedLevel(p, 15)).toBe(15);
    expect(unlockedLevel(p, 10)).toBe(10);
  });
});

describe('target colour', () => {
  it('keeps a valid colour from a backup and rejects junk', () => {
    expect(store.importJson(JSON.stringify({ settings: { targetColor: '#20e6ff' } }))).toEqual({ ok: true });
    expect(store.settings.targetColor).toBe('#20e6ff');
    expect(store.importJson(JSON.stringify({ settings: { targetColor: 'red; background:url(x)' } }))).toEqual({ ok: true });
    expect(store.settings.targetColor).toBe('#ff3d12');
  });
});
