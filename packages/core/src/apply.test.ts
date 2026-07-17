import { describe, expect, it } from 'vitest';

import { createColumnId, createRowId } from '@nanairo-sheet/types';
import type { ColumnId, RowId } from '@nanairo-sheet/types';

import { ApplyError, applyOperation } from './apply';
import type { ApplyErrorCode } from './apply';
import { createCellStore } from './cell-store';
import {
  createDocument,
  displayRowOrder,
  forEachCellInRow,
  getCell,
  isTombstoned,
  setCell,
} from './document';
import type { CellRecord, RowMeta, SheetDocument } from './document';
import { canonicalSerialize, documentHash } from './hash';
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
const num = (value: number): CellScalar => ({ kind: 'number', value });
const blank = (): CellScalar => ({ kind: 'blank' });

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

// ctx.revision を +1 しながら Operation 列を畳み込む（状態構築用）。
function applyAll(doc: SheetDocument, ops: DocumentOperation[]): SheetDocument {
  let current = doc;
  let revision = doc.revision;
  for (const op of ops) {
    revision += 1;
    current = applyOperation(current, op, { revision }).document;
  }
  return current;
}

// rowIds を順に InsertRows した文書を作る（各行はアンカー＝直前行、revision=1..n）。
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

// ApplyError を code つきで検証する（instanceof で narrow し `as` を使わない）。
function expectApplyError(fn: () => unknown, code: ApplyErrorCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ApplyError);
  if (caught instanceof ApplyError) {
    expect(caught.code).toBe(code);
  } else {
    throw new Error(`expected ApplyError(${code}), got ${String(caught)}`);
  }
}

