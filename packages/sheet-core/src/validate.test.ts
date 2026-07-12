import { describe, expect, it } from 'vitest';

import { createColumnId, createRowId } from '@nanairo-sheet/sheet-types';
import type { ColumnId, RowId } from '@nanairo-sheet/sheet-types';

import { applyOperation } from './apply';
import { createDocument } from './document';
import type { SheetDocument } from './document';
import type {
  CellScalar,
  DeleteRowsOperation,
  DocumentOperation,
  InsertRowsOperation,
  SetCellsOperation,
} from './operations';
import { validateOperation } from './validate';

const col = (value: string): ColumnId => createColumnId(value);
const row = (value: string): RowId => createRowId(value);
const str = (value: string): CellScalar => ({ kind: 'string', value });

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

function baseDoc(rowIds: string[], cols: string[] = ['col-a', 'col-b']): SheetDocument {
  let doc = createDocument(cols.map(col));
  let previous: RowId | null = null;
  let revision = 0;
  for (const rowId of rowIds) {
    revision += 1;
    doc = applyOperation(doc, insertRows(previous, [rowId]), { revision }).document;
    previous = row(rowId);
  }
  return doc;
}

// col-a に値を書いて lastChangedRevision を rev にする（stale 検査の前提づくり）。
function withCell(doc: SheetDocument, rowId: string, columnId: string, value: string, revision: number): SheetDocument {
  return applyOperation(
    doc,
    setCells([{ rowId: row(rowId), columnId: col(columnId), value: str(value) }]),
    { revision },
  ).document;
}

describe('validateOperation — 共有バリデーター（構造 3 種）', () => {
  it('妥当な SetCells は違反なし（[]）', () => {
    const doc = baseDoc(['row-1']);
    expect(validateOperation(doc, setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('x') }]))).toEqual([]);
  });

  it('未知 rowId への SetCells → unknown-row', () => {
    const doc = baseDoc(['row-1']);
    expect(
      validateOperation(doc, setCells([{ rowId: row('row-x'), columnId: col('col-a'), value: str('x') }])),
    ).toEqual([{ code: 'unknown-row', rowId: row('row-x') }]);
  });

  it('tombstone 行への SetCells → target-row-deleted', () => {
    let doc = baseDoc(['row-1', 'row-2']);
    doc = applyOperation(doc, deleteRows([row('row-1')]), { revision: 3 }).document;
    expect(
      validateOperation(doc, setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('x') }])),
    ).toEqual([{ code: 'target-row-deleted', rowId: row('row-1') }]);
  });

  it('columnOrder 外の列への SetCells → unknown-column（validate===[] ⇒ apply 非 throw 契約の保持・DD-010 Codex[P1]）', () => {
    const doc = baseDoc(['row-1']); // columnOrder=[col-a,col-b]
    expect(
      validateOperation(doc, setCells([{ rowId: row('row-1'), columnId: col('col-z'), value: str('x') }])),
    ).toEqual([{ code: 'unknown-column', rowId: row('row-1'), columnId: col('col-z') }]);
  });

  it('未知アンカーへの InsertRows → unknown-anchor（null 先頭挿入は違反なし）', () => {
    const doc = baseDoc(['row-1']);
    expect(validateOperation(doc, insertRows(row('row-never'), ['row-new']))).toEqual([
      { code: 'unknown-anchor', afterRowId: row('row-never') },
    ]);
    expect(validateOperation(doc, insertRows(null, ['row-new']))).toEqual([]);
  });

  it('tombstone 済み既知アンカーは有効（違反なし・S-D2）', () => {
    let doc = baseDoc(['row-1', 'row-2']);
    doc = applyOperation(doc, deleteRows([row('row-1')]), { revision: 3 }).document;
    expect(validateOperation(doc, insertRows(row('row-1'), ['row-new']))).toEqual([]);
  });

  it('DeleteRows は常に違反なし（再 Delete 冪等・S-E2/E3）', () => {
    let doc = baseDoc(['row-1']);
    doc = applyOperation(doc, deleteRows([row('row-1')]), { revision: 2 }).document;
    expect(validateOperation(doc, deleteRows([row('row-1'), row('row-x')]))).toEqual([]);
  });
});

