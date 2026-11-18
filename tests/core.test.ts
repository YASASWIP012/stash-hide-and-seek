import { describe, expect, it } from 'vitest';
import { beliefs, planSearch, statedPrior } from '../src/core/search.ts';
import { decodeHide, encodeHide } from '../src/core/share.ts';
import { roomToUrdf } from '../src/core/urdf.ts';
import { COST, decideSpend } from '../src/core/credits.ts';
import { testRoom } from './fixtures.ts';

describe('robot beliefs', () => {
  it('prior sums to one and favours bigger containers of the same kind', () => {
    const p = statedPrior(testRoom().containers);
    const sum = [...p.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
    expect(p.get('far-big')!).toBeGreaterThan(p.get('near-small')!);
  });

  it('logged hides shift belief, but a few hides do not swamp the prior', () => {
    const room = testRoom();
    const before = beliefs(room, []).get('near-small')!;
    const log = [{ roomId: room.id, containerId: 'near-small', at: '2026-11-18' }];
    const after = beliefs(room, log).get('near-small')!;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(0.6);
  });

  it('ignores hides logged in other rooms', () => {
    const room = testRoom();
    const log = [{ roomId: 'other', containerId: 'near-small', at: '2026-11-18' }];
    expect(beliefs(room, log)).toEqual(beliefs(room, []));
  });
});

describe('search planning', () => {
  it('finds the object, opens each container at most once, and is deterministic', () => {
    const room = testRoom();
    for (const c of room.containers) {
      const a = planSearch(room, [], c.id);
      expect(a.foundAt).not.toBeNull();
      expect(new Set(a.order).size).toBe(a.order.length);
      expect(a.order.at(-1)).toBe(c.id);
      expect(planSearch(room, [], c.id)).toEqual(a);
    }
  });

  it('event times never go backwards', () => {
    const run = planSearch(testRoom(), [], 'wardrobe');
    for (let i = 1; i < run.events.length; i++) expect(run.events[i]!.t).toBeGreaterThanOrEqual(run.events[i - 1]!.t);
  });

  it('stops at the time limit', () => {
    const run = planSearch(testRoom(), [], 'wardrobe', 0.1);
    expect(run.foundAt).toBeNull();
    expect(run.events.at(-1)).toMatchObject({ type: 'done', found: false });
  });

  it('every think step shows odds that sum to one over unopened containers', () => {
    const run = planSearch(testRoom(), [], 'wardrobe');
    for (const e of run.events) {
      if (e.type !== 'think') continue;
      const s = Object.values(e.odds).reduce((a, b) => a + b, 0);
      expect(s).toBeCloseTo(1, 9);
    }
  });
});

describe('share links', () => {
  it('round-trips, including non-ASCII object names', () => {
    const h = { v: 1 as const, room: 'r1', container: 'drawer-2', object: '钥匙 keys', hiderTime: 14.2 };
    expect(decodeHide(encodeHide(h))).toEqual(h);
  });

  it('rejects a tampered or truncated link', () => {
    const t = encodeHide({ v: 1, room: 'r1', container: 'd', object: 'o' });
    expect(decodeHide(t.slice(0, -1))).toBeNull();
    expect(decodeHide('x' + t)).toBeNull();
    expect(decodeHide('')).toBeNull();
  });
});

describe('URDF export', () => {
  it('produces well-formed XML with one movable joint per container', () => {
    const room = testRoom();
    const xml = roomToUrdf(room);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
    const joints = [...doc.getElementsByTagName('joint')].filter((j) => j.getAttribute('type') !== 'fixed');
    expect(joints).toHaveLength(room.containers.length);
    expect(xml).toContain('type="revolute"');
    expect(xml).toContain('limits from estimate');
  });
});

describe('credit guard', () => {
  const base = { balance: 3600, startingBalance: 3600 };
  it('lets cheap calls through without approval', () => {
    expect(decideSpend({ ...base, kind: 'lux3d.img-to-3d.turbo' })).toEqual({ ok: true, cost: 1 });
  });
  it('blocks runs over 20 credits unless approved for at least that amount', () => {
    expect(decideSpend({ ...base, kind: 'lux3d.part-split' }).ok).toBe(false);
    expect(decideSpend({ ...base, kind: 'lux3d.part-split', approvedUpTo: 29 }).ok).toBe(false);
    expect(decideSpend({ ...base, kind: 'lux3d.part-split', approvedUpTo: 30 }).ok).toBe(true);
  });
  it('never dips into the one-third reserve, even when approved', () => {
    const r = decideSpend({ balance: 1210, startingBalance: 3600, kind: 'lux3d.part-split', approvedUpTo: 999 });
    expect(r.ok).toBe(false);
  });
  it('prices Spatial Understanding at 1000', () => {
    expect(COST['spatial.understanding']).toBe(1000);
  });
});

import { sampleReplay } from '../src/core/timeline.ts';

describe('replay sampling', () => {
  it('starts at spawn, ends with the hiding container open and found', () => {
    const room = testRoom();
    const run = planSearch(room, [], 'far-big');
    const labels = Object.fromEntries(room.containers.map((c) => [c.id, c.label]));
    const first = sampleReplay(run.events, 0, room.spawn, labels);
    expect(first.done).toBe(false);
    const last = sampleReplay(run.events, run.foundAt! + 0.01, room.spawn, labels);
    expect(last.done).toBe(true);
    expect(last.found).toBe(true);
    expect(last.open['far-big']).toBeCloseTo(1);
    // Containers it already checked are closed again.
    for (const id of run.order.slice(0, -1)) expect(last.open[id]).toBeCloseTo(0);
  });
});