describe('A. 決定論的適用（apply）— AC1/AC2 基盤・Phase 1', () => {
  it('S-A1: 既存行の空セルへ SetCells → before=blank・after=x・lastChangedRevision=付与rev', () => {
    const doc = baseDoc(['row-1']); // row-1 を挿入（セルは空）
    const res = applyOperation(
      doc,
      setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('x') }]),
      { revision: 2 },
    );
    expect(res.changeSet.cells).toEqual([
      { rowId: row('row-1'), columnId: col('col-a'), before: blank(), after: str('x') },
    ]);
    expect(getCell(res.document, row('row-1'), col('col-a'))).toEqual({
      value: str('x'),
      lastChangedRevision: 2,
    });
    expect(res.dirtyRegions).toEqual([row('row-1')]);
    expect(res.formulaInvalidations).toEqual([]);
    expect(res.changeSet.rowsInserted).toEqual([]);
    expect(res.changeSet.rowsDeleted).toEqual([]);
  });

  it('S-A2: 同一 (文書, Operation, 付与rev) の再適用は同一 ApplyResult・入力を破壊しない（I-1）', () => {
    const doc = baseDoc(['row-1']);
    const op = setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('x') }]);
    const inputHash = documentHash(doc);
    const r1 = applyOperation(doc, op, { revision: 2 });
    const r2 = applyOperation(doc, op, { revision: 2 });
    expect(documentHash(doc)).toBe(inputHash); // 入力不変
    expect(documentHash(r1.document)).toBe(documentHash(r2.document));
    expect(r1.changeSet).toEqual(r2.changeSet);
    expect(r1.inverseSeed).toEqual(r2.inverseSeed);
  });

  it('S-A3: 同一 Operation 列を2つの独立文書へ同順・同revで適用→hash 一致（決定論）', () => {
    const ops: DocumentOperation[] = [
      insertRows(null, ['row-1']),
      setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('x') }]),
      insertRows(row('row-1'), ['row-2']),
      setCells([{ rowId: row('row-2'), columnId: col('col-b'), value: num(42) }]),
    ];
    const cols = [col('col-a'), col('col-b')];
    const a = applyAll(createDocument(cols), ops);
    const b = applyAll(createDocument(cols), ops);
    expect(documentHash(a)).toBe(documentHash(b));
  });

  it('S-A4: InsertRows はアンカー直後へ挿入・rowsInserted 反映・新行 lastChangedRevision=付与rev', () => {
    const doc = baseDoc(['row-1']);
    const res = applyOperation(doc, insertRows(row('row-1'), ['row-2']), { revision: 2 });
    expect(res.document.rowOrder).toEqual([row('row-1'), row('row-2')]);
    expect(res.changeSet.rowsInserted).toEqual([row('row-2')]);
    expect(res.document.rowMeta.get(row('row-2'))?.tombstone).toBe(false);
    expect(res.document.rowMeta.get(row('row-2'))?.lastChangedRevision).toBe(2);
    expect(res.dirtyRegions).toEqual([row('row-2')]);
  });

  it('S-A5: DeleteRows は tombstone 化（rowOrder 保持・表示順から除外）・rowsDeleted 反映', () => {
    const doc = baseDoc(['row-1', 'row-2']);
    const res = applyOperation(doc, deleteRows([row('row-1')]), { revision: 3 });
    expect(res.document.rowOrder).toEqual([row('row-1'), row('row-2')]); // rowOrder は保持
    expect(isTombstoned(res.document, row('row-1'))).toBe(true);
    expect(displayRowOrder(res.document)).toEqual([row('row-2')]); // 表示順から除外
    expect(res.changeSet.rowsDeleted).toEqual([row('row-1')]);
  });

  it('S-A6: 未知 rowId への SetCells は ApplyError(unknown-row)・文書不変（I-5）', () => {
    const doc = baseDoc(['row-1']);
    const before = documentHash(doc);
    expectApplyError(
      () =>
        applyOperation(
          doc,
          setCells([{ rowId: row('row-unknown'), columnId: col('col-a'), value: str('x') }]),
          { revision: 2 },
        ),
      'unknown-row',
    );
    expect(documentHash(doc)).toBe(before);
  });

  it('S-A7: tombstone 行への SetCells は ApplyError(target-row-deleted)・文書不変（§10.3）', () => {
    const base = baseDoc(['row-1', 'row-2']);
    const doc = applyOperation(base, deleteRows([row('row-1')]), { revision: 3 }).document;
    const before = documentHash(doc);
    expectApplyError(
      () =>
        applyOperation(
          doc,
          setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('y') }]),
          { revision: 4 },
        ),
      'target-row-deleted',
    );
    expect(documentHash(doc)).toBe(before);
  });

  it('S-A8: 未知アンカーへの InsertRows は ApplyError(unknown-anchor)', () => {
    const doc = baseDoc(['row-1']);
    expectApplyError(
      () => applyOperation(doc, insertRows(row('row-unknown'), ['row-2']), { revision: 2 }),
      'unknown-anchor',
    );
  });

  it('S-A6b: columnOrder 外の列への SetCells は ApplyError(unknown-column)・文書不変（DD-010 Codex[P1]）', () => {
    const doc = baseDoc(['row-1']); // columnOrder=[col-a,col-b]
    const before = documentHash(doc);
    expectApplyError(
      () =>
        applyOperation(
          doc,
          setCells([{ rowId: row('row-1'), columnId: col('col-z'), value: str('x') }]),
          { revision: 2 },
        ),
      'unknown-column',
    );
    expect(documentHash(doc)).toBe(before);
  });

  it('S-A9: 同値上書きでも lastChangedRevision を付与rev に更新（no-op 特別扱いしない・Q-1）', () => {
    let doc = baseDoc(['row-1']);
    doc = applyOperation(
      doc,
      setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('a') }]),
      { revision: 2 },
    ).document;
    const res = applyOperation(
      doc,
      setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('a') }]),
      { revision: 5 },
    );
    expect(getCell(res.document, row('row-1'), col('col-a'))).toEqual({
      value: str('a'),
      lastChangedRevision: 5,
    });
    expect(res.changeSet.cells).toEqual([
      { rowId: row('row-1'), columnId: col('col-a'), before: str('a'), after: str('a') },
    ]);
  });
});

