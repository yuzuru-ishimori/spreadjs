// IME 不変条件スイート（§2.3 IME 不変条件6項目・DD-012-1 AC6 で実充足）。
//
// 実 IME 状態機械（DOM 非依存）を synthetic イベントで駆動し、composition の正しさを機械検証する。
// 状態機械は Effect（UI アダプタが適用する副作用の記述）を返すため、「壊してはならない副作用を
// 一切 emit しない」ことを Effect 列で検証できる（DOM を立てずに不変条件をカバー）。
//
// 6項目（AC6）:
//   1. composition 中に textarea.value を書き換えない（＝draft を破壊する Effect を emit しない）
//   2. composition 中に selection を破壊しない（caret 設定=BeginEdit(existing) を composition 中に出さない）
//   3. textarea instance・DOM 親を置換しない（再 BeginEdit で編集セッションを作り直さない）
//   4. 確定 Enter 順序A（input→Enter）・順序B（compositionend→Enter）の両方で先頭欠落0・確定値一致
//   5. remote update・rollback/replay 中も draft 不変（MarkConflict のみ・値を上書きしない）
//   6. synthetic と実 IME を混同しない（isComposing / 'Process' / 内部 composing フラグで区別）
//
// 素材: `@nanairo-sheet/ime` の編集状態機械（editor-state-machine＋geometry）。DD-012-1 で抽出を見送った
//   ため import 先は apps/playground を指していたが、**DD-016-1 で物理抽出完了**し `@nanairo-sheet/ime` へ差し替えた
//   （glue の cellScalarToDisplay/ime-editing-session は grid 内部＝package 相対で参照＝公開面ではないテスト白箱）。
import { describe, expect, it } from 'vitest';

import { applyOperation, createDocument, displayRowOrder, getCell } from '@nanairo-sheet/core';
import type { DocumentOperation, SetCellsOperation } from '@nanairo-sheet/core';
import { createColumnId, createRowId } from '@nanairo-sheet/types';

import { DEFAULT_GRID_LAYOUT, cellKey } from '@nanairo-sheet/ime';
import type { CellPosition, GridLayout } from '@nanairo-sheet/ime';
import {
  createEditorStateMachine,
  type EditorEvent,
  type Effect,
} from '@nanairo-sheet/ime';
import { cellScalarToDisplay } from '../../../packages/grid/src/document-view';
import {
  createImeEditingSession,
  type EditingDocumentPort,
  type TextareaPort,
} from '../../../packages/grid/src/ime-editing-session';

const A1: CellPosition = { row: 0, col: 0 };

/** getCellValue に既存値を持たせられる machine（既定は空）。 */
function makeMachine(existing: Record<string, string> = {}) {
  return createEditorStateMachine({
    layout: DEFAULT_GRID_LAYOUT,
    initialCell: A1,
    getCellValue: (cell) => existing[cellKey(cell)] ?? '',
  });
}

function types(effects: readonly Effect[]): string[] {
  return effects.map((e) => e.type);
}

/** イベント列を順に dispatch し、各 dispatch が返した Effect をフラットに集める。 */
function run(m: ReturnType<typeof makeMachine>, events: EditorEvent[]): Effect[] {
  const all: Effect[] = [];
  for (const ev of events) {
    all.push(...m.dispatch(ev));
  }
  return all;
}

// 1. composition 中に textarea.value を書き換えない -------------------------------------------
describe('invariant/ime 1: composition 中は draft を破壊しない（value 不書換）', () => {
  it('composition 中の remoteUpdate は draft・composing を保持し UpdateDraft/BeginEdit を出さない（S-F2）', () => {
    const m = makeMachine();
    run(m, [{ type: 'compositionstart' }, { type: 'compositionupdate', data: '日本' }]);
    const effects = m.dispatch({ type: 'remoteUpdate', cell: A1, value: '別値' });
    expect(types(effects)).not.toContain('UpdateDraft');
    expect(types(effects)).not.toContain('BeginEdit');
    expect(effects.find((e) => e.type === 'MarkConflict')).toBeDefined();
    expect(m.getDraft()).toBe('日本');
    expect(m.isComposing()).toBe(true);
  });

  it('composition 中の focus / blur は draft を書き換えず composing を維持（I-5・S-H2/H3）', () => {
    const m = makeMachine();
    run(m, [{ type: 'compositionstart' }, { type: 'compositionupdate', data: 'あ' }]);
    const effects = run(m, [{ type: 'focus' }, { type: 'blur' }]);
    expect(types(effects)).not.toContain('UpdateDraft');
    expect(types(effects)).not.toContain('BeginEdit');
    expect(types(effects)).not.toContain('Commit');
    expect(m.getDraft()).toBe('あ');
    expect(m.isComposing()).toBe(true);
  });
});

