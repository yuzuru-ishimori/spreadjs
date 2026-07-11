import { describe, expect, it } from 'vitest';

import { createColumnId, createRowId, type ColumnId, type RowId } from '@nanairo-sheet/sheet-types';

import { createAxis } from './axis';
import { createViewportTransform, type PaneId, type PaneRange, type ViewportConfig } from './viewport';

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

function baseConfig(overrides: Partial<ViewportConfig> = {}): ViewportConfig {
  return {
    rowAxis: makeRowAxis(50000),
    colAxis: makeColAxis(200),
    headerWidth: 44,
    headerHeight: 24,
    frozenRowCount: 0,
    frozenColCount: 0,
    viewportWidth: 800,
    viewportHeight: 600,
    scrollLeft: 0,
    scrollTop: 0,
    overscanX: 0,
    overscanY: 0,
    ...overrides,
  };
}

function paneOf(panes: readonly PaneRange[], id: PaneId): PaneRange {
  const found = panes.find((p) => p.pane === id);
  if (found === undefined) {
    throw new Error(`pane ${id} が見つからない`);
  }
  return found;
}

describe('ViewportTransform: スクロール0・固定なし', () => {
  const vt = createViewportTransform(baseConfig());

  it('body pane の可視範囲は viewport サイズから決まる', () => {
    const body = paneOf(vt.panes(), 'body');
    // 縦: (600-24)/22 → index26 まで見える → [0,27)
    expect(body.rows).toEqual({ start: 0, end: 27 });
    // 横: (800-44)/56 → index13 まで → [0,14)
    expect(body.cols).toEqual({ start: 0, end: 14 });
    expect(vt.visibleCellCount()).toBe(27 * 14);
  });

  it('scrollableWidth/Height は header + 全体サイズ', () => {
    expect(vt.scrollableWidth()).toBe(44 + 200 * 56);
    expect(vt.scrollableHeight()).toBe(24 + 50000 * 22);
  });
});

describe('ViewportTransform: セル矩形へスクロールが反映される', () => {
  it('scrollTop=220 で row10 が body 先頭（y=headerHeight）へ来る', () => {
    const vt = createViewportTransform(baseConfig({ scrollTop: 220 }));
    expect(vt.cellRect(10, 0).y).toBe(24);
  });

  it('scrollLeft=112 で col2 が body 先頭（x=headerWidth）へ来る', () => {
    const vt = createViewportTransform(baseConfig({ scrollLeft: 112 }));
    expect(vt.cellRect(0, 2).x).toBe(44);
  });
});

describe('ViewportTransform: 固定行列4象限（§12.2）', () => {
  const vt = createViewportTransform(
    baseConfig({ frozenRowCount: 1, frozenColCount: 1, scrollTop: 1000, scrollLeft: 1000 }),
  );
  const panes = vt.panes();

  it('固定領域の寸法は先頭行・列サイズ', () => {
    expect(vt.frozenWidth()).toBe(56);
    expect(vt.frozenHeight()).toBe(22);
  });

  it('corner は固定行×固定列・スクロール非依存', () => {
    expect(paneOf(panes, 'corner').rows).toEqual({ start: 0, end: 1 });
    expect(paneOf(panes, 'corner').cols).toEqual({ start: 0, end: 1 });
    // 固定セル (0,0) はスクロールしても header 直後で不変。
    expect(vt.cellRect(0, 0)).toEqual({ x: 44, y: 24, width: 56, height: 22 });
  });

  it('top=固定行×スクロール列・left=スクロール行×固定列・body=両スクロール', () => {
    expect(paneOf(panes, 'top').rows).toEqual({ start: 0, end: 1 });
    expect(paneOf(panes, 'top').cols).toEqual({ start: 18, end: 32 });
    expect(paneOf(panes, 'left').rows).toEqual({ start: 46, end: 72 });
    expect(paneOf(panes, 'left').cols).toEqual({ start: 0, end: 1 });
    expect(paneOf(panes, 'body').rows).toEqual({ start: 46, end: 72 });
    expect(paneOf(panes, 'body').cols).toEqual({ start: 18, end: 32 });
  });

  it('4 pane の行範囲・列範囲は重複しない（固定 vs スクロール）', () => {
    const body = paneOf(panes, 'body');
    const corner = paneOf(panes, 'corner');
    expect(corner.rows.end).toBeLessThanOrEqual(body.rows.start);
    expect(corner.cols.end).toBeLessThanOrEqual(body.cols.start);
  });
});

describe('ViewportTransform: ヒットテスト（§12.6・DOM非探索）', () => {
  it('header 領域: corner / column-header / row-header', () => {
    const vt = createViewportTransform(baseConfig());
    expect(vt.hitTest(10, 10).area).toBe('corner');

    const colHit = vt.hitTest(100, 10);
    expect(colHit.area).toBe('column-header');
    expect(colHit.colIndex).toBe(1);
    expect(colHit.columnId).toBe(createColumnId('c1'));

    const rowHit = vt.hitTest(10, 100);
    expect(rowHit.area).toBe('row-header');
    expect(rowHit.rowIndex).toBe(3);
    expect(rowHit.rowId).toBe(createRowId('r3'));
  });

  it('body セル: スクロール後の可視セル中央から rowId/columnId と局所座標を返す', () => {
    const vt = createViewportTransform(baseConfig({ scrollTop: 220, scrollLeft: 112 }));
    // cellRect(12,5) = x:212 y:68 w:56 h:22 → 中央 (240,79)
    const hit = vt.hitTest(240, 79);
    expect(hit.area).toBe('cell');
    expect(hit.rowIndex).toBe(12);
    expect(hit.colIndex).toBe(5);
    expect(hit.rowId).toBe(createRowId('r12'));
    expect(hit.columnId).toBe(createColumnId('c5'));
    expect(hit.localX).toBe(28);
    expect(hit.localY).toBe(11);
  });

  it('固定列バンド内のヒットはスクロール量に依存しない', () => {
    const vt = createViewportTransform(
      baseConfig({ frozenRowCount: 1, frozenColCount: 1, scrollLeft: 1000, scrollTop: 1000 }),
    );
    // x=70 は固定列バンド [44,100) 内。scrollLeft=1000 でも colIndex=0。
    const hit = vt.hitTest(70, 200);
    expect(hit.area).toBe('cell');
    expect(hit.colIndex).toBe(0);
  });
});

describe('ViewportTransform: overscan（§13.3）', () => {
  it('overscanY を増やすと可視行が増え、範囲は [0,count] にクランプ', () => {
    const withoutOverscan = createViewportTransform(baseConfig({ overscanY: 0 }));
    const withOverscan = createViewportTransform(baseConfig({ overscanY: 300 }));
    expect(withOverscan.visibleCellCount()).toBeGreaterThan(withoutOverscan.visibleCellCount());

    // 末尾付近でも end が count を超えない。
    const nearEnd = createViewportTransform(
      baseConfig({ scrollTop: 50000 * 22 - 400, overscanY: 1000 }),
    );
    const body = paneOf(nearEnd.panes(), 'body');
    expect(body.rows.end).toBeLessThanOrEqual(50000);
    expect(body.rows.start).toBeGreaterThanOrEqual(0);
  });
});
