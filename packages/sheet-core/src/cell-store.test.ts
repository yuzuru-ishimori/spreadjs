import { describe, expect, it } from 'vitest';

import { createColumnId, createRowId } from '@nanairo-sheet/sheet-types';
import type { ColumnId, RowId } from '@nanairo-sheet/sheet-types';

import { applyOperation } from './apply';
import { createCellStore } from './cell-store';
import { createDocument, getCell, isTombstoned } from './document';
import type { CellRecord, SheetDocument } from './document';
import type {
  CellScalar,
  DeleteRowsOperation,
  DocumentOperation,
  InsertRowsOperation,
  SetCellsOperation,
} from './operations';

const col = (value: string): ColumnId => createColumnId(value);
const row = (value: string): RowId => createRowId(value);
const str = (value: string): CellScalar => ({ kind: 'string', value });
const rec = (value: string, revision = 1): CellRecord => ({ value: str(value), lastChangedRevision: revision });

const setCells = (changes: SetCellsOperation['changes']): SetCellsOperation => ({
  type: 'setCells',
  changes,
  conflictPolicy: 'reject-overlap',
});
const insertRows = (afterRowId: RowId | null, rowIds: string[]): InsertRowsOperation => ({
  type: 'insertRows',
  afterRowId,
  rows: rowIds.map((r) => ({ rowId: createRowId(r) })),
});
const deleteRows = (rowIds: RowId[]): DeleteRowsOperation => ({ type: 'deleteRows', rowIds });

function applyAll(doc: SheetDocument, ops: DocumentOperation[]): SheetDocument {
  let current = doc;
  let revision = doc.revision;
  for (const op of ops) {
    revision += 1;
    current = applyOperation(current, op, { revision }).document;
  }
  return current;
}

// ---- store 単体（slot/colIndex キー・AC1）----

describe('CellStore（slot/colIndex キー・DD-010 A案）— 単体', () => {
  it('set/get: 保存した CellRecord をそのまま返す・未設定は undefined', () => {
    const store = createCellStore();
    store.set(0, 1, rec('x'));
    expect(store.get(0, 1)).toEqual(rec('x'));
    expect(store.get(0, 0)).toBeUndefined();
    expect(store.get(5, 1)).toBeUndefined(); // 未使用 slot
  });

  it('blank レコードも保持する（二段 Map と等価・hash 側で blank をスキップ）', () => {
    const store = createCellStore();
    store.set(0, 0, { value: { kind: 'blank' }, lastChangedRevision: 3 });
    expect(store.get(0, 0)).toEqual({ value: { kind: 'blank' }, lastChangedRevision: 3 });
    expect(store.nonEmptyCount()).toBe(1); // 保持レコード総数（blank 含む）
  });

  it('同一 (slot,colIndex) の再 set は上書き（件数は増えない）', () => {
    const store = createCellStore();
    store.set(0, 0, rec('a'));
    store.set(0, 0, rec('b', 2));
    expect(store.get(0, 0)).toEqual(rec('b', 2));
    expect(store.nonEmptyCount()).toBe(1);
  });

  it('forEachInRow: colIndex 昇順で列挙する（挿入順に依らない＝二分探索で整列保持）', () => {
    const store = createCellStore();
    store.set(0, 5, rec('f'));
    store.set(0, 1, rec('b'));
    store.set(0, 3, rec('d'));
    const seen: Array<[number, string]> = [];
    store.forEachInRow(0, (colIndex, record) => {
      seen.push([colIndex, record.value.kind === 'string' ? record.value.value : '?']);
    });
    expect(seen).toEqual([
      [1, 'b'],
      [3, 'd'],
      [5, 'f'],
    ]);
  });

  it('delete: 該当セルのみ除去・件数減・他セルは不動', () => {
    const store = createCellStore();
    store.set(0, 0, rec('a'));
    store.set(0, 1, rec('b'));
    store.delete(0, 0);
    expect(store.get(0, 0)).toBeUndefined();
    expect(store.get(0, 1)).toEqual(rec('b'));
    expect(store.nonEmptyCount()).toBe(1);
  });

  it('deleteRow: 行のセルを丸ごと除去・hasRow が false へ・他 slot は不動', () => {
    const store = createCellStore();
    store.set(0, 0, rec('a'));
    store.set(0, 1, rec('b'));
    store.set(1, 0, rec('c'));
    store.deleteRow(0);
    expect(store.hasRow(0)).toBe(false);
    expect(store.get(0, 0)).toBeUndefined();
    expect(store.get(1, 0)).toEqual(rec('c'));
    expect(store.nonEmptyCount()).toBe(1);
  });

  it('clone: CellRecord/CellScalar まで別オブジェクト（clone の変更が原本へ波及しない）', () => {
    const store = createCellStore();
    store.set(0, 0, rec('a'));
    const copy = store.clone();
    const origRec = store.get(0, 0)!;
    const copyRec = copy.get(0, 0)!;
    expect(copyRec).not.toBe(origRec);
    expect(copyRec.value).not.toBe(origRec.value);
    copy.set(0, 0, rec('MUTATED', 99));
    copy.set(0, 1, rec('new'));
    expect(store.get(0, 0)).toEqual(rec('a')); // 原本不変
    expect(store.get(0, 1)).toBeUndefined();
  });

  it('チャンク境界（既定 256 slot）を跨いでも正しく格納・取得する', () => {
    const store = createCellStore();
    store.set(255, 0, rec('end-of-chunk0'));
    store.set(256, 0, rec('start-of-chunk1'));
    store.set(512, 7, rec('chunk2'));
    expect(store.get(255, 0)).toEqual(rec('end-of-chunk0'));
    expect(store.get(256, 0)).toEqual(rec('start-of-chunk1'));
    expect(store.get(512, 7)).toEqual(rec('chunk2'));
    expect(store.nonEmptyCount()).toBe(3);
  });

  it('境界/防御: 負 colIndex は get=undefined・set/非整数は throw（サイレント破損を防ぐ・CG-2）', () => {
    const store = createCellStore();
    expect(store.get(0, -1)).toBeUndefined();
    expect(() => store.set(0, -1, rec('x'))).toThrow();
    expect(() => store.set(-1, 0, rec('x'))).toThrow();
    expect(() => store.set(0.5, 0, rec('x'))).toThrow();
    expect(() => createCellStore({ chunkRows: 0 })).toThrow();
  });
});

