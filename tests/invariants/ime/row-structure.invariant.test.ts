// IME 不変条件スイート追補（DD-021-1）: 行操作ショートカット（Ctrl+Shift+'+' / Ctrl+'-'）と composition の非干渉。
//
// DD-021-1 は常駐 textarea（IME 資産）の keydown へ Ctrl+Shift+'+'=行挿入・Ctrl+'-'=行削除を配線した。
// 削ってはいけない不変条件は「**Navigation 位相かつ非 composing のときだけ**グリッド行操作化する
// （それ以外はブラウザ既定へ委譲＝IME 経路 CG-1 を変質させない）」こと（親⑦・I-3）。裁定は decideRowStructureKey
// （純関数）に集約され、ここで全位相 × composing を掃引して固定する。併せて実セッションの composition 中に
// 裁定が必ず 'none' を返し draft を破壊しないことを固定する（AC4）。

import { describe, expect, it } from 'vitest';

import { applyOperation, createDocument, displayRowOrder, getCell } from '@nanairo-sheet/core';
import type { DocumentOperation } from '@nanairo-sheet/core';
import { createColumnId, createRowId } from '@nanairo-sheet/types';

import { DEFAULT_GRID_LAYOUT } from '@nanairo-sheet/ime';
import type { EditPhase, GridLayout } from '@nanairo-sheet/ime';
import { cellScalarToDisplay } from '../../../packages/grid/src/document-view';
import {
  createImeEditingSession,
  type EditingDocumentPort,
  type TextareaPort,
} from '../../../packages/grid/src/ime-editing-session';
import { decideRowStructureKey } from '../../../packages/grid/src/row-operations';

const ALL_PHASES: readonly EditPhase[] = [
  'Navigation',
  'EditingReplace',
  'EditingExisting',
  'EditingAwaitFinalInput',
  'Composing',
];

// ---- 1. 裁定の不変条件（純関数・全位相 × composing の掃引） ------------------------------------

describe('invariant/ime row-structure: Navigation かつ非 composing のときだけ行操作化する', () => {
  it('全位相 × composing の掃引で Ctrl+Shift+"+" が insert になるのは Navigation×非 composing のみ', () => {
    for (const phase of ALL_PHASES) {
      for (const composing of [false, true]) {
        const decision = decideRowStructureKey({
          key: '+',
          ctrlKey: true,
          metaKey: false,
          shiftKey: true,
          altKey: false,
          eventComposing: composing,
          sessionComposing: composing,
          phase,
        });
        const expected = phase === 'Navigation' && !composing ? 'insert' : 'none';
        expect(decision, `${phase} composing=${composing}`).toBe(expected);
      }
    }
  });

  it('全位相 × composing の掃引で Ctrl+"-" が delete になるのは Navigation×非 composing のみ', () => {
    for (const phase of ALL_PHASES) {
      for (const composing of [false, true]) {
        const decision = decideRowStructureKey({
          key: '-',
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
          eventComposing: composing,
          sessionComposing: composing,
          phase,
        });
        const expected = phase === 'Navigation' && !composing ? 'delete' : 'none';
        expect(decision, `${phase} composing=${composing}`).toBe(expected);
      }
    }
  });
});

// ---- 2. 実セッション: composition 中は裁定が none（draft 非破壊・AC4） ----------------------------

const SESSION_LAYOUT: GridLayout = { ...DEFAULT_GRID_LAYOUT, rowCount: 100, columnCount: 3 };
const DOC_COLS = [createColumnId('col-0'), createColumnId('col-1'), createColumnId('col-2')];

