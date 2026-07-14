import { describe, expect, it } from 'vitest';

import { createColumnId, createRowId, type ColumnId, type RowId } from '@nanairo-sheet/types';

import { createAxis } from './axis';
import { captureAnchor, correctScroll } from './scroll-anchor';

function makeRowAxis(count: number): ReturnType<typeof createAxis<RowId>> {
  return createAxis({
    ids: Array.from({ length: count }, (_v, i) => createRowId(`r${i}`)),
    defaultSize: 22,
  });
}
function makeColAxis(count: number): ReturnType<typeof createAxis<ColumnId>> {
  return createAxis({
    ids: Array.from({ length: count }, (_v, i) => createColumnId(`c${i}`)),
    defaultSize: 56,
  });
}

describe('ScrollAnchor: 捕捉', () => {
  it('scrollTop=1000 でスクロール域先頭行を anchor に採る', () => {
    const rowAxis = makeRowAxis(50000);
    const colAxis = makeColAxis(200);
    const anchor = captureAnchor({
      rowAxis,
      colAxis,
      frozenRowCount: 0,
      frozenColCount: 0,
      scrollTop: 1000,
      scrollLeft: 0,
    });
    // 1000/22 = 45.45 → row45（offset 990）、行内オフセット 10。
    expect(anchor.rowId).toBe(createRowId('r45'));
    expect(anchor.offsetWithinRow).toBe(10);
  });
});

describe('ScrollAnchor: 行高変更後の補正（画面が跳ばない）', () => {
  it('anchor 行より上の行高を増やすと scrollTop がその分増える', () => {
    const rowAxis = makeRowAxis(50000);
    const colAxis = makeColAxis(200);
    const anchor = captureAnchor({
      rowAxis,
      colAxis,
      frozenRowCount: 0,
      frozenColCount: 0,
      scrollTop: 1000,
      scrollLeft: 0,
    });
    // anchor 行(45)の画面内 content 位置 = offsetOf(45)+offsetWithinRow = 990+10 = 1000。
    const before = rowAxis.offsetOf(rowAxis.getIndex(anchor.rowId)) + anchor.offsetWithinRow;

    // 上方の行 0..9 の行高を 22→122（+100 ずつ、計 +1000）。
    for (let i = 0; i < 10; i += 1) {
      rowAxis.setSize(i, 122);
    }
    const corrected = correctScroll({
      rowAxis,
      colAxis,
      frozenRowCount: 0,
      frozenColCount: 0,
      anchor,
    });
    // anchor 行の新しい content 位置は +1000 され、scrollTop も +1000 されて画面内 y が不変。
    const after = rowAxis.offsetOf(rowAxis.getIndex(anchor.rowId)) + anchor.offsetWithinRow;
    expect(after - before).toBe(1000);
    expect(corrected.scrollTop).toBe(2000); // 1000 + 1000
  });
});

describe('ScrollAnchor: 行挿入後の補正', () => {
  it('anchor 行より上に 1,000 行挿入すると挿入総高分だけ scrollTop が増える', () => {
    const rowAxis = makeRowAxis(50000);
    const colAxis = makeColAxis(200);
    const anchor = captureAnchor({
      rowAxis,
      colAxis,
      frozenRowCount: 0,
      frozenColCount: 0,
      scrollTop: 1000,
      scrollLeft: 0,
    });
    const inserted = Array.from({ length: 1000 }, (_v, i) => createRowId(`ins${i}`));
    rowAxis.insert(0, inserted, 22);

    const corrected = correctScroll({
      rowAxis,
      colAxis,
      frozenRowCount: 0,
      frozenColCount: 0,
      anchor,
    });
    // 1,000 行 × 22px = 22,000 上へ増える。
    expect(corrected.scrollTop).toBe(1000 + 22000);
    // 画面が跳ばない不変条件: anchor 点（行start＋行内offset）が補正 scrollTop と一致（frozenHeight=0）。
    const newIndex = rowAxis.getIndex(anchor.rowId);
    expect(rowAxis.offsetOf(newIndex) + anchor.offsetWithinRow - corrected.scrollTop).toBe(0);
  });
});

describe('ScrollAnchor: anchor 行が削除された場合のフォールバック', () => {
  it('anchor 行自体が消えたら index ヒント近傍へ寄せ、例外を投げない', () => {
    const rowAxis = makeRowAxis(1000);
    const colAxis = makeColAxis(200);
    const anchor = captureAnchor({
      rowAxis,
      colAxis,
      frozenRowCount: 0,
      frozenColCount: 0,
      scrollTop: 1000,
      scrollLeft: 0,
    });
    // anchor 行（index45）を含む範囲を削除。
    rowAxis.remove(40, 10);
    expect(rowAxis.getIndex(anchor.rowId)).toBe(-1); // 消えている

    const corrected = correctScroll({
      rowAxis,
      colAxis,
      frozenRowCount: 0,
      frozenColCount: 0,
      anchor,
    });
    expect(Number.isFinite(corrected.scrollTop)).toBe(true);
    expect(corrected.scrollTop).toBeGreaterThanOrEqual(0);
  });
});
