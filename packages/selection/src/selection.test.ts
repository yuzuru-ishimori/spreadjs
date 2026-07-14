import { describe, expect, it } from 'vitest';

import { rangeContains, rangeFromAnchorFocus, singleCell } from './selection';

describe('selection: rangeFromAnchorFocus', () => {
  it('anchor と focus の順序に依らず正規化する', () => {
    const forward = rangeFromAnchorFocus({ row: 2, col: 3 }, { row: 5, col: 7 });
    const backward = rangeFromAnchorFocus({ row: 5, col: 7 }, { row: 2, col: 3 });
    expect(forward).toEqual({ rowStart: 2, rowEnd: 6, colStart: 3, colEnd: 8 });
    expect(backward).toEqual(forward);
  });

  it('単一セルは 1×1 の半開区間', () => {
    expect(singleCell({ row: 4, col: 9 })).toEqual({
      rowStart: 4,
      rowEnd: 5,
      colStart: 9,
      colEnd: 10,
    });
  });
});

describe('selection: rangeContains', () => {
  const range = rangeFromAnchorFocus({ row: 2, col: 3 }, { row: 5, col: 7 });
  it('内側は true・境界外は false', () => {
    expect(rangeContains(range, 2, 3)).toBe(true);
    expect(rangeContains(range, 5, 7)).toBe(true);
    expect(rangeContains(range, 6, 7)).toBe(false); // rowEnd は排他
    expect(rangeContains(range, 2, 8)).toBe(false); // colEnd は排他
  });
});
