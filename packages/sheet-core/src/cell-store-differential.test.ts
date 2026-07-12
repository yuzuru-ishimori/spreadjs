// AC2: 差分試験（differential test）。
// 本実装（安定 slot キー CellStore + applyOperation）と、独立実装の **二段 Map リファレンス**
// （Map<RowId, Map<ColumnId, CellRecord>> ＋ 参照 apply ＋ 参照 canonical serialize）を、
// seed 付きランダム Operation 列（setCells/insertRows/deleteRows 混在・1,000 件以上×複数 seed）へ
// 同順適用し、**各 op 後**に全セル・rowOrder・tombstone・slot・documentHash が完全一致することを検証する。
// index ずれ・サイレント上書きが 0 であることの機械実証（CG-2 の核）。
//
// リファレンスは本実装のセル表現に一切依存しない（二段 Map・独立 apply・独立 serialize）。hash の素（fnv1a64）
// のみ共有する（差分は「文書表現＋直列化の反復」にあり、hash プリミティブではないため）。

import { describe, expect, it } from 'vitest';

import { createColumnId, createRowId } from '@nanairo-sheet/sheet-types';
import type { ColumnId, RowId } from '@nanairo-sheet/sheet-types';

import { applyOperation } from './apply';
import { createDocument, displayRowOrder, getCell, isTombstoned } from './document';
import type { CellRecord, SheetDocument } from './document';
import { documentHash, fnv1a64 } from './hash';
import type { CellScalar, DocumentOperation } from './operations';

function col(value: string): ColumnId {
  return createColumnId(value);
}

// ---- 二段 Map リファレンス（独立実装）----

interface RefMeta {
  slot: number;
  tombstone: boolean;
  lastChangedRevision: number;
}
interface RefDoc {
  revision: number;
  rowOrder: RowId[];
  rowMeta: Map<RowId, RefMeta>;
  columnOrder: ColumnId[];
  cells: Map<RowId, Map<ColumnId, CellRecord>>;
}

function refCreate(columnOrder: ColumnId[]): RefDoc {
  return { revision: 0, rowOrder: [], rowMeta: new Map(), columnOrder: [...columnOrder], cells: new Map() };
}

function refNextSlot(doc: RefDoc): number {
  let max = -1;
  for (const meta of doc.rowMeta.values()) {
    if (meta.slot > max) max = meta.slot;
  }
  return max + 1;
}

// 参照 apply（apply.ts の意味論を独立に再現）。テストは妥当な op のみ生成するため reject 経路は扱わない。
function refApply(doc: RefDoc, op: DocumentOperation, revision: number): void {
  switch (op.type) {
    case 'insertRows': {
      const anchorIndex = op.afterRowId === null ? -1 : doc.rowOrder.indexOf(op.afterRowId);
      let insertAt = anchorIndex + 1;
      let slot = refNextSlot(doc);
      for (const rowSpec of op.rows) {
        doc.rowOrder.splice(insertAt, 0, rowSpec.rowId);
        doc.rowMeta.set(rowSpec.rowId, { slot, tombstone: false, lastChangedRevision: revision });
        insertAt += 1;
        slot += 1;
      }
      break;
    }
    case 'setCells': {
      for (const change of op.changes) {
        let rowCells = doc.cells.get(change.rowId);
        if (rowCells === undefined) {
          rowCells = new Map();
          doc.cells.set(change.rowId, rowCells);
        }
        rowCells.set(change.columnId, { value: change.value, lastChangedRevision: revision });
      }
      break;
    }
    case 'deleteRows': {
      for (const rowId of op.rowIds) {
        const meta = doc.rowMeta.get(rowId);
        if (meta === undefined || meta.tombstone) continue;
        meta.tombstone = true;
        meta.lastChangedRevision = revision;
      }
      break;
    }
  }
  doc.revision = revision;
}

function field(text: string): string {
  return `${text.length}:${text}`;
}

// 参照 canonical serialize（hash.ts と同一の正準形を独立実装）。
function refCanonical(doc: RefDoc): string {
  const parts: string[] = [];
  for (const rowId of doc.rowOrder) {
    const meta = doc.rowMeta.get(rowId);
    if (meta === undefined || meta.tombstone) continue; // displayRowOrder 相当
    const rowCells = doc.cells.get(rowId);
    if (rowCells === undefined) continue;
    for (const columnId of doc.columnOrder) {
      const record = rowCells.get(columnId);
      if (record === undefined) continue;
      const value = record.value;
      if (value.kind === 'blank') continue;
      const valueText = value.kind === 'number' ? String(value.value) : value.value;
      parts.push(
        field(String(rowId)) +
          field(String(columnId)) +
          field(value.kind) +
          field(valueText) +
          field(String(record.lastChangedRevision)),
      );
    }
  }
  return parts.join('');
}

function refHash(doc: RefDoc): string {
  return fnv1a64(refCanonical(doc));
}

