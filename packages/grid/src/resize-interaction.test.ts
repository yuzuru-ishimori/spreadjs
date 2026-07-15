import { describe, expect, it } from 'vitest';

import { createAxis, createViewportTransform } from '@nanairo-sheet/render';
import type { ViewportTransform } from '@nanairo-sheet/render';
import { createColumnId, createRowId } from '@nanairo-sheet/types';

import {
  COLUMN_MAX_WIDTH,
  COLUMN_MIN_WIDTH,
  ROW_MAX_HEIGHT,
  ROW_MIN_HEIGHT,
  clampColumnWidth,
  clampRowHeight,
  computeResizeSize,
  resizeHitTest,
} from './resize-interaction';

const HEADER_WIDTH = 52;
const HEADER_HEIGHT = 24;
const COL_WIDTH = 80;
const ROW_HEIGHT = 22;

function makeTransform(cols: number, rows: number, viewportWidth = 800, viewportHeight = 600): ViewportTransform {
  const colAxis = createAxis({
    ids: Array.from({ length: cols }, (_, i) => createColumnId(`col-${i}`)),
    defaultSize: COL_WIDTH,
  });
  const rowAxis = createAxis({
    ids: Array.from({ length: rows }, (_, i) => createRowId(`row-${i}`)),
    defaultSize: ROW_HEIGHT,
  });
  return createViewportTransform({
    rowAxis,
    colAxis,
    headerWidth: HEADER_WIDTH,
    headerHeight: HEADER_HEIGHT,
    frozenRowCount: 1,
    frozenColCount: 1,
    viewportWidth,
    viewportHeight,
    scrollLeft: 0,
    scrollTop: 0,
    overscanX: 0,
    overscanY: 0,
  });
}

const cfg = { headerWidth: HEADER_WIDTH, headerHeight: HEADER_HEIGHT, rowCount: 6, colCount: 6 };

describe('clampColumnWidth / clampRowHeight（D3 クランプ）', () => {
  it('列幅は 20〜2000 でクランプ', () => {
    expect(clampColumnWidth(10)).toBe(COLUMN_MIN_WIDTH);
    expect(clampColumnWidth(120)).toBe(120);
    expect(clampColumnWidth(9999)).toBe(COLUMN_MAX_WIDTH);
    expect(clampColumnWidth(-5)).toBe(COLUMN_MIN_WIDTH);
  });
  it('行高は 16〜2000 でクランプ', () => {
    expect(clampRowHeight(4)).toBe(ROW_MIN_HEIGHT);
    expect(clampRowHeight(40)).toBe(40);
    expect(clampRowHeight(9999)).toBe(ROW_MAX_HEIGHT);
  });
});

describe('resizeHitTest（ヘッダー境界の掴み代 ±4px）', () => {
  const t = makeTransform(6, 6);
  // col0: x[52,132), col1: x[132,212) … 右端境界 = 132, 212 …
  it('列 c の右端 handle 内 → 列 c', () => {
    const hit = resizeHitTest(t, 130, 12, cfg); // col0 内・右端手前 2px
    expect(hit).toEqual({ axis: 'column', index: 0 });
  });
  it('列 c+1 の左端 handle 内 → 列 c（境界共有・両側から掴める）', () => {
    const hit = resizeHitTest(t, 134, 12, cfg); // col1 内・左端 +2px → col0
    expect(hit).toEqual({ axis: 'column', index: 0 });
  });
  it('列ヘッダー中央（handle 外）→ null', () => {
    expect(resizeHitTest(t, 90, 12, cfg)).toBeNull();
  });
  it('列 c=0 の左端は前列が無いので null（corner 隣接の誤検出防止）', () => {
    // x=54 は col0 内・左端 +2px だが c-1 が無い。
    expect(resizeHitTest(t, 54, 12, cfg)).toBeNull();
  });
  // row0: y[24,46), row1: y[46,68) … 下端境界 = 46, 68 …
  it('行 r の下端 handle 内 → 行 r', () => {
    const hit = resizeHitTest(t, 20, 44, cfg); // row0・下端手前 2px
    expect(hit).toEqual({ axis: 'row', index: 0 });
  });
  it('行 r+1 の上端 handle 内 → 行 r', () => {
    const hit = resizeHitTest(t, 20, 48, cfg); // row1・上端 +2px → row0
    expect(hit).toEqual({ axis: 'row', index: 0 });
  });
  it('corner（両ヘッダー交差）→ null', () => {
    expect(resizeHitTest(t, 20, 12, cfg)).toBeNull();
  });
  it('セル領域 → null', () => {
    expect(resizeHitTest(t, 300, 300, cfg)).toBeNull();
  });
  it('行が 0 件なら行境界は検出しない（空 Axis での getId 例外を避ける）', () => {
    const empty = makeTransform(6, 0);
    expect(resizeHitTest(empty, 20, 25, { ...cfg, rowCount: 0 })).toBeNull();
  });
  it('末尾列より外側の空白帯はリサイズ対象にしない（hitTest クランプの誤検出防止・Codex[P2]）', () => {
    // 2 列だけ（col0,col1 で x[52,212)）＋広い viewport。x=400 は最終列より右の空白。
    const narrow = makeTransform(2, 6, 800, 600);
    // 空白帯（境界線 212 から遠い）は最終列 col1 の右境界 handle 外。
    expect(resizeHitTest(narrow, 400, 12, { ...cfg, colCount: 2 })).toBeNull();
    // 最終列 col1 の右境界（212）付近はちゃんと掴める。
    expect(resizeHitTest(narrow, 210, 12, { ...cfg, colCount: 2 })).toEqual({ axis: 'column', index: 1 });
  });
});

describe('computeResizeSize（ドラッグ位置 − 現在の左端/上端 → クランプ済みサイズ）', () => {
  it('列: coord − edge。クランプが効く', () => {
    expect(computeResizeSize('column', 252, 52)).toBe(200); // 200px
    expect(computeResizeSize('column', 60, 52)).toBe(COLUMN_MIN_WIDTH); // 8 → 20
    expect(computeResizeSize('column', 5000, 52)).toBe(COLUMN_MAX_WIDTH);
  });
  it('行: coord − edge。クランプが効く', () => {
    expect(computeResizeSize('row', 84, 24)).toBe(60); // 60px
    expect(computeResizeSize('row', 30, 24)).toBe(ROW_MIN_HEIGHT); // 6 → 16
  });
});