// 2. composition 中に selection を破壊しない ---------------------------------------------------
describe('invariant/ime 2: composition 中は selection を破壊しない', () => {
  it('既存値編集からの変換中クリックは BeginEdit(existing) を再発行しない（caret 再設定なし・S-E1）', () => {
    const m = makeMachine({ [cellKey(A1)]: '既存' });
    // F2 で既存値編集 → composition 開始 → 別セルクリック
    run(m, [{ type: 'f2' }, { type: 'compositionstart' }, { type: 'compositionupdate', data: 'ん' }]);
    const effects = m.dispatch({ type: 'pointerdown', target: 'cell', cell: { row: 2, col: 3 } });
    // caret を動かす BeginEdit(existing) を composition 中に出してはならない。
    expect(effects.every((e) => e.type !== 'BeginEdit')).toBe(true);
    // pending navigation を保持するだけ（composition 破壊なし）。
    expect(effects.find((e) => e.type === 'SetPendingNavigation')).toBeDefined();
    expect(m.isComposing()).toBe(true);
  });
});

// 3. textarea instance・DOM 親を置換しない -----------------------------------------------------
describe('invariant/ime 3: 編集セッション（textarea instance）を composition 中に作り直さない', () => {
  it('1 回の入力→確定で BeginEdit は最大 1 回（composition 開始で編集セッションを再構築しない）', () => {
    const m = makeMachine();
    const effects = run(m, [
      { type: 'compositionstart' },
      { type: 'compositionupdate', data: 'に' },
      { type: 'compositionupdate', data: 'にほん' },
      { type: 'compositionend', data: 'にほん' },
      { type: 'input', value: 'にほん', isComposing: false },
    ]);
    // BeginEdit は composition 開始時の 1 回のみ（compositionupdate/end/input で再発行しない）。
    expect(types(effects).filter((t) => t === 'BeginEdit')).toHaveLength(1);
  });
});

// 4. 確定 Enter 順序A・順序B の両方 -----------------------------------------------------------
describe('invariant/ime 4: 確定 Enter 順序A/B（先頭欠落0・確定値一致・二重確定しない）', () => {
  it('順序A（変換中Enter → compositionend → input → keyup → 独立Enter）で確定値一致・先頭欠落0', () => {
    const m = makeMachine();
    // 変換中の確定 Enter（isComposing:true）は抑止（S-D3）。
    const confirm = m.dispatch({ type: 'compositionstart' });
    expect(types(confirm)).toContain('BeginEdit');
    m.dispatch({ type: 'compositionupdate', data: 'あいう' });
    expect(types(m.dispatch({ type: 'keydown', key: 'Enter', isComposing: true }))).toEqual(['SuppressKey']);
    run(m, [
      { type: 'compositionend', data: 'あいう' },
      { type: 'input', value: 'あいう', isComposing: false },
      { type: 'keyup', key: 'Enter', isComposing: false },
    ]);
    // 独立した次の Enter で確定＋下移動（先頭「あ」欠落0・値一致・S-D4）。
    const effects = m.dispatch({ type: 'keydown', key: 'Enter', isComposing: false });
    expect(effects.find((e) => e.type === 'Commit')).toEqual({ type: 'Commit', cell: A1, value: 'あいう' });
    expect(m.getActiveCell()).toEqual({ row: 1, col: 0 });
  });

  it('順序B（compositionend → input → 確定Enter → keyup → 独立Enter）で確定値一致・二重確定しない', () => {
    const m = makeMachine();
    run(m, [
      { type: 'compositionstart' },
      { type: 'compositionupdate', data: 'かな' },
      { type: 'compositionend', data: 'かな' },
      { type: 'input', value: 'かな', isComposing: false },
    ]);
    // compositionend 後の確定 Enter は keyup まで抑止（S-D5・二重確定しない）。
    const suppressed = m.dispatch({ type: 'keydown', key: 'Enter', isComposing: false });
    expect(types(suppressed)).toEqual(['SuppressKey']);
    m.dispatch({ type: 'keyup', key: 'Enter', isComposing: false });
    // 続く独立 Enter で確定＋移動（先頭欠落0・値一致）。
    const effects = m.dispatch({ type: 'keydown', key: 'Enter', isComposing: false });
    expect(effects.find((e) => e.type === 'Commit')).toEqual({ type: 'Commit', cell: A1, value: 'かな' });
    expect(m.getActiveCell()).toEqual({ row: 1, col: 0 });
  });
});

