// range-ops のユニットテスト（DD-020-1 Phase 2）。
// 範囲クリアの生成規約（非空セルのみ・blank 敷き詰め・beforeRevision=committed・上限は範囲セル数で実行前拒否）と、
// 原子性（1 SetCells で全適用 / 1 セルでも stale なら全違反列挙→全体 reject=I-5）を DOM なしで機械検証する。
// AC8: selection-controller の selectedRange と組み合わせた「DD-020-2 引き継ぎ契約」もここで固定する。

import { describe, expect, it } from 'vitest';

import {
  SETCELLS_MAX_CELLS,
  applyOperation,
  createDocument,
  displayRowOrder,
  getCell,
  validateOperation,
} from '@nanairo-sheet/core';
import type { DocumentOperation, SheetDocument } from '@nanairo-sheet/core';
import { createColumnId, createRowId } from '@nanairo-sheet/types';

import { cellScalarToDisplay } from './document-view';
import { buildRangeClear, countRangeCells, type RangeDocumentPort } from './range-ops';
import { createSelectionController } from './selection-controller';

const COLS = [createColumnId('c0'), createColumnId('c1'), createColumnId('c2')];
const R = ['r0', 'r1', 'r2', 'r3'].map((r) => createRowId(r));

/** ops を順に適用した committed 文書を作る（revision は 1 始まりの連番）。 */
function buildDoc(ops: DocumentOperation[]): SheetDocument {
  let doc = createDocument(COLS);
  let revision = 0;
  for (const op of ops) {
    revision += 1;
    doc = applyOperation(doc, op, { revision }).document;
  }
  return doc;
}

const INSERT_ROWS: DocumentOperation = {
  type: 'insertRows',
  afterRowId: null,
  rows: R.map((rowId) => ({ rowId })),
};

/** committed だけを読む素の port（表示値=committed 値。own pending 無し）。 */
function portOf(doc: SheetDocument): RangeDocumentPort {
  return {
    getCommittedDocument: () => doc,
    displayText: (rowId, columnId) =>
      cellScalarToDisplay(getCell(doc, rowId, columnId)?.value ?? { kind: 'blank' }),
    rowIdAt: (i) => displayRowOrder(doc)[i],
    colIdAt: (i) => doc.columnOrder[i],
  };
}

/** r0c0='A'(rev2)・r0c1='B'(rev3)・r2c1='C'(rev4) を持つ committed 文書。 */
function seededDoc(): SheetDocument {
  const set = (row: number, col: number, value: string): DocumentOperation => ({
    type: 'setCells',
    conflictPolicy: 'reject-overlap',
    changes: [{ rowId: R[row], columnId: COLS[col], value: { kind: 'string', value } }],
  });
  return buildDoc([INSERT_ROWS, set(0, 0, 'A'), set(0, 1, 'B'), set(2, 1, 'C')]);
}

describe('countRangeCells: 上限判定の分母（矩形の面積）', () => {
  it('半開区間の面積を返す', () => {
    expect(countRangeCells({ rowStart: 2, rowEnd: 6, colStart: 2, colEnd: 5 })).toBe(12);
    expect(countRangeCells({ rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 1 })).toBe(1);
  });

  it('空/逆転レンジは 0（負にならない）', () => {
    expect(countRangeCells({ rowStart: 3, rowEnd: 3, colStart: 0, colEnd: 5 })).toBe(0);
    expect(countRangeCells({ rowStart: 5, rowEnd: 3, colStart: 2, colEnd: 1 })).toBe(0);
  });
});

