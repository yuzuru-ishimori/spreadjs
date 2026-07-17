// row-operations 純関数の単体テスト（DD-021-1 Phase 1・TDD）。
import { describe, expect, it } from 'vitest';

import { decideRowStructureKey, reduceActiveRowTarget, resolveDeleteTargets } from './row-operations';
import type { RowStructureKeyInput } from './row-operations';

function key(overrides: Partial<RowStructureKeyInput>): RowStructureKeyInput {
  return {
    key: '+',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    eventComposing: false,
    sessionComposing: false,
    phase: 'Navigation',
    ...overrides,
  };
}

describe('decideRowStructureKey', () => {
  it('Ctrl+Shift+"+" は insert（Navigation・非 composing）', () => {
    expect(decideRowStructureKey(key({ key: '+' }))).toBe('insert');
  });

  it('Ctrl+"-" は delete', () => {
    expect(decideRowStructureKey(key({ key: '-', shiftKey: false }))).toBe('delete');
  });

  it('Cmd（meta）でも成立する', () => {
    expect(decideRowStructureKey(key({ key: '+', ctrlKey: false, metaKey: true }))).toBe('insert');
    expect(decideRowStructureKey(key({ key: '-', ctrlKey: false, metaKey: true, shiftKey: false }))).toBe('delete');
  });

  it('修飾なしは none（グリッド裁定しない）', () => {
    expect(decideRowStructureKey(key({ key: '+', ctrlKey: false, metaKey: false }))).toBe('none');
    expect(decideRowStructureKey(key({ key: '-', ctrlKey: false, metaKey: false, shiftKey: false }))).toBe('none');
  });

  it('alt 併用は none', () => {
    expect(decideRowStructureKey(key({ key: '+', altKey: true }))).toBe('none');
  });

  it('Editing/Composing 位相・composing 中は必ず none（IME 不変条件・I-3）', () => {
    expect(decideRowStructureKey(key({ phase: 'EditingReplace' }))).toBe('none');
    expect(decideRowStructureKey(key({ phase: 'EditingExisting' }))).toBe('none');
    expect(decideRowStructureKey(key({ phase: 'EditingAwaitFinalInput' }))).toBe('none');
    expect(decideRowStructureKey(key({ phase: 'Composing' }))).toBe('none');
    expect(decideRowStructureKey(key({ eventComposing: true }))).toBe('none');
    expect(decideRowStructureKey(key({ sessionComposing: true }))).toBe('none');
  });

  it('無関係キーは none', () => {
    expect(decideRowStructureKey(key({ key: 'a' }))).toBe('none');
    expect(decideRowStructureKey(key({ key: 'ArrowDown', shiftKey: false }))).toBe('none');
  });
});

describe('resolveDeleteTargets', () => {
  const order = ['r0', 'r1', 'r2', 'r3'];

  it('現存する要求 ID を要求順で返す', () => {
    expect(resolveDeleteTargets(order, ['r2', 'r0'])).toEqual(['r2', 'r0']);
  });

  it('非現存 ID は除外する', () => {
    expect(resolveDeleteTargets(order, ['r2', 'ghost', 'r1'])).toEqual(['r2', 'r1']);
  });

  it('重複は先着で除去する', () => {
    expect(resolveDeleteTargets(order, ['r1', 'r1', 'r2'])).toEqual(['r1', 'r2']);
  });

  it('全て非現存/空なら []（実行前拒否のトリガ）', () => {
    expect(resolveDeleteTargets(order, ['ghost'])).toEqual([]);
    expect(resolveDeleteTargets(order, [])).toEqual([]);
  });
});

describe('reduceActiveRowTarget', () => {
  const order = ['r0', 'r1', 'r2', 'r3', 'r4'];

  it('active 行が生存なら unchanged', () => {
    expect(reduceActiveRowTarget(order, 1, new Set(['r3']))).toBe('unchanged');
  });

  it('active 行削除 → 下優先で直下の生存行へ', () => {
    expect(reduceActiveRowTarget(order, 2, new Set(['r2']))).toEqual({ rowId: 'r3' });
  });

  it('active 行と直下がまとめて削除 → さらに下の生存行へ', () => {
    expect(reduceActiveRowTarget(order, 2, new Set(['r2', 'r3']))).toEqual({ rowId: 'r4' });
  });

  it('下に生存行が無い → 上の生存行へ（上フォールバック）', () => {
    expect(reduceActiveRowTarget(order, 4, new Set(['r4']))).toEqual({ rowId: 'r3' });
    expect(reduceActiveRowTarget(order, 3, new Set(['r3', 'r4']))).toEqual({ rowId: 'r2' });
  });

  it('全行削除 → null（選択解除）', () => {
    expect(reduceActiveRowTarget(order, 2, new Set(order))).toBeNull();
  });

  it('active index が範囲外なら unchanged（防御）', () => {
    expect(reduceActiveRowTarget(order, 99, new Set(['r0']))).toBe('unchanged');
  });
});
