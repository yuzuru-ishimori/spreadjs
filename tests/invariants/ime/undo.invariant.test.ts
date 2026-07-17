// IME 不変条件スイート追補（DD-020-3）: Undo/Redo キーバインド（Ctrl+Z/Y）と composition の非干渉。
//
// DD-020-3 は常駐 textarea（IME 資産）の keydown へ Ctrl/Cmd+Z=Undo・Ctrl+Y/Ctrl+Shift+Z=Redo を配線した。
// 削ってはいけない不変条件は「**Navigation 位相かつ非 composing のときだけ**グリッド Undo/Redo 化する
// （それ以外はブラウザ既定＝textarea 内テキスト undo へ委譲）」こと（親 (b)・I-3）。これが破れると、変換中/編集中の
// Ctrl+Z が draft を巻き戻し IME 経路（CG-1）が変質する。裁定は decideUndoRedoKey（純関数）に集約され、
// ここで全位相×composing を掃引して固定する。併せて実セッションの composition 中に裁定が必ず 'none' を返すことを固定する。

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
import { decideUndoRedoKey } from '../../../packages/grid/src/undo-stack';

const ALL_PHASES: readonly EditPhase[] = [
  'Navigation',
  'EditingReplace',
  'EditingExisting',
  'EditingAwaitFinalInput',
  'Composing',
];

// ---- 1. 裁定の不変条件（純関数・全位相 × composing の掃引） ------------------------------------

describe('invariant/ime undo: Navigation かつ非 composing のときだけ Undo/Redo 化する', () => {
  it('全位相 × composing の掃引で Ctrl+Z が undo になるのは Navigation×非 composing のみ', () => {
    for (const phase of ALL_PHASES) {
      for (const composing of [false, true]) {
        const decision = decideUndoRedoKey({
          key: 'z',
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
          eventComposing: composing,
          sessionComposing: composing,
          phase,
        });
        const expected = phase === 'Navigation' && !composing ? 'undo' : 'none';
        expect(decision, `${phase} composing=${composing}`).toBe(expected);
      }
    }
  });

  it('composition 中（Navigation 位相でも composing=true）は必ず none（IME 経路へ委譲・I-3）', () => {
    expect(
      decideUndoRedoKey({
        key: 'z',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        eventComposing: true,
        sessionComposing: true,
        phase: 'Navigation',
      }),
    ).toBe('none');
  });
});

// ---- 2. 実セッション: composition 中は裁定が none（draft 非破壊） -------------------------------

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

describe('invariant/ime undo: 実セッションの composition 中は Undo 裁定が none（draft 非破壊）', () => {
  it('変換中は decideUndoRedoKey(getPhase, isComposing)===none・確定後は undo 可（draft 非破壊）', () => {
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

    const decide = (): string =>
      decideUndoRedoKey({
        key: 'z',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        eventComposing: session.isComposing(),
        sessionComposing: session.isComposing(),
        phase: session.getPhase(),
      });

    // Navigation・非 composing → undo 可。
    expect(decide()).toBe('undo');

    // 変換開始 → Composing・isComposing=true → 裁定は none（グリッド Undo は発火しえない）。draft 不変。
    session.handleEvent({ type: 'compositionstart' });
    fake.browserSetValue('にほん');
    session.handleEvent({ type: 'compositionupdate', data: 'にほん' });
    expect(session.isComposing()).toBe(true);
    expect(decide()).toBe('none');
    expect(session.getDraft()).toBe('にほん');

    // 確定 → Navigation へ戻り再び undo 可（draft は失われていない＝commit 経路は無変更）。
    session.handleEvent({ type: 'compositionend', data: 'にほん' });
    session.handleEvent({ type: 'input', value: 'にほん', isComposing: false });
    session.handleEvent({ type: 'keyup', key: 'Enter', isComposing: false });
    session.handleEvent({ type: 'keydown', key: 'Enter', isComposing: false });
    expect(decide()).toBe('undo');
  });
});