// 5. remote update・rollback/replay 中も draft 不変 --------------------------------------------
describe('invariant/ime 5: remote update / rollback-replay 中も draft 不変', () => {
  it('非 composing 編集中の連続 remoteUpdate（replay 相当）は MarkConflict のみ・draft 上書きしない', () => {
    const m = makeMachine();
    // 直接入力で EditingReplace に入る（composition なし）。
    run(m, [{ type: 'input', value: 'X', isComposing: false }]);
    run(m, [{ type: 'input', value: 'XY', isComposing: false }]);
    expect(m.getDraft()).toBe('XY');
    // remoteUpdate（サーバー適用・rollback/replay 相当）を複数回。
    const e1 = m.dispatch({ type: 'remoteUpdate', cell: A1, value: 'server-1' });
    const e2 = m.dispatch({ type: 'remoteUpdate', cell: A1, value: 'server-2' });
    expect(types(e1)).not.toContain('UpdateDraft');
    expect(types(e2)).not.toContain('UpdateDraft');
    expect(e1.find((e) => e.type === 'MarkConflict')).toBeDefined();
    expect(m.getDraft()).toBe('XY'); // draft は不変
  });

  it('リモート削除（value=null）でも draft を退避保持（S-F3）', () => {
    const m = makeMachine();
    run(m, [{ type: 'compositionstart' }, { type: 'compositionupdate', data: '日本' }]);
    const effects = m.dispatch({ type: 'remoteUpdate', cell: A1, value: null });
    expect(effects.find((e) => e.type === 'MarkConflict')).toBeDefined();
    expect(m.getDraft()).toBe('日本');
    expect(m.isComposing()).toBe(true);
  });
});

// 6. synthetic と実 IME を混同しない ----------------------------------------------------------
describe('invariant/ime 6: synthetic と実 IME を区別する', () => {
  it("keydown key='Process'（IME 由来キー）は状態を変えない（I-2・S-D6）", () => {
    const m = makeMachine();
    run(m, [{ type: 'input', value: 'あ', isComposing: false }]); // EditingReplace
    const effects = m.dispatch({ type: 'keydown', key: 'Process', isComposing: true });
    expect(effects).toHaveLength(0);
    expect(m.getDraft()).toBe('あ');
  });

  it('isComposing:true の Enter は確定操作として抑止・isComposing:false の Enter は通常確定（区別）', () => {
    // 変換中（isComposing:true）の Enter は grid を動かさず抑止する。
    const composing = makeMachine();
    composing.dispatch({ type: 'compositionstart' });
    composing.dispatch({ type: 'compositionupdate', data: 'へ' });
    const suppressed = composing.dispatch({ type: 'keydown', key: 'Enter', isComposing: true });
    expect(types(suppressed)).toEqual(['SuppressKey']);
    expect(composing.isComposing()).toBe(true);

    // 非変換（isComposing:false）の編集中 Enter は確定＋移動。
    const editing = makeMachine();
    run(editing, [{ type: 'input', value: 'A', isComposing: false }]);
    const committed = editing.dispatch({ type: 'keydown', key: 'Enter', isComposing: false });
    expect(committed.find((e) => e.type === 'Commit')).toEqual({ type: 'Commit', cell: A1, value: 'A' });
  });

  it('composition 中は navigation キー（矢印/Tab）で grid が動かない（状態機械仕様維持・AC2）', () => {
    const m = makeMachine();
    run(m, [{ type: 'compositionstart' }, { type: 'compositionupdate', data: 'こ' }]);
    const arrow = m.dispatch({ type: 'keydown', key: 'ArrowDown', isComposing: true });
    const tab = m.dispatch({ type: 'keydown', key: 'Tab', isComposing: true });
    expect(types(arrow)).toEqual(['SuppressKey']);
    expect(types(tab)).toEqual(['SuppressKey']);
    expect(m.getActiveCell()).toEqual(A1); // 動かない
  });
});

// DOM アダプター実駆動（Codex P2 反映）: 状態機械の Effect 数だけでなく、実際の統合セッション
// （createImeEditingSession）＋fake TextareaPort を駆動し、composition 中に textarea の value/selection/
// 配置（instance/parent 相当）を触らないことを port 呼び出し回数で機械検証する（不変条件1/2/3 の DOM 実証）。
const SESSION_LAYOUT: GridLayout = { ...DEFAULT_GRID_LAYOUT, rowCount: 100, columnCount: 3 };

