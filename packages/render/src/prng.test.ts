import { describe, expect, it } from 'vitest';

import { createPrng } from './prng';

describe('prng: 決定論', () => {
  it('同一 seed は同一列を返す', () => {
    const a = createPrng(12345);
    const b = createPrng(12345);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('異なる seed は異なる列を返す（ほぼ確実に）', () => {
    const a = createPrng(1);
    const b = createPrng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('next は [0,1) の範囲', () => {
    const p = createPrng(999);
    for (let i = 0; i < 1000; i += 1) {
      const v = p.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('prng: 整数・pick', () => {
  it('nextInt は [0, maxExclusive)', () => {
    const p = createPrng(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = p.nextInt(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('nextInt(0) は 0', () => {
    expect(createPrng(1).nextInt(0)).toBe(0);
  });

  it('nextIntBetween は両端を含む', () => {
    const p = createPrng(42);
    for (let i = 0; i < 1000; i += 1) {
      const v = p.nextIntBetween(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('pick は要素を返し、空配列は例外', () => {
    const p = createPrng(3);
    expect(['a', 'b', 'c']).toContain(p.pick(['a', 'b', 'c']));
    expect(() => p.pick([])).toThrow();
  });
});
