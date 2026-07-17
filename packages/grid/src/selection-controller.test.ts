// selection-controller のユニットテスト（DD-020-1 Phase 1）。
// 明示レンジの不変条件（anchor=activeCell・Navigation 限定）・ドラッグ昇格・Shift 拡張のクランプ・
// keydown 前段裁定（composition 中は常に不消費=AC7 の土台）を DOM なしで機械検証する。

import { describe, expect, it } from 'vitest';

import {
  createSelectionController,
  decideNavigationIntercept,
  type SelectionBounds,
} from './selection-controller';

const BOUNDS: SelectionBounds = { rowCount: 10, colCount: 5 };
const A = { row: 2, col: 2 };

describe('selection-controller: ドラッグ選択（AC1）', () => {
  it('beginDrag→updateDrag 中は dragRange のみ・endDrag で明示レンジへ昇格する', () => {
    const c = createSelectionController();
    c.beginDrag(A);
    expect(c.isDragging()).toBe(true);
    expect(c.getRange()).toBeNull(); // 確定前
    c.updateDrag({ row: 5, col: 4 });
    expect(c.getDragRange()).toEqual({ rowStart: 2, rowEnd: 6, colStart: 2, colEnd: 5 });
    const confirmed = c.endDrag();
    expect(confirmed).toEqual({ rowStart: 2, rowEnd: 6, colStart: 2, colEnd: 5 });
    expect(c.getRange()).toEqual(confirmed);
    expect(c.getDragRange()).toBeNull();
    expect(c.isDragging()).toBe(false);
  });

  it('逆方向ドラッグ（右下→左上）でも正規化された矩形になる', () => {
    const c = createSelectionController();
    c.beginDrag({ row: 5, col: 4 });
    c.updateDrag({ row: 2, col: 2 });
    expect(c.endDrag()).toEqual({ rowStart: 2, rowEnd: 6, colStart: 2, colEnd: 5 });
  });

  it('同一セルで endDrag（＝クリック）すると明示レンジは作られない', () => {
    const c = createSelectionController();
    c.beginDrag(A);
    expect(c.endDrag()).toBeNull();
    expect(c.getRange()).toBeNull();
  });

  it('cancelDrag はドラッグだけ破棄し、確定済みレンジへ影響しない', () => {
    const c = createSelectionController();
    c.extendTo(A, { row: 4, col: 3 });
    const before = c.getRange();
    c.beginDrag({ row: 0, col: 0 });
    c.updateDrag({ row: 1, col: 1 });
    c.cancelDrag();
    expect(c.getDragRange()).toBeNull();
    expect(c.getRange()).toEqual(before);
  });
});

describe('selection-controller: rebaseRows（K3 行構造変更後の再ベース・DD-021-3）', () => {
  it('明示レンジが無ければ no-op（false）', () => {
    const c = createSelectionController();
    expect(c.rebaseRows((r) => r + 1)).toBe(false);
    expect(c.getRange()).toBeNull();
  });

  it('両端の行が下方シフト（上に挿入）→ 追従して矩形が下がる・列は不変', () => {
    const c = createSelectionController();
    c.extendTo({ row: 2, col: 1 }, { row: 4, col: 3 }); // rows 2..4
    const changed = c.rebaseRows((r) => r + 2); // 上に 2 行挿入相当
    expect(changed).toBe(true);
    expect(c.getRange()).toEqual({ rowStart: 4, rowEnd: 7, colStart: 1, colEnd: 4 });
  });

  it('index 不変なら false（下に挿入など）', () => {
    const c = createSelectionController();
    c.extendTo({ row: 2, col: 1 }, { row: 4, col: 3 });
    expect(c.rebaseRows((r) => r)).toBe(false);
  });

  it('片端が生存行なし（null）→ 単一選択へ縮退（clear）', () => {
    const c = createSelectionController();
    c.extendTo({ row: 2, col: 1 }, { row: 4, col: 3 });
    const changed = c.rebaseRows((r) => (r === 4 ? null : r));
    expect(changed).toBe(true);
    expect(c.getRange()).toBeNull();
  });

  it('再ベース後に同一セルへ潰れたら単一選択へ正規化', () => {
    const c = createSelectionController();
    c.extendTo({ row: 2, col: 1 }, { row: 4, col: 1 }); // 同一列の縦レンジ
    const changed = c.rebaseRows(() => 3); // 両端が同じ行へ
    expect(changed).toBe(true);
    expect(c.getRange()).toBeNull();
  });
});