function createFakePort(): { port: TextareaPort; browserSetValue: (v: string) => void } {
  let value = '';
  const port: TextareaPort = {
    getValue: () => value,
    setValue: (v) => {
      value = v;
    },
    setSelectionRange: () => {},
    focus: () => {},
    place: () => {},
    setEditingVisual: () => {},
    setConflict: () => {},
  };
  return { port, browserSetValue: (v: string) => (value = v) };
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

describe('invariant/ime row-structure: composition 中は行操作裁定が none（draft 非破壊・AC4）', () => {
  it('変換中は decideRowStructureKey(getPhase, isComposing)===none・確定後は Navigation で insert/delete 可', () => {
    const rows: DocumentOperation = {
      type: 'insertRows',
      afterRowId: null,
      rows: [{ rowId: createRowId('r0') }],
    };
    const fake = createFakePort();
    const session = createImeEditingSession({
      document: createDocPort([rows]),
      port: fake.port,
      submit: () => {},
      layout: SESSION_LAYOUT,
    });
    session.handleEvent({ type: 'pointerdown', target: 'cell', cell: { row: 0, col: 0 } });

    const decideInsert = (): string =>
      decideRowStructureKey({
        key: '+',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        eventComposing: session.isComposing(),
        sessionComposing: session.isComposing(),
        phase: session.getPhase(),
      });

    // Navigation・非 composing → insert 可。
    expect(decideInsert()).toBe('insert');

    // 変換開始 → Composing・isComposing=true → 裁定は none（行操作は発火しえない）。draft 不変。
    session.handleEvent({ type: 'compositionstart' });
    fake.browserSetValue('にほん');
    session.handleEvent({ type: 'compositionupdate', data: 'にほん' });
    expect(session.isComposing()).toBe(true);
    expect(decideInsert()).toBe('none');
    expect(session.getDraft()).toBe('にほん');

    // 確定 → Navigation へ戻り再び insert 可（draft は失われていない＝commit 経路は無変更）。
    session.handleEvent({ type: 'compositionend', data: 'にほん' });
    session.handleEvent({ type: 'input', value: 'にほん', isComposing: false });
    session.handleEvent({ type: 'keyup', key: 'Enter', isComposing: false });
    session.handleEvent({ type: 'keydown', key: 'Enter', isComposing: false });
    expect(decideInsert()).toBe('insert');
  });
});

// ---- 3. K4（DD-021-2・親④/D7）: composition 中の対象行リモート削除で draft 非破壊・編集継続 ----------

/** 可変 committed 文書に対する EditingDocumentPort（リモート削除を後から適用できる）。 */
function createMutableDocPort(ops: DocumentOperation[]): {
  port: EditingDocumentPort;
  apply: (op: DocumentOperation) => void;
} {
  let doc = createDocument(DOC_COLS);
  let revision = 0;
  const apply = (op: DocumentOperation): void => {
    revision += 1;
    doc = applyOperation(doc, op, { revision }).document;
  };
  for (const op of ops) {
    apply(op);
  }
  const port: EditingDocumentPort = {
    getCommittedDocument: () => doc,
    displayText: (rowId, columnId) => cellScalarToDisplay(getCell(doc, rowId, columnId)?.value ?? { kind: 'blank' }),
    rowIdAt: (i) => displayRowOrder(doc)[i],
    colIdAt: (i) => doc.columnOrder[i],
    rowIndexOf: (rowId) => displayRowOrder(doc).indexOf(rowId),
    colIndexOf: (columnId) => doc.columnOrder.indexOf(columnId),
  };
  return { port, apply };
}

describe('invariant/ime row-structure（K4）: composition 中の対象行リモート削除で draft 非破壊・編集継続', () => {
  it('編集対象行が削除されても draft/composition は保持され、行消失インジケーターが立つ（状態機械無変更）', () => {
    const state = createMutableDocPort([
      { type: 'insertRows', afterRowId: null, rows: [{ rowId: createRowId('r0') }, { rowId: createRowId('r1') }] },
    ]);
    const fake = createFakePort();
    const session = createImeEditingSession({
      document: state.port,
      port: fake.port,
      submit: () => {},
      layout: SESSION_LAYOUT,
    });

    // (r1,col-0) で変換中にする。
    session.handleEvent({ type: 'pointerdown', target: 'cell', cell: { row: 1, col: 0 } });
    session.handleEvent({ type: 'compositionstart' });
    fake.browserSetValue('へんかん');
    session.handleEvent({ type: 'compositionupdate', data: 'へんかん' });
    expect(session.isComposing()).toBe(true);
    expect(session.getDraft()).toBe('へんかん');
    const targetBefore = session.getEditingTarget();

    // 他 client が r1 を削除（リモート DeleteRows が committed へ入る）→ noteServerUpdate。
    state.apply({ type: 'deleteRows', rowIds: [createRowId('r1')] });
    session.noteServerUpdate();

    // K4 不変: composition・draft・editingTarget は破壊されず編集継続。行消失インジケーターだけ立つ。
    expect(session.isComposing()).toBe(true);
    expect(session.getDraft()).toBe('へんかん');
    expect(session.getEditingTarget()).toEqual(targetBefore);
    expect(session.getPhase()).toBe('Composing');
    expect(session.isTargetLost()).toBe(true);
    // 行操作裁定は composition 中ゆえ none のまま（IME 不変条件・削除で状態機械を触っていない証拠）。
    expect(
      decideRowStructureKey({
        key: '+',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        eventComposing: session.isComposing(),
        sessionComposing: session.isComposing(),
        phase: session.getPhase(),
      }),
    ).toBe('none');
  });
});
