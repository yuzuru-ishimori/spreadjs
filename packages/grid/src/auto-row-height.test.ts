import { describe, expect, it } from 'vitest';

import { autoRowHeight } from './auto-row-height';

const BASE = { lineHeight: 16, padding: 5, defaultHeight: 22 } as const;

describe('autoRowHeight（自動行高算出・D5）', () => {
  it('全 wrap セルが 1 行なら拡張しない（undefined）', () => {
    expect(autoRowHeight({ ...BASE, lineCounts: [1, 1] })).toBeUndefined();
  });

  it('非空 wrap セルが無い行は拡張しない（undefined）', () => {
    expect(autoRowHeight({ ...BASE, lineCounts: [] })).toBeUndefined();
  });

  it('最大行数 2 → 2×16 + 5×2 = 42px', () => {
    expect(autoRowHeight({ ...BASE, lineCounts: [1, 2] })).toBe(42);
  });

  it('複数 wrap セルは最大行数を採用する', () => {
    expect(autoRowHeight({ ...BASE, lineCounts: [3, 1, 2] })).toBe(3 * 16 + 10);
  });

  it('算出高が既定高以下なら採用しない（拡張のみ）', () => {
    // lineHeight を極小にして 2 行でも既定 22 を超えないケース。
    expect(autoRowHeight({ lineHeight: 4, padding: 2, defaultHeight: 22, lineCounts: [2] })).toBeUndefined();
  });
});