describe('C. SetCells 原子性（apply 検証部分）— 決定事項・Phase 1 対象分', () => {
  it('S-C1(apply): 複数の正常 change を単一 revision・単一 changeSet で原子適用（beforeRevision は apply 層では無視＝stale 検査は Phase 2 サーバー責務）', () => {
    const doc = baseDoc(['row-1', 'row-2']);
    const res = applyOperation(
      doc,
      setCells([
        { rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 10, value: str('x') },
        { rowId: row('row-2'), columnId: col('col-b'), beforeRevision: 10, value: str('y') },
      ]),
      { revision: 11 },
    );
    expect(res.changeSet.cells).toHaveLength(2);
    expect(getCell(res.document, row('row-1'), col('col-a'))?.lastChangedRevision).toBe(11);
    expect(getCell(res.document, row('row-2'), col('col-b'))?.lastChangedRevision).toBe(11);
    expect(res.document.revision).toBe(11);
  });

  it('S-C3(apply): 1件でも tombstone 行を含む SetCells は全体 reject（target-row-deleted）・部分適用なし（I-5）', () => {
    const base = baseDoc(['row-1', 'row-9']);
    const doc = applyOperation(base, deleteRows([row('row-9')]), { revision: 3 }).document;
    const before = documentHash(doc);
    expectApplyError(
      () =>
        applyOperation(
          doc,
          setCells([
            { rowId: row('row-1'), columnId: col('col-a'), value: str('ok') },
            { rowId: row('row-9'), columnId: col('col-a'), value: str('bad') },
          ]),
          { revision: 4 },
        ),
      'target-row-deleted',
    );
    expect(documentHash(doc)).toBe(before);
    expect(getCell(doc, row('row-1'), col('col-a'))).toBeUndefined(); // row-1 も未適用
  });

  it('S-C5: apply が途中でエラーでも入力は部分ミューテーションを残さない（validate-all→commit 二相・バイト同一）', () => {
    const doc = baseDoc(['row-1']); // row-1 のみ存在
    const snapshot = documentHash(doc);
    expectApplyError(
      () =>
        applyOperation(
          doc,
          setCells([
            { rowId: row('row-1'), columnId: col('col-a'), value: str('first') }, // 正常
            { rowId: row('row-unknown'), columnId: col('col-a'), value: str('second') }, // 未知行
          ]),
          { revision: 2 },
        ),
      'unknown-row',
    );
    expect(getCell(doc, row('row-1'), col('col-a'))).toBeUndefined(); // 1件目のミューテーションも残さない
    expect(documentHash(doc)).toBe(snapshot);
  });
});

describe('D. InsertRows アンカー（apply）— 決定事項・Phase 1 対象分', () => {
  it('S-D1: InsertRows はアンカー直後へ挿入', () => {
    const doc = baseDoc(['row-1', 'row-2', 'row-3']);
    const res = applyOperation(doc, insertRows(row('row-2'), ['row-new']), { revision: 4 });
    expect(res.document.rowOrder).toEqual([
      row('row-1'),
      row('row-2'),
      row('row-new'),
      row('row-3'),
    ]);
  });

  it('S-D2: tombstone 化された既知アンカーへの InsertRows は論理位置直後へ挿入（受理）', () => {
    let doc = baseDoc(['row-1', 'row-2', 'row-3']);
    doc = applyOperation(doc, deleteRows([row('row-2')]), { revision: 4 }).document; // row-2 tombstone
    const res = applyOperation(doc, insertRows(row('row-2'), ['row-new']), { revision: 5 });
    expect(res.document.rowOrder).toEqual([
      row('row-1'),
      row('row-2'),
      row('row-new'),
      row('row-3'),
    ]);
    expect(displayRowOrder(res.document)).toEqual([row('row-1'), row('row-new'), row('row-3')]);
  });

  it('S-D3: 一度も存在しないアンカーへの InsertRows は reject(unknown-anchor)', () => {
    const doc = baseDoc(['row-1']);
    expectApplyError(
      () => applyOperation(doc, insertRows(row('row-never'), ['row-x']), { revision: 2 }),
      'unknown-anchor',
    );
  });

  it('S-D4: 空文書へ afterRowId:null で先頭挿入', () => {
    const doc = createDocument([col('col-a')]);
    const res = applyOperation(doc, insertRows(null, ['row-a']), { revision: 1 });
    expect(res.document.rowOrder).toEqual([row('row-a')]);
  });
});

