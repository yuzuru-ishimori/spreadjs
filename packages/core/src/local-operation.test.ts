// ローカル Operation（サーバー接続なし）+ documentHash 決定性（DD-012-1 AC5・AC4）。
//
// 確定入力列 → parseCellInput → SetCells → ローカル文書へ applyOperation（サーバー不要）。
// 同一入力列は同一 documentHash になる（cross-platform 収束の基盤）。date 拡張後も hash 決定的で、
// date と string は同一文字列でも hash が分岐する（正準性）。JSON 往復で date CellScalar が保存される。
import { describe, expect, it } from 'vitest';

import { applyOperation } from './apply';
import { parseCellInput } from './cell-input';
import { createDocument, getCell } from './document';
import type { SheetDocument } from './document';
import { documentHash } from './hash';
import type { CellScalar, SetCellsOperation } from './operations';

import { createColumnId, createRowId } from '@nanairo-sheet/types';

const COL = createColumnId('c0');

/** 空文書に n 行を挿入し、col c0 のみ持つローカル文書を作る（サーバー接続なし）。 */
function buildDoc(rowCount: number): SheetDocument {
  let doc = createDocument([COL]);
  const rows = Array.from({ length: rowCount }, (_, i) => ({ rowId: createRowId(`r${i}`) }));
  doc = applyOperation(doc, { type: 'insertRows', afterRowId: null, rows }, { revision: 1 }).document;
  return doc;
}

/** 入力列を確定→parse→SetCells でローカル適用し、適用後文書を返す（決定的 revision）。 */
function applyInputs(inputs: string[]): SheetDocument {
  let doc = buildDoc(inputs.length);
  inputs.forEach((text, i) => {
    const op: SetCellsOperation = {
      type: 'setCells',
      conflictPolicy: 'reject-overlap',
      changes: [{ rowId: createRowId(`r${i}`), columnId: COL, value: parseCellInput(text) }],
    };
    doc = applyOperation(doc, op, { revision: 2 + i }).document;
  });
  return doc;
}

describe('ローカル Operation + hash 決定性', () => {
  const inputs = ['あいう', '123', '１２３', '1,234.5', '-5', '2026-07-13', 'ABC-123'];

  it('サーバー接続なしで SetCells がローカル文書へ適用され値が確定する', () => {
    const doc = applyInputs(inputs);
    expect(getCell(doc, createRowId('r0'), COL)?.value).toEqual({ kind: 'string', value: 'あいう' });
    expect(getCell(doc, createRowId('r1'), COL)?.value).toEqual({ kind: 'number', value: 123 });
    expect(getCell(doc, createRowId('r2'), COL)?.value).toEqual({ kind: 'number', value: 123 });
    expect(getCell(doc, createRowId('r3'), COL)?.value).toEqual({ kind: 'number', value: 1234.5 });
    expect(getCell(doc, createRowId('r5'), COL)?.value).toEqual({ kind: 'date', value: '2026-07-13' });
    expect(getCell(doc, createRowId('r6'), COL)?.value).toEqual({ kind: 'string', value: 'ABC-123' });
  });

  it('同一入力列は同一 documentHash（決定的）', () => {
    const h1 = documentHash(applyInputs(inputs));
    const h2 = documentHash(applyInputs(inputs));
    expect(h1).toBe(h2);
  });

  it('date と string は同一文字列でも hash が分岐する（正準性）', () => {
    const asDate = applyInputs(['2026-07-13']);
    const forceString: SheetDocument = (() => {
      let doc = buildDoc(1);
      const value: CellScalar = { kind: 'string', value: '2026-07-13' };
      doc = applyOperation(
        doc,
        { type: 'setCells', conflictPolicy: 'reject-overlap', changes: [{ rowId: createRowId('r0'), columnId: COL, value }] },
        { revision: 2 },
      ).document;
      return doc;
    })();
    expect(documentHash(asDate)).not.toBe(documentHash(forceString));
  });

  it('date CellScalar は JSON 往復で保存される（encode/decode 一致）', () => {
    const value: CellScalar = { kind: 'date', value: '2026-07-13' };
    const roundTrip = JSON.parse(JSON.stringify(value)) as CellScalar;
    expect(roundTrip).toEqual(value);
  });
});