describe('validateOperation — stale-cell-revision（S-C2 相当・サーバー/クライアント共有判定）', () => {
  it('beforeRevision が現在セル revision と一致 → 違反なし', () => {
    let doc = baseDoc(['row-1']);
    doc = withCell(doc, 'row-1', 'col-a', 'v', 20); // (row-1,col-a).lastChangedRevision=20
    expect(
      validateOperation(doc, setCells([{ rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 20, value: str('mine') }])),
    ).toEqual([]);
  });

  it('beforeRevision が古い → stale-cell-revision（現在値・現在 revision を同梱・§10.2）', () => {
    let doc = baseDoc(['row-1']);
    doc = withCell(doc, 'row-1', 'col-a', 'server', 20);
    const violations = validateOperation(
      doc,
      setCells([{ rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 15, value: str('mine') }]),
    );
    expect(violations).toEqual([
      {
        code: 'stale-cell-revision',
        rowId: row('row-1'),
        columnId: col('col-a'),
        currentValue: str('server'),
        currentRevision: 20,
      },
    ]);
  });

  it('未書込セルは現在 revision=0 とみなす（beforeRevision:0 は一致・undefined は検査せず）', () => {
    const doc = baseDoc(['row-1']);
    expect(
      validateOperation(doc, setCells([{ rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 0, value: str('x') }])),
    ).toEqual([]);
    expect(
      validateOperation(doc, setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('x') }])),
    ).toEqual([]); // beforeRevision 未指定 → stale 検査スキップ
    // 未書込セルに beforeRevision:99 → 現在 0 と不一致で stale
    const violations = validateOperation(
      doc,
      setCells([{ rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 99, value: str('x') }]),
    );
    expect(violations[0]).toMatchObject({ code: 'stale-cell-revision', currentRevision: 0, currentValue: undefined });
  });

  it('SetCells は全違反を列挙（原子性 reject の details 用・混在も配列順で保持）', () => {
    let doc = baseDoc(['row-1', 'row-2']);
    doc = withCell(doc, 'row-1', 'col-a', 'server', 20);
    doc = applyOperation(doc, deleteRows([row('row-2')]), { revision: 21 }).document;
    const violations = validateOperation(
      doc,
      setCells([
        { rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 15, value: str('a') }, // stale
        { rowId: row('row-2'), columnId: col('col-a'), value: str('b') }, // target-row-deleted
        { rowId: row('row-x'), columnId: col('col-a'), value: str('c') }, // unknown-row
      ]),
    );
    expect(violations.map((v) => v.code)).toEqual([
      'stale-cell-revision',
      'target-row-deleted',
      'unknown-row',
    ]);
  });
});

describe('validateOperation — duplicate-row（指示 3・S-D6・DA D11 の Room 境界担保）', () => {
  it('既存行と重複する rowId の InsertRows → duplicate-row', () => {
    const doc = baseDoc(['row-1', 'row-2']);
    expect(validateOperation(doc, insertRows(row('row-1'), ['row-2']))).toEqual([
      { code: 'duplicate-row', rowId: row('row-2') },
    ]);
  });

  it('Operation 内で重複する rowId の InsertRows → duplicate-row（2 件目を違反に）', () => {
    const doc = baseDoc(['row-1']);
    expect(validateOperation(doc, insertRows(row('row-1'), ['row-dup', 'row-dup']))).toEqual([
      { code: 'duplicate-row', rowId: row('row-dup') },
    ]);
  });

  it('新規かつ一意な rowId は違反なし', () => {
    const doc = baseDoc(['row-1']);
    expect(validateOperation(doc, insertRows(row('row-1'), ['row-a', 'row-b']))).toEqual([]);
  });
});

describe('validateOperation — apply との契約（[] ⇒ apply は throw しない）', () => {
  const ops: DocumentOperation[] = [
    setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('x') }]),
    insertRows(row('row-1'), ['row-new']),
    deleteRows([row('row-1')]),
  ];
  it('検証を通過した Operation は apply が例外を投げない', () => {
    let doc = baseDoc(['row-1']);
    for (const op of ops) {
      expect(validateOperation(doc, op)).toEqual([]);
      // 検証 OK なら apply は throw しない（revision は仮値）
      doc = applyOperation(doc, op, { revision: doc.revision + 1 }).document;
    }
  });
});