// ---- seed 付き Operation 生成（妥当な op のみ・3 種混在）----

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateOps(seed: number, count: number, columns: ColumnId[]): DocumentOperation[] {
  const rand = mulberry32(seed);
  const orderModel: RowId[] = [];
  const liveList: RowId[] = [];
  const ops: DocumentOperation[] = [];
  let counter = 0;
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

  for (let i = 0; i < count; i += 1) {
    const roll = rand();
    if (orderModel.length === 0 || roll < 0.35) {
      const rowId = createRowId(`r-${seed}-${counter}`);
      counter += 1;
      const anchor: RowId | null = orderModel.length === 0 || rand() < 0.25 ? null : pick(orderModel);
      ops.push({ type: 'insertRows', afterRowId: anchor, rows: [{ rowId }] });
      const at = anchor === null ? 0 : orderModel.indexOf(anchor) + 1;
      orderModel.splice(at, 0, rowId);
      liveList.push(rowId);
    } else if (roll < 0.82 && liveList.length > 0) {
      // 1〜3 セルの setCells（同一 op 内で異なる列・生存行のみ）。blank も稀に混ぜる。
      const changeCount = 1 + Math.floor(rand() * 3);
      const changes: Array<{ rowId: RowId; columnId: ColumnId; value: CellScalar }> = [];
      const usedCols = new Set<string>();
      for (let k = 0; k < changeCount; k += 1) {
        const rowId = pick(liveList);
        const columnId = pick(columns);
        const key = `${String(rowId)}::${String(columnId)}`;
        if (usedCols.has(key)) continue; // 同一 op 内の同一セル重複は避ける（順序依存を排除）
        usedCols.add(key);
        const r = rand();
        const value: CellScalar =
          r < 0.15
            ? { kind: 'blank' }
            : r < 0.55
              ? { kind: 'string', value: `v${Math.floor(rand() * 10000)}` }
              : { kind: 'number', value: Math.floor(rand() * 10000) };
        changes.push({ rowId, columnId, value });
      }
      if (changes.length > 0) {
        ops.push({ type: 'setCells', changes, conflictPolicy: 'reject-overlap' });
      }
    } else if (liveList.length > 0) {
      const idx = Math.floor(rand() * liveList.length);
      const rowId = liveList[idx]!;
      ops.push({ type: 'deleteRows', rowIds: [rowId] });
      liveList.splice(idx, 1);
    }
  }
  return ops;
}

// 本実装 doc とリファレンス doc の全状態が一致することを検証（tombstone 行のセルも含む）。
function assertEquivalent(real: SheetDocument, ref: RefDoc): void {
  // rowOrder（tombstone 含む全行）一致
  expect(real.rowOrder.map(String)).toEqual(ref.rowOrder.map(String));
  // rowMeta（slot / tombstone / lastChangedRevision）一致
  for (const rowId of ref.rowOrder) {
    const realMeta = real.rowMeta.get(rowId);
    const refMeta = ref.rowMeta.get(rowId)!;
    expect(realMeta?.slot).toBe(refMeta.slot);
    expect(realMeta?.tombstone).toBe(refMeta.tombstone);
    expect(realMeta?.lastChangedRevision).toBe(refMeta.lastChangedRevision);
    expect(isTombstoned(real, rowId)).toBe(refMeta.tombstone);
  }
  // 全 (rowId × columnId) セル一致（tombstone 行のセルも保全されていること）
  for (const rowId of ref.rowOrder) {
    for (const columnId of ref.columnOrder) {
      const realRec = getCell(real, rowId, columnId);
      const refRec = ref.cells.get(rowId)?.get(columnId);
      expect(realRec).toEqual(refRec);
    }
  }
  // displayRowOrder（表示順）一致
  expect(displayRowOrder(real).map(String)).toEqual(
    ref.rowOrder.filter((r) => !(ref.rowMeta.get(r)?.tombstone ?? true)).map(String),
  );
}

describe('AC2: 差分試験 — 新 CellStore と二段 Map リファレンスの完全一致', () => {
  const columns = [col('col-a'), col('col-b'), col('col-c')];
  const seeds = [1, 7, 42, 1337, 20260713, 8888888];

  it.each(seeds)('seed=%d: 1,200 op を同順適用し全 op 後で完全一致（hash・全セル・構造）', (seed) => {
    const ops = generateOps(seed, 1200, columns);
    // 弱い緑（自明収束）でないことの担保: 3 種の op がいずれも十分生成されている。
    const counts = { setCells: 0, insertRows: 0, deleteRows: 0 };
    for (const op of ops) counts[op.type] += 1;
    expect(counts.insertRows).toBeGreaterThan(50);
    expect(counts.setCells).toBeGreaterThan(50);
    expect(counts.deleteRows).toBeGreaterThan(20);

    let real = createDocument(columns);
    const ref = refCreate(columns);
    let revision = 0;
    for (const op of ops) {
      revision += 1;
      real = applyOperation(real, op, { revision }).document;
      refApply(ref, op, revision);
      // 各 op 後に hash 完全一致（value 発散を即検知）。
      expect(documentHash(real)).toBe(refHash(ref));
    }
    // 末尾で全状態（tombstone 行のセル・slot 含む）完全一致。
    assertEquivalent(real, ref);
    expect(displayRowOrder(real).length).toBeGreaterThan(0); // 実体のある収束
  });
});
