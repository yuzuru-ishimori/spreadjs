import { describe, expect, it } from 'vitest';

import { createPresenceSim, type PresenceUser } from './presence-sim';

describe('PresenceSim: 20人・範囲内・安定属性', () => {
  const rows = 50000;
  const cols = 200;
  const sim = createPresenceSim({ count: 20, seed: 123, rows, cols });

  it('20人生成され、colorKey と displayName が安定', () => {
    expect(sim.users()).toHaveLength(20);
    for (const user of sim.users()) {
      expect(user.colorKey).toBeGreaterThanOrEqual(0);
      expect(user.displayName.length).toBeGreaterThan(0);
    }
  });

  it('100 step 後も全員が範囲内にクランプされる', () => {
    for (let i = 0; i < 100; i += 1) {
      sim.step();
    }
    for (const user of sim.users()) {
      expectInBounds(user, rows, cols);
    }
  });
});

describe('PresenceSim: 決定論', () => {
  it('同一 seed の step 列は完全一致', () => {
    const a = createPresenceSim({ count: 20, seed: 777, rows: 1000, cols: 100 });
    const b = createPresenceSim({ count: 20, seed: 777, rows: 1000, cols: 100 });
    for (let i = 0; i < 50; i += 1) {
      a.step();
      b.step();
    }
    expect(a.users()).toEqual(b.users());
  });

  it('異なる seed は異なる状態になる', () => {
    const a = createPresenceSim({ count: 20, seed: 1, rows: 1000, cols: 100 });
    const b = createPresenceSim({ count: 20, seed: 2, rows: 1000, cols: 100 });
    for (let i = 0; i < 50; i += 1) {
      a.step();
      b.step();
    }
    expect(a.users()).not.toEqual(b.users());
  });
});

function expectInBounds(user: PresenceUser, rows: number, cols: number): void {
  expect(user.activeRow).toBeGreaterThanOrEqual(0);
  expect(user.activeRow).toBeLessThan(rows);
  expect(user.activeCol).toBeGreaterThanOrEqual(0);
  expect(user.activeCol).toBeLessThan(cols);
  expect(user.selRowStart).toBeGreaterThanOrEqual(0);
  expect(user.selRowEnd).toBeLessThanOrEqual(rows);
  expect(user.selColStart).toBeGreaterThanOrEqual(0);
  expect(user.selColEnd).toBeLessThanOrEqual(cols);
}