// ---- 文書レベル: RowId 追従・index ずれ 0（AC1 の核）----

describe('安定 ID: セル値が RowId に追従（index ずれ 0）— AC1', () => {
  const cols = [col('col-a'), col('col-b')];

  it('先頭への InsertRows を繰り返しても既存行のセル値が保たれる（index 方式なら壊れるケース）', () => {
    // row-1 にセルを置き、その「前」へ次々挿入する。index キーなら row-1 のセルが新しい行へずれる。
    let doc = applyAll(createDocument(cols), [
      insertRows(null, ['row-1']),
      setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('KEEP') }]),
    ]);
    for (let i = 0; i < 10; i += 1) {
      doc = applyOperation(doc, insertRows(null, [`ins-${i}`]), { revision: doc.revision + 1 }).document;
      // 毎回、row-1 のセルは不動であること（RowId 追従）。
      expect(getCell(doc, row('row-1'), col('col-a'))).toEqual({ value: str('KEEP'), lastChangedRevision: 2 });
      // 新規挿入行はセルを持たない（他行のデータを奪っていない）。
      expect(getCell(doc, row(`ins-${i}`), col('col-a'))).toBeUndefined();
    }
  });

  it('DeleteRows（tombstone）後もセルは slot に保全され、生存行のセルは無傷', () => {
    let doc = applyAll(createDocument(cols), [
      insertRows(null, ['row-1']),
      insertRows(row('row-1'), ['row-2']),
      setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('one') }]),
      setCells([{ rowId: row('row-2'), columnId: col('col-a'), value: str('two') }]),
    ]);
    doc = applyOperation(doc, deleteRows([row('row-1')]), { revision: doc.revision + 1 }).document;
    expect(isTombstoned(doc, row('row-1'))).toBe(true);
    // tombstone 行のセルは slot に保全（round-trip・rollback の前提）。
    expect(getCell(doc, row('row-1'), col('col-a'))).toEqual({ value: str('one'), lastChangedRevision: 3 });
    // 生存行のセルは無傷（削除が隣接データを壊さない）。
    expect(getCell(doc, row('row-2'), col('col-a'))).toEqual({ value: str('two'), lastChangedRevision: 4 });
  });

  it('削除済みアンカーへの InsertRows でも既存セルが RowId に追従する（S-D2 波及）', () => {
    let doc = applyAll(createDocument(cols), [
      insertRows(null, ['row-1']),
      insertRows(row('row-1'), ['row-2']),
      insertRows(row('row-2'), ['row-3']),
      setCells([{ rowId: row('row-3'), columnId: col('col-b'), value: str('tail') }]),
    ]);
    doc = applyOperation(doc, deleteRows([row('row-2')]), { revision: doc.revision + 1 }).document;
    // tombstone 済み row-2 をアンカーに新行を挿入。
    doc = applyOperation(doc, insertRows(row('row-2'), ['row-new']), { revision: doc.revision + 1 }).document;
    expect(doc.rowOrder.map(String)).toEqual(['row-1', 'row-2', 'row-new', 'row-3']);
    // row-3 のセルは挿入で一切ずれない。
    expect(getCell(doc, row('row-3'), col('col-b'))).toEqual({ value: str('tail'), lastChangedRevision: 4 });
    expect(getCell(doc, row('row-new'), col('col-b'))).toBeUndefined();
  });
});
