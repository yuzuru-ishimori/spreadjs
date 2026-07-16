// IME 不変条件スイート追補（DD-020-1）: 範囲選択・範囲 Delete と composition の非干渉。
//
// DD-020-1 は keydown/pointerdown の**前段裁定**（decideNavigationIntercept）を状態機械の前に挟んだ。
// 削ってはいけない不変条件は「**composition 中（DOM の isComposing / 状態機械の内部 composing のいずれか）と
// 非 Navigation 位相では、前段裁定はイベントを一切消費しない（'none'）**」こと。これが破れると、変換中の
// Shift+矢印・Delete・Escape がレンジ操作/範囲クリアへ吸われ、IME 経路（CG-1 常設ガードレール）が変質する。
// 併せて「変換中に Delete/Shift+矢印 keydown が状態機械へ流れても Commit（=SetCells submit）が発生しない」
// ことを実セッション（createImeEditingSession＋fake TextareaPort）で固定する（I-3: value/selection 不書換）。

import { describe, expect, it } from 'vitest';

import { applyOperation, createDocument, displayRowOrder, getCell } from '@nanairo-sheet/core';
import type { DocumentOperation, SetCellsOperation } from '@nanairo-sheet/core';
import { createColumnId, createRowId } from '@nanairo-sheet/types';

import { DEFAULT_GRID_LAYOUT } from '@nanairo-sheet/ime';
import type { EditPhase, GridLayout } from '@nanairo-sheet/ime';
import { cellScalarToDisplay } from '../../../packages/grid/src/document-view';
import {
  createImeEditingSession,
  type EditingDocumentPort,
  type TextareaPort,
} from '../../../packages/grid/src/ime-editing-session';
import {
  decideNavigationIntercept,
  type NavigationInterceptInput,
} from '../../../packages/grid/src/selection-controller';

// ---- 1. 前段裁定の不変条件（純関数・全キー×全位相の掃引） ---------------------------------------

const INTERCEPT_KEYS: ReadonlyArray<{ key: string; shiftKey: boolean }> = [
  { key: 'ArrowUp', shiftKey: true },
  { key: 'ArrowDown', shiftKey: true },
  { key: 'ArrowLeft', shiftKey: true },
  { key: 'ArrowRight', shiftKey: true },
  { key: 'Delete', shiftKey: false },
  { key: 'Delete', shiftKey: true },
  { key: 'Escape', shiftKey: false },
];

const NON_NAVIGATION_PHASES: readonly EditPhase[] = [
  'EditingReplace',
  'EditingExisting',
  'EditingAwaitFinalInput',
  'Composing',
];

describe('invariant/ime 範囲選択: 前段裁定は composition 中・編集中に一切消費しない', () => {
  it('eventComposing / sessionComposing のいずれかが true なら全対象キーで none（hasRange でも）', () => {
    for (const { key, shiftKey } of INTERCEPT_KEYS) {
      for (const flags of [
        { eventComposing: true, sessionComposing: false },
        { eventComposing: false, sessionComposing: true },
        { eventComposing: true, sessionComposing: true },
      ]) {
        const input: NavigationInterceptInput = {
          key,
          shiftKey,
          ...flags,
          phase: 'Navigation',
          hasRange: true,
        };
        expect(decideNavigationIntercept(input), `${key} (${JSON.stringify(flags)})`).toEqual({
          action: 'none',
        });
      }
    }
  });

  it('非 Navigation 位相（編集中・Composing）は全対象キーで none（矢印=キャレット移動・Delete=textarea 編集を保存）', () => {
    for (const { key, shiftKey } of INTERCEPT_KEYS) {
      for (const phase of NON_NAVIGATION_PHASES) {
        const input: NavigationInterceptInput = {
          key,
          shiftKey,
          eventComposing: false,
          sessionComposing: false,
          phase,
          hasRange: true,
        };
        expect(decideNavigationIntercept(input), `${key} @${phase}`).toEqual({ action: 'none' });
      }
    }
  });
});