function createFakePort() {
  let value = '';
  const calls = { setValue: 0, setSelectionRange: 0, place: 0, focus: 0 };
  const port: TextareaPort = {
    getValue: () => value,
    setValue: (v) => {
      value = v;
      calls.setValue += 1;
    },
    setSelectionRange: () => {
      calls.setSelectionRange += 1;
    },
    focus: () => {
      calls.focus += 1;
    },
    place: () => {
      calls.place += 1;
    },
    setEditingVisual: () => {},
    setConflict: () => {},
  };
  // browser が composition 中に textarea.value を設定する動作（session 経由ではない）。
  return { port, calls, browserSetValue: (v: string) => (value = v) };
}

const DOC_COLS = [createColumnId('col-0'), createColumnId('col-1'), createColumnId('col-2')];

function createDocPort(ops: DocumentOperation[]) {
  let doc = createDocument(DOC_COLS);
  let revision = 0;
  for (const op of ops) {
    revision += 1;
    doc = applyOperation(doc, op, { revision }).document;
  }
  const port: EditingDocumentPort = {
    getCommittedDocument: () => doc,
    displayText: (rowId, columnId) => cellScalarToDisplay(getCell(doc, rowId, columnId)?.value ?? { kind: 'blank' }),
    rowIdAt: (i) => displayRowOrder(doc)[i],
    colIdAt: (i) => doc.columnOrder[i],
    rowIndexOf: (rowId) => displayRowOrder(doc).indexOf(rowId),
    colIndexOf: (columnId) => doc.columnOrder.indexOf(columnId),
  };
  return port;
}

describe('invariant/ime DOM: 実セッション + fake TextareaPort（composition 中の DOM 不変）', () => {
  const rows: DocumentOperation = {
    type: 'insertRows',
    afterRowId: null,
    rows: [{ rowId: createRowId('r0') }, { rowId: createRowId('r1') }],
  };

  it('composition 中は port.setValue / setSelectionRange を呼ばない（value/selection 不書換・同一 port instance）', () => {
    const fake = createFakePort();
    const submitted: SetCellsOperation[] = [];
    const session = createImeEditingSession({
      document: createDocPort([rows]),
      port: fake.port,
      submit: (op) => submitted.push(op),
      layout: SESSION_LAYOUT,
    });
    session.handleEvent({ type: 'pointerdown', target: 'cell', cell: { row: 0, col: 0 } });
    // compositionstart（replace 開始）以降のベースライン。
    session.handleEvent({ type: 'compositionstart' });
    const baseSetValue = fake.calls.setValue;
    const baseSetSel = fake.calls.setSelectionRange;

    // 変換中: browser が value を書く（session 経由ではない）。session は port へ書いてはならない（I-3）。
    fake.browserSetValue('に');
    session.handleEvent({ type: 'compositionupdate', data: 'に' });
    fake.browserSetValue('日本');
    session.handleEvent({ type: 'compositionupdate', data: '日本' });
    // 変換中の remoteUpdate（同一セル）→ 競合マークのみ。value/selection を触らない。
    session.handleEvent({ type: 'remoteUpdate', cell: { row: 0, col: 0 }, value: '別値' });

    expect(fake.calls.setValue).toBe(baseSetValue); // composition 中に port.setValue を呼んでいない
    expect(fake.calls.setSelectionRange).toBe(baseSetSel); // selection も触っていない
    expect(session.isComposing()).toBe(true);
    expect(session.getDraft()).toBe('日本'); // draft 保持（remoteUpdate は競合マークのみ・port を触らない）
  });

  it('composition なしの確定は port を破壊せず SetCells を submit（セッション健全性・型変換委譲）', () => {
    const fake = createFakePort();
    const submitted: SetCellsOperation[] = [];
    const session = createImeEditingSession({
      document: createDocPort([rows]),
      port: fake.port,
      submit: (op) => submitted.push(op),
      layout: SESSION_LAYOUT,
    });
    session.handleEvent({ type: 'pointerdown', target: 'cell', cell: { row: 0, col: 0 } });
    session.handleEvent({ type: 'input', value: '2026-07-13', isComposing: false });
    session.handleEvent({ type: 'keydown', key: 'Enter', isComposing: false });
    expect(submitted).toHaveLength(1);
    // commit 経路が core parseCellInput へ委譲＝日付は date CellScalar で submit される。
    expect(submitted[0]?.changes[0]?.value).toEqual({ kind: 'date', value: '2026-07-13' });
  });
});