describe('selection-controller: Shift+クリック拡張（AC2）', () => {
  it('anchor〜focus の矩形へ置き換える（anchor は渡された activeCell）', () => {
    const c = createSelectionController();
    c.extendTo(A, { row: 4, col: 3 });
    expect(c.getRange()).toEqual({ rowStart: 2, rowEnd: 5, colStart: 2, colEnd: 4 });
  });

  it('同一セルへの extendTo は単一選択（null）へ正規化する', () => {
    const c = createSelectionController();
    c.extendTo(A, { row: 4, col: 3 });
    c.extendTo(A, A);
    expect(c.getRange()).toBeNull();
  });
});

describe('selection-controller: Shift+矢印拡張（AC3）', () => {
  it('focus 端のみ拡張し anchor（=activeCell）は不変', () => {
    const c = createSelectionController();
    c.extendByArrow(A, 'down', BOUNDS);
    c.extendByArrow(A, 'down', BOUNDS);
    c.extendByArrow(A, 'right', BOUNDS);
    expect(c.getRange()).toEqual({ rowStart: 2, rowEnd: 5, colStart: 2, colEnd: 4 });
    // anchor が固定なので selectedRange(anchor) も同じ矩形。
    expect(c.selectedRange(A)).toEqual({ rowStart: 2, rowEnd: 5, colStart: 2, colEnd: 4 });
  });

  it('逆方向で focus が anchor に戻ると単一選択（null）へ縮退する', () => {
    const c = createSelectionController();
    c.extendByArrow(A, 'down', BOUNDS);
    expect(c.getRange()).not.toBeNull();
    c.extendByArrow(A, 'up', BOUNDS);
    expect(c.getRange()).toBeNull();
  });

  it('グリッド端でクランプされる（範囲外へ出ない）', () => {
    const c = createSelectionController();
    const edge = { row: 0, col: 0 };
    const focus = c.extendByArrow(edge, 'up', BOUNDS);
    expect(focus).toEqual({ row: 0, col: 0 }); // 上端で留まる → 同一セル → レンジなし
    expect(c.getRange()).toBeNull();
    c.extendByArrow({ row: 9, col: 4 }, 'down', BOUNDS);
    expect(c.getRange()).toBeNull(); // 下端も同様
  });

  it('anchor を跨いで反対側へ拡張できる（focus が anchor の上へ）', () => {
    const c = createSelectionController();
    c.extendByArrow(A, 'down', BOUNDS); // focus (3,2)
    c.extendByArrow(A, 'up', BOUNDS); // focus (2,2)=anchor → null
    c.extendByArrow(A, 'up', BOUNDS); // focus (1,2)
    expect(c.getRange()).toEqual({ rowStart: 1, rowEnd: 3, colStart: 2, colEnd: 3 });
  });
});

describe('selection-controller: 解除の不変条件（AC4）', () => {
  it('activeCell が anchor から動いたら syncWithEditor が解除する（通常矢印/クリック移動）', () => {
    const c = createSelectionController();
    c.extendTo(A, { row: 4, col: 3 });
    expect(c.syncWithEditor({ row: 3, col: 2 }, 'Navigation')).toBe(true);
    expect(c.getRange()).toBeNull();
  });

  it('編集開始（Navigation 以外の位相）で解除する', () => {
    const c = createSelectionController();
    c.extendTo(A, { row: 4, col: 3 });
    expect(c.syncWithEditor(A, 'EditingReplace')).toBe(true);
    expect(c.getRange()).toBeNull();
  });

  it('composition 開始（Composing 位相）でも解除する（textarea には触れない=状態のみ）', () => {
    const c = createSelectionController();
    c.extendTo(A, { row: 4, col: 3 });
    expect(c.syncWithEditor(A, 'Composing')).toBe(true);
    expect(c.getRange()).toBeNull();
  });

  it('anchor===activeCell かつ Navigation の間は維持される（Shift 拡張直後の onChange で消えない）', () => {
    const c = createSelectionController();
    c.extendTo(A, { row: 4, col: 3 });
    expect(c.syncWithEditor(A, 'Navigation')).toBe(false);
    expect(c.getRange()).not.toBeNull();
  });

  it('レンジ未形成のドラッグ中（pointerdown 直後の onChange）は解除しない', () => {
    const c = createSelectionController();
    c.beginDrag(A);
    expect(c.syncWithEditor(A, 'Navigation')).toBe(false);
    expect(c.isDragging()).toBe(true);
  });

  it('clear は明示レンジとドラッグの両方を破棄し、変化有無を返す', () => {
    const c = createSelectionController();
    expect(c.clear()).toBe(false); // 何もない状態の clear は変化なし
    c.extendTo(A, { row: 4, col: 3 });
    expect(c.clear()).toBe(true);
    expect(c.getRange()).toBeNull();
  });
});

