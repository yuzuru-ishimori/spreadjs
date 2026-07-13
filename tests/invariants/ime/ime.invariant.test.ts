// IME 不変条件スイート（§2.3 IME 不変条件）。DD-011 設置・実充足は DD-012。
//
// 最小ケース: IME composition 中に編集セルへ remoteUpdate が来ても、
// 編集中 draft を書き換えない（＝textarea.value を破壊しない・§2.3「remote update中もdraft不変」）。
// 実 IME 状態機械（DOM 非依存）を synthetic イベントで駆動して検証する。
//
// 素材: apps/playground の編集状態機械。DD-012 で `@nanairo-sheet/ime` へ抽出したら import 先を差し替える。
import { describe, expect, it } from 'vitest';

import { DEFAULT_GRID_LAYOUT, cellKey } from '../../../apps/playground/src/grid/geometry';
import type { CellPosition } from '../../../apps/playground/src/grid/geometry';
import {
  createEditorStateMachine,
  type Effect,
} from '../../../apps/playground/src/ime/editor-state-machine';

const A1: CellPosition = { row: 0, col: 0 };

function makeMachine() {
  return createEditorStateMachine({
    layout: DEFAULT_GRID_LAYOUT,
    initialCell: A1,
    getCellValue: () => '',
  });
}

function effectTypes(effects: readonly Effect[]): string[] {
  return effects.map((e) => e.type);
}

describe('invariant/ime: composition 中の draft 不変', () => {
  it('composition 中の remoteUpdate は MarkConflict のみ・draft 保持・composing 維持（S-F2 ★）', () => {
    const m = makeMachine();
    m.dispatch({ type: 'compositionstart' });
    m.dispatch({ type: 'compositionupdate', data: '日本' });
    expect(m.isComposing()).toBe(true);
    expect(m.getDraft()).toBe('日本');

    const effects = m.dispatch({ type: 'remoteUpdate', cell: A1, value: '別値' });

    // draft を書き換える UpdateDraft/BeginEdit を出してはならない（textarea.value 不変の不変条件）。
    expect(effectTypes(effects)).not.toContain('UpdateDraft');
    expect(effectTypes(effects)).not.toContain('BeginEdit');
    // 競合はマークするだけ。
    expect(effects.find((e) => e.type === 'MarkConflict')).toBeDefined();
    // draft と composing 状態は不変。
    expect(m.getDraft()).toBe('日本');
    expect(m.isComposing()).toBe(true);
    expect(m.getConflictCells().has(cellKey(A1))).toBe(true);
  });

  it('リモート削除（value=null）でも draft を退避保持する（S-F3 ★）', () => {
    const m = makeMachine();
    m.dispatch({ type: 'compositionstart' });
    m.dispatch({ type: 'compositionupdate', data: '日本' });
    const effects = m.dispatch({ type: 'remoteUpdate', cell: A1, value: null });
    expect(effects.find((e) => e.type === 'MarkConflict')).toBeDefined();
    expect(m.getDraft()).toBe('日本');
    expect(m.isComposing()).toBe(true);
  });
});
