// IME 不変条件スイート追補（DD-020-2）: clipboard（copy/cut/paste）と composition の非干渉。
//
// DD-020-2 は常駐 textarea（IME 資産）の ClipboardEvent を copy/cut/paste へ配線した。削ってはいけない不変条件は
// 「**Navigation 位相かつ非 composing のときだけ**グリッド Command 化する（それ以外はブラウザ既定＝textarea 内
// テキスト編集へ委譲）」こと。これが破れると、変換中の paste が範囲貼り付けへ吸われ IME 経路（CG-1）が変質する。
// 裁定は shouldInterceptClipboard（純関数）に集約されており、ここで全位相×composing を掃引して固定する。
// 併せて「実セッションで composition 中は裁定が必ず false（＝グリッド paste が発火しえない）」を実 state で固定する。

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
import { shouldInterceptClipboard } from '../../../packages/grid/src/clipboard-controller';

// ---- 1. 裁定の不変条件（純関数・全位相 × composing の掃引） ------------------------------------

const ALL_PHASES: readonly EditPhase[] = [
  'Navigation',
  'EditingReplace',
  'EditingExisting',
  'EditingAwaitFinalInput',
  'Composing',
];

describe('invariant/ime clipboard: Navigation かつ非 composing のときだけ intercept する', () => {
  it('全位相 × composing フラグの掃引で phase===Navigation && !composing のみ true', () => {
    for (const phase of ALL_PHASES) {
      for (const composing of [false, true]) {
        const expected = phase === 'Navigation' && !composing;
        expect(shouldInterceptClipboard(phase, composing), `${phase} composing=${composing}`).toBe(expected);
      }
    }
  });

  it('composition 中（Navigation 位相でも composing=true）は必ず none（IME 経路へ委譲・I-3）', () => {
    expect(shouldInterceptClipboard('Navigation', true)).toBe(false);
  });
});

// ---- 2. 実セッション: composition 中は裁定が false（グリッド paste が発火しえない状態） -----------

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

describe('invariant/ime clipboard: 実セッションの composition 中は clipboard 裁定が false', () => {
  it('変換中は shouldInterceptClipboard(getPhase, isComposing)===false・確定後は true（draft 非破壊）', () => {
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

    // Navigation・非 composing → intercept 可（グリッド copy/cut/paste が成立する状態）。
    expect(shouldInterceptClipboard(session.getPhase(), session.isComposing())).toBe(true);

    // 変換開始 → Composing・isComposing=true → 裁定は false（グリッド paste は発火しえない＝ブラウザ既定へ）。
    session.handleEvent({ type: 'compositionstart' });
    fake.browserSetValue('にほん');
    session.handleEvent({ type: 'compositionupdate', data: 'にほん' });
    expect(session.isComposing()).toBe(true);
    expect(shouldInterceptClipboard(session.getPhase(), session.isComposing())).toBe(false);
    expect(session.getDraft()).toBe('にほん'); // draft は不変（clipboard 裁定は state に触れない）

    // 確定 → Navigation へ戻り再び intercept 可（draft は失われていない＝commit 経路は無変更）。
    session.handleEvent({ type: 'compositionend', data: 'にほん' });
    session.handleEvent({ type: 'input', value: 'にほん', isComposing: false });
    session.handleEvent({ type: 'keyup', key: 'Enter', isComposing: false });
    session.handleEvent({ type: 'keydown', key: 'Enter', isComposing: false });
    expect(shouldInterceptClipboard(session.getPhase(), session.isComposing())).toBe(true);
  });
});