describe('selection-controller: selectedRange（DD-020-2 引き継ぎ契約）', () => {
  it('明示レンジがあればそれを、無ければ activeCell の単一セルを返す', () => {
    const c = createSelectionController();
    expect(c.selectedRange(A)).toEqual({ rowStart: 2, rowEnd: 3, colStart: 2, colEnd: 3 });
    c.extendTo(A, { row: 4, col: 3 });
    expect(c.selectedRange(A)).toEqual({ rowStart: 2, rowEnd: 5, colStart: 2, colEnd: 4 });
  });
});

describe('decideNavigationIntercept: keydown 前段裁定（案X）', () => {
  const base = {
    key: 'ArrowDown',
    shiftKey: true,
    eventComposing: false,
    sessionComposing: false,
    phase: 'Navigation',
    hasRange: false,
  } as const;

  it('Navigation の Shift+矢印は extend（状態機械の Move にしない）', () => {
    expect(decideNavigationIntercept({ ...base })).toEqual({ action: 'extend', direction: 'down' });
    expect(decideNavigationIntercept({ ...base, key: 'ArrowLeft' })).toEqual({
      action: 'extend',
      direction: 'left',
    });
  });

  it('Shift+Enter / Shift+Tab は消費しない（既存の逆方向移動を保存）', () => {
    expect(decideNavigationIntercept({ ...base, key: 'Enter' })).toEqual({ action: 'none' });
    expect(decideNavigationIntercept({ ...base, key: 'Tab' })).toEqual({ action: 'none' });
  });

  it('composition 中（DOM/内部いずれか）は常に none（IME 経路を変えない・AC7）', () => {
    expect(decideNavigationIntercept({ ...base, eventComposing: true })).toEqual({ action: 'none' });
    expect(decideNavigationIntercept({ ...base, sessionComposing: true })).toEqual({ action: 'none' });
    expect(
      decideNavigationIntercept({ ...base, phase: 'Composing', key: 'Escape', hasRange: true }),
    ).toEqual({ action: 'none' });
  });

  it('編集中（EditingReplace/EditingExisting/AwaitFinalInput）は none（矢印=キャレット移動を保存）', () => {
    expect(decideNavigationIntercept({ ...base, phase: 'EditingReplace' })).toEqual({ action: 'none' });
    expect(decideNavigationIntercept({ ...base, phase: 'EditingExisting' })).toEqual({ action: 'none' });
    expect(decideNavigationIntercept({ ...base, phase: 'EditingAwaitFinalInput' })).toEqual({
      action: 'none',
    });
  });

  it('Escape はレンジがあるときだけ clear-range（キーは状態機械へも流す）', () => {
    expect(
      decideNavigationIntercept({ ...base, key: 'Escape', shiftKey: false, hasRange: true }),
    ).toEqual({ action: 'clear-range' });
    expect(
      decideNavigationIntercept({ ...base, key: 'Escape', shiftKey: false, hasRange: false }),
    ).toEqual({ action: 'none' });
  });

  it('Delete はレンジがあるとき delete-range（範囲クリアとして消費・状態機械の単一セル Delete にしない）', () => {
    expect(
      decideNavigationIntercept({ ...base, key: 'Delete', shiftKey: false, hasRange: true }),
    ).toEqual({ action: 'delete-range' });
    // Shift+Delete も同じ（状態機械の S-A4 が shift を見ないのと整合）。
    expect(decideNavigationIntercept({ ...base, key: 'Delete', shiftKey: true, hasRange: true })).toEqual({
      action: 'delete-range',
    });
  });

  it('レンジが無い Delete は none（既存の単一セル Delete=S-A4 経路を保存）', () => {
    expect(
      decideNavigationIntercept({ ...base, key: 'Delete', shiftKey: false, hasRange: false }),
    ).toEqual({ action: 'none' });
  });

  it('composition 中・編集中の Delete は none（textarea 内のテキスト編集を奪わない・AC7）', () => {
    expect(
      decideNavigationIntercept({ ...base, key: 'Delete', shiftKey: false, hasRange: true, eventComposing: true }),
    ).toEqual({ action: 'none' });
    expect(
      decideNavigationIntercept({ ...base, key: 'Delete', shiftKey: false, hasRange: true, sessionComposing: true }),
    ).toEqual({ action: 'none' });
    expect(
      decideNavigationIntercept({ ...base, key: 'Delete', shiftKey: false, hasRange: true, phase: 'EditingExisting' }),
    ).toEqual({ action: 'none' });
  });
});