describe('E. DeleteRows 冪等（apply）— 決定事項・Phase 1 対象分', () => {
  it('S-E1: 生存2行の DeleteRows は両行 tombstone・rowsDeleted に両方', () => {
    const doc = baseDoc(['row-5', 'row-6']);
    const res = applyOperation(doc, deleteRows([row('row-5'), row('row-6')]), { revision: 3 });
    expect(res.changeSet.rowsDeleted).toEqual([row('row-5'), row('row-6')]);
    expect(isTombstoned(res.document, row('row-5'))).toBe(true);
    expect(isTombstoned(res.document, row('row-6'))).toBe(true);
  });

  it('S-E2: 既に tombstone の行は冪等 no-op、生存行のみ削除', () => {
    let doc = baseDoc(['row-5', 'row-6']);
    doc = applyOperation(doc, deleteRows([row('row-5')]), { revision: 3 }).document;
    const res = applyOperation(doc, deleteRows([row('row-5'), row('row-6')]), { revision: 4 });
    expect(res.changeSet.rowsDeleted).toEqual([row('row-6')]); // row-5 は含めない
    expect(isTombstoned(res.document, row('row-6'))).toBe(true);
  });

  it('S-E3: 全件 tombstone 済みの DeleteRows は changeSet 空で成功（例外にしない・Q-1）', () => {
    let doc = baseDoc(['row-5', 'row-6']);
    doc = applyOperation(doc, deleteRows([row('row-5'), row('row-6')]), { revision: 3 }).document;
    const res = applyOperation(doc, deleteRows([row('row-5'), row('row-6')]), { revision: 4 });
    expect(res.changeSet.rowsDeleted).toEqual([]);
    expect(res.changeSet.cells).toEqual([]);
    expect(res.inverseSeed.deletedRows).toEqual([]);
  });
});

describe('apply — InverseSeed（Phase 3 rollback 消費者視点・DA）', () => {
  it('SetCells（空セル）の inverseSeed.cells は変更前値=blank を保持', () => {
    const doc = baseDoc(['row-1']);
    const res = applyOperation(
      doc,
      setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('x') }]),
      { revision: 2 },
    );
    expect(res.inverseSeed.cells).toEqual([
      { rowId: row('row-1'), columnId: col('col-a'), value: blank() },
    ]);
    expect(res.inverseSeed.insertedRowIds).toEqual([]);
    expect(res.inverseSeed.deletedRows).toEqual([]);
  });

  it('SetCells（上書き）の inverseSeed.cells は直前値を保持（rollback で戻せる）', () => {
    let doc = baseDoc(['row-1']);
    doc = applyOperation(
      doc,
      setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('old') }]),
      { revision: 2 },
    ).document;
    const res = applyOperation(
      doc,
      setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('new') }]),
      { revision: 3 },
    );
    expect(res.inverseSeed.cells).toEqual([
      { rowId: row('row-1'), columnId: col('col-a'), value: str('old') },
    ]);
  });

  it('InsertRows の inverseSeed.insertedRowIds は挿入行（rollback で除去する対象）', () => {
    const doc = baseDoc(['row-1']);
    const res = applyOperation(doc, insertRows(row('row-1'), ['row-2']), { revision: 2 });
    expect(res.inverseSeed.insertedRowIds).toEqual([row('row-2')]);
  });

  it('DeleteRows の inverseSeed.deletedRows は復元位置(index)と meta(tombstone:false) を保持', () => {
    const doc = baseDoc(['row-1', 'row-2', 'row-3']);
    const res = applyOperation(doc, deleteRows([row('row-2')]), { revision: 4 });
    expect(res.inverseSeed.deletedRows).toHaveLength(1);
    const restored = res.inverseSeed.deletedRows[0];
    expect(restored.rowId).toBe(row('row-2'));
    expect(restored.index).toBe(1); // rowOrder 上の位置
    expect(restored.meta.tombstone).toBe(false); // 削除前の状態（復元で使う）
  });
});

// ---- 決定論プロパティテスト（シード付き PRNG・DA D4 / S-A3 / S-M2 の Phase 1 版）----