describe('buildRangeClear: 生成規約（AC5）', () => {
  it('非空セルのみ changes に含め、value=blank・beforeRevision=committed lastChangedRevision を付ける', () => {
    const doc = seededDoc();
    // 全 4 行 × 3 列 = 12 セルの範囲。非空は r0c0(rev2)・r0c1(rev3)・r2c1(rev4) の 3 つだけ。
    const outcome = buildRangeClear(portOf(doc), { rowStart: 0, rowEnd: 4, colStart: 0, colEnd: 3 });
    expect(outcome.kind).toBe('submit');
    if (outcome.kind !== 'submit') {
      return;
    }
    expect(outcome.cellCount).toBe(12); // 上限判定の分母は範囲セル数（非空数ではない）
    expect(outcome.operation.type).toBe('setCells');
    expect(outcome.operation.conflictPolicy).toBe('reject-overlap');
    expect(outcome.operation.changes).toEqual([
      { rowId: R[0], columnId: COLS[0], beforeRevision: 2, value: { kind: 'blank' } },
      { rowId: R[0], columnId: COLS[1], beforeRevision: 3, value: { kind: 'blank' } },
      { rowId: R[2], columnId: COLS[1], beforeRevision: 4, value: { kind: 'blank' } },
    ]);
  });

  it('範囲内が全て空なら noop（submit しない・blank→blank を書かない）', () => {
    const doc = buildDoc([INSERT_ROWS]);
    expect(buildRangeClear(portOf(doc), { rowStart: 0, rowEnd: 4, colStart: 0, colEnd: 3 })).toEqual({
      kind: 'noop',
    });
  });

  it('表示 Axis の範囲外 index（行/列が消えた後の残存選択）はスキップして生成する', () => {
    const doc = seededDoc();
    // 行 4..9・列 3..4 は存在しない index → スキップ（無効 RowId へ書かない）。存在分だけ生成される。
    const outcome = buildRangeClear(portOf(doc), { rowStart: 0, rowEnd: 10, colStart: 0, colEnd: 5 });
    expect(outcome.kind).toBe('submit');
    if (outcome.kind !== 'submit') {
      return;
    }
    expect(outcome.operation.changes).toHaveLength(3);
  });

  it('own pending で表示のみ非空のセル（committed は blank）も対象に含め beforeRevision=0 を付ける', () => {
    const doc = buildDoc([INSERT_ROWS]);
    const base = portOf(doc);
    const port: RangeDocumentPort = {
      ...base,
      // r1c2 の表示値だけ own pending が載っている想定（committed は未書込）。
      displayText: (rowId, columnId) =>
        rowId === R[1] && columnId === COLS[2] ? '楽観適用中' : base.displayText(rowId, columnId),
    };
    const outcome = buildRangeClear(port, { rowStart: 0, rowEnd: 4, colStart: 0, colEnd: 3 });
    expect(outcome.kind).toBe('submit');
    if (outcome.kind !== 'submit') {
      return;
    }
    // beforeRevision=0（未書込セル規約）。pending が先に確定して revision が進めば全体 reject（OCC 厳格性）。
    expect(outcome.operation.changes).toEqual([
      { rowId: R[1], columnId: COLS[2], beforeRevision: 0, value: { kind: 'blank' } },
    ]);
  });
});

describe('buildRangeClear: 上限（AC6・親①=100,000）', () => {
  it('範囲セル数が上限超過なら too-large（走査せず実行前拒否）', () => {
    const port: RangeDocumentPort = {
      getCommittedDocument: () => {
        throw new Error('上限超過で committed を読んではならない');
      },
      displayText: () => {
        throw new Error('上限超過で走査してはならない');
      },
      rowIdAt: () => undefined,
      colIdAt: () => undefined,
    };
    // 1001 行 × 100 列 = 100,100 > 100,000。
    const outcome = buildRangeClear(port, { rowStart: 0, rowEnd: 1001, colStart: 0, colEnd: 100 });
    expect(outcome).toEqual({ kind: 'too-large', cellCount: 100_100, limit: SETCELLS_MAX_CELLS });
  });

  it('ちょうど上限（100,000）は拒否しない（境界は inclusive）', () => {
    const doc = buildDoc([INSERT_ROWS]);
    const range = { rowStart: 0, rowEnd: 1000, colStart: 0, colEnd: 100 };
    expect(countRangeCells(range)).toBe(SETCELLS_MAX_CELLS);
    // 実在セルは全て空 → noop（too-large にならないことが本ケースの主張）。
    expect(buildRangeClear(portOf(doc), range)).toEqual({ kind: 'noop' });
  });
});