// ---- 2. 実セッション: 変換中の Delete / Shift+矢印で SetCells が submit されない -------------------

const SESSION_LAYOUT: GridLayout = { ...DEFAULT_GRID_LAYOUT, rowCount: 100, columnCount: 3 };
const DOC_COLS = [createColumnId('col-0'), createColumnId('col-1'), createColumnId('col-2')];

function createFakePort() {
  let value = '';
  const calls = { setValue: 0, setSelectionRange: 0 };
  const port: TextareaPort = {
    getValue: () => value,
    setValue: (v) => {
      value = v;
      calls.setValue += 1;
    },
    setSelectionRange: () => {
      calls.setSelectionRange += 1;
    },
    focus: () => {},
    place: () => {},
    setEditingVisual: () => {},
    setConflict: () => {},
  };
  return { port, calls, browserSetValue: (v: string) => (value = v) };
}

function createDocPort(ops: DocumentOperation[]): EditingDocumentPort {
  let doc = createDocument(DOC_COLS);
  let revision = 0;
  for (const op of ops) {
    revision += 1;
    doc = applyOperation(doc, op, { revision }).document;
  }
  return {
    getCommittedDocument: () => doc,
    displayText: (rowId, columnId) => cellScalarToDisplay(getCell(doc, rowId, columnId)?.value ?? { kind: 'blank' }),
    rowIdAt: (i) => displayRowOrder(doc)[i],
    colIdAt: (i) => doc.columnOrder[i],
    rowIndexOf: (rowId) => displayRowOrder(doc).indexOf(rowId),
    colIndexOf: (columnId) => doc.columnOrder.indexOf(columnId),
  };
}

describe('invariant/ime 範囲選択: 変換中の Delete/Shift+矢印はセルクリアを発火しない（draft 不変）', () => {
  it('composition 中の keydown Delete / Shift+ArrowDown で submit 0 件・draft/composing/port 不変', () => {
    const rows: DocumentOperation = {
      type: 'insertRows',
      afterRowId: null,
      rows: [{ rowId: createRowId('r0') }, { rowId: createRowId('r1') }],
    };
    const fake = createFakePort();
    const submitted: SetCellsOperation[] = [];
    const session = createImeEditingSession({
      document: createDocPort([rows]),
      port: fake.port,
      submit: (op) => submitted.push(op),
      layout: SESSION_LAYOUT,
    });
    session.handleEvent({ type: 'pointerdown', target: 'cell', cell: { row: 0, col: 0 } });
    session.handleEvent({ type: 'compositionstart' });
    fake.browserSetValue('にほん');
    session.handleEvent({ type: 'compositionupdate', data: 'にほん' });
    const baseSetValue = fake.calls.setValue;
    const baseSetSel = fake.calls.setSelectionRange;

    // 変換中の Delete（範囲クリアのキー）と Shift+矢印（レンジ拡張のキー）。
    // 前段裁定（decideNavigationIntercept）は 'none' を返す契約（上の掃引で固定済み）＝両イベントは
    // 状態機械へそのまま流れる。状態機械は Commit を出さず、draft・composing・port を破壊しない。
    session.handleEvent({ type: 'keydown', key: 'Delete', isComposing: true });
    session.handleEvent({ type: 'keydown', key: 'ArrowDown', isComposing: true, shiftKey: true });

    expect(submitted).toHaveLength(0); // セルクリア（SetCells）は一切 submit されない
    expect(session.isComposing()).toBe(true);
    expect(session.getDraft()).toBe('にほん');
    expect(session.getActiveCell()).toEqual({ row: 0, col: 0 }); // 移動もしない
    expect(fake.calls.setValue).toBe(baseSetValue); // I-3: value 不書換
    expect(fake.calls.setSelectionRange).toBe(baseSetSel); // I-3: selection 不書換
  });
});
