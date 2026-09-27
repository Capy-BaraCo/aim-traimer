import { describe, expect, it } from 'vitest';
import { store } from '../src/core/store';

describe('backup export / import', () => {
  it('round-trips progress, sessions and settings', () => {
    store.setSettings({ sens: 4.2, dpi: 1600 });
    store.commitRun('blink', 1, 80, [45, 60, 75], 10);
    const backup = store.exportJson();

    store.setSettings({ sens: 9 });
    store.update((p) => {
      p.progress = {};
      p.sessions = [];
    });
    expect(store.importJson(backup)).toEqual({ ok: true });
    expect(store.settings.sens).toBe(4.2);
    expect(store.settings.dpi).toBe(1600);
    expect(store.get().progress.blink.levels[1].stars).toBe(3);
    expect(store.get().sessions.at(-1)?.drill).toBe('blink');
  });

  it('fills in fields an older profile does not have', () => {
    const v1 = { settings: { sens: 6, dpi: 800 }, history: [], bests: { snap: 70 }, seenIntro: true };
    expect(store.importJson(JSON.stringify(v1))).toEqual({ ok: true });
    const p = store.get();
    expect(p.settings.sens).toBe(6);
    expect(p.settings.coachCues).toBe(true);
    expect(p.settings.calSections).toEqual({ track: true, short: true, wide: true });
    expect(p.progress).toEqual({});
    expect(p.flickLog).toEqual([]);
  });

  it('rejects files that are not backups', () => {
    const before = store.exportJson();
    expect(store.importJson('not json').ok).toBe(false);
    expect(store.importJson(JSON.stringify({ hello: 'world' })).ok).toBe(false);
    expect(store.importJson('null').ok).toBe(false);
    expect(JSON.parse(store.exportJson()).profile).toEqual(JSON.parse(before).profile);
  });
});