describe('buildRangeClear: 原子性（AC5・I-5）', () => {
  it('生成した SetCells は 1 revision で全セルへ適用される（部分適用なし）', () => {
    const doc = seededDoc();
    const outcome = buildRangeClear(portOf(doc), { rowStart: 0, rowEnd: 4, colStart: 0, colEnd: 3 });
    expect(outcome.kind).toBe('submit');
    if (outcome.kind !== 'submit') {
      return;
    }
    expect(validateOperation(doc, outcome.operation)).toEqual([]); // 競合なし=受理
    const applied = applyOperation(doc, outcome.operation, { revision: 5 }).document;
    for (const [rowId, columnId] of [
      [R[0], COLS[0]],
      [R[0], COLS[1]],
      [R[2], COLS[1]],
    ] as const) {
      const record = getCell(applied, rowId, columnId);
      expect(record?.value).toEqual({ kind: 'blank' });
      expect(record?.lastChangedRevision).toBe(5); // 同一 revision=原子 batch
    }
  });

  it('OCC: 生成後に範囲内 1 セルが先行変更されたら stale-cell-revision（サーバーは全体 reject する=I-5）', () => {
    const doc = seededDoc();
    const outcome = buildRangeClear(portOf(doc), { rowStart: 0, rowEnd: 4, colStart: 0, colEnd: 3 });
    expect(outcome.kind).toBe('submit');
    if (outcome.kind !== 'submit') {
      return;
    }
    // 別クライアントが r0c0 を先に確定（revision 5）→ クリアの beforeRevision(2) が stale になる。
    const advanced = applyOperation(
      doc,
      {
        type: 'setCells',
        conflictPolicy: 'reject-overlap',
        changes: [{ rowId: R[0], columnId: COLS[0], value: { kind: 'string', value: '他者' } }],
      },
      { revision: 5 },
    ).document;
    const violations = validateOperation(advanced, outcome.operation);
    expect(violations).toEqual([
      {
        code: 'stale-cell-revision',
        rowId: R[0],
        columnId: COLS[0],
        currentValue: { kind: 'string', value: '他者' },
        currentRevision: 5,
      },
    ]);
    // 違反が 1 件でもあれば Room は SetCells 全体を reject する（validateSetCells 契約・部分適用しない）。
  });
});

describe('AC8: DD-020-2 引き継ぎ契約（selectedRange × buildRangeClear）', () => {
  it('明示レンジ選択 → selectedRange → buildRangeClear で範囲全体が原子クリアできる', () => {
    const doc = seededDoc();
    const ctrl = createSelectionController();
    ctrl.extendTo({ row: 0, col: 0 }, { row: 1, col: 1 }); // r0..r1 × c0..c1
    const range = ctrl.selectedRange({ row: 0, col: 0 });
    expect(range).toEqual({ rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 2 });
    const outcome = buildRangeClear(portOf(doc), range);
    expect(outcome.kind).toBe('submit');
    if (outcome.kind !== 'submit') {
      return;
    }
    // 範囲内の非空は r0c0・r0c1 の 2 つ（r2c1 は rowEnd=2 の外）。
    expect(outcome.operation.changes.map((c) => [String(c.rowId), String(c.columnId)])).toEqual([
      ['r0', 'c0'],
      ['r0', 'c1'],
    ]);
    const applied = applyOperation(doc, outcome.operation, { revision: 5 }).document;
    expect(getCell(applied, R[0], COLS[0])?.value).toEqual({ kind: 'blank' });
    expect(getCell(applied, R[0], COLS[1])?.value).toEqual({ kind: 'blank' });
    expect(getCell(applied, R[2], COLS[1])?.value).toEqual({ kind: 'string', value: 'C' }); // 範囲外は不変
  });

  it('明示レンジが無ければ selectedRange は activeCell の 1×1（単一セル copy/cut/paste の対象契約）', () => {
    const doc = seededDoc();
    const ctrl = createSelectionController();
    const range = ctrl.selectedRange({ row: 0, col: 1 });
    expect(range).toEqual({ rowStart: 0, rowEnd: 1, colStart: 1, colEnd: 2 });
    const outcome = buildRangeClear(portOf(doc), range);
    expect(outcome.kind).toBe('submit');
    if (outcome.kind !== 'submit') {
      return;
    }
    expect(outcome.operation.changes).toEqual([
      { rowId: R[0], columnId: COLS[1], beforeRevision: 3, value: { kind: 'blank' } },
    ]);
  });
});