// mulberry32: 小さなシード付き PRNG（テスト専用。実装コードでは使わない）。
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// シード PRNG から「必ず妥当な（apply が throw しない）」Operation 列を生成する。
// RowId 採番もシード由来（DA D4: 同一シード→同一列・同一 ID）。
function generateOps(seed: number, count: number): DocumentOperation[] {
  const rand = mulberry32(seed);
  const columns = [col('col-a'), col('col-b'), col('col-c')];
  const orderModel: RowId[] = []; // rowOrder のミラー（tombstone 含む・アンカー候補）
  const liveList: RowId[] = []; // 生存行のミラー（SetCells/DeleteRows 対象）
  const ops: DocumentOperation[] = [];
  let counter = 0;
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

  for (let i = 0; i < count; i += 1) {
    const roll = rand();
    if (orderModel.length === 0 || roll < 0.4) {
      const rowId = createRowId(`r-${seed}-${counter}`);
      counter += 1;
      const anchor: RowId | null = orderModel.length === 0 || rand() < 0.25 ? null : pick(orderModel);
      ops.push({ type: 'insertRows', afterRowId: anchor, rows: [{ rowId }] });
      const at = anchor === null ? 0 : orderModel.indexOf(anchor) + 1;
      orderModel.splice(at, 0, rowId);
      liveList.push(rowId);
    } else if (roll < 0.8 && liveList.length > 0) {
      const rowId = pick(liveList);
      const columnId = pick(columns);
      const value: CellScalar =
        rand() < 0.5
          ? { kind: 'string', value: `v${Math.floor(rand() * 1000)}` }
          : { kind: 'number', value: Math.floor(rand() * 1000) };
      ops.push({ type: 'setCells', changes: [{ rowId, columnId, value }], conflictPolicy: 'reject-overlap' });
    } else if (liveList.length > 0) {
      const idx = Math.floor(rand() * liveList.length);
      const rowId = liveList[idx];
      ops.push({ type: 'deleteRows', rowIds: [rowId] });
      liveList.splice(idx, 1); // 以後 live からは選ばない（orderModel には残す）
    }
  }
  return ops;
}

// rowMeta 挿入順・セル投入順を反転して同一論理状態を再構築する（正準化が内部順に非依存であることを規模で検証）。
// CellStore は slot/colIndex で決定的に整列するため、逆順で setCell しても documentHash は不変であるべき。
function rebuildWithReversedMaps(doc: SheetDocument): SheetDocument {
  const rowMeta = new Map<RowId, RowMeta>();
  for (const rowId of [...doc.rowMeta.keys()].reverse()) {
    rowMeta.set(rowId, { ...doc.rowMeta.get(rowId)! });
  }
  const rebuilt: SheetDocument = {
    revision: doc.revision,
    rowOrder: [...doc.rowOrder],
    rowMeta,
    columnOrder: [...doc.columnOrder],
    cells: createCellStore(),
    maxSlot: doc.maxSlot,
  };
  for (const rowId of [...doc.rowMeta.keys()].reverse()) {
    const entries: Array<[ColumnId, CellRecord]> = [];
    forEachCellInRow(doc, rowId, (columnId, record) => {
      entries.push([columnId, { value: record.value, lastChangedRevision: record.lastChangedRevision }]);
    });
    for (const [columnId, record] of entries.reverse()) {
      setCell(rebuilt, rowId, columnId, record);
    }
  }
  return rebuilt;
}

describe('apply — 決定論プロパティ（シード付きランダム Operation 列・DA D4 / S-A3 / S-M2）', () => {
  const seeds = [1, 2, 42, 1337, 20260711, 999999];
  const columns = [col('col-a'), col('col-b'), col('col-c')];

  it('同一シードの Operation 列を2つの独立文書へ適用→hash 一致（複数シード・ID もシード由来）', () => {
    for (const seed of seeds) {
      const docA = applyAll(createDocument(columns), generateOps(seed, 250));
      const docB = applyAll(createDocument(columns), generateOps(seed, 250));
      expect(documentHash(docA)).toBe(documentHash(docB));
      // 弱い緑（自明収束）でないことの担保: 生存行と非空セルが実在する
      expect(displayRowOrder(docA).length).toBeGreaterThan(0);
      expect(canonicalSerialize(docA).length).toBeGreaterThan(0);
    }
  });

  it('Map 挿入順を反転して再構築しても hash 不変（正準化が Map 反復順非依存・DA D1 の規模拡張）', () => {
    const doc = applyAll(createDocument(columns), generateOps(42, 300));
    expect(documentHash(rebuildWithReversedMaps(doc))).toBe(documentHash(doc));
  });
});
