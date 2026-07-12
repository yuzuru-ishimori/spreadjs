// Operation replay 計測（DD-006 Phase 4・AC5・bench-protocol 準拠）。
// sheet-core の applyOperation で 1,000〜100,000 点の所要時間・最終 hash・メモリを計測し、
// snapshot 閾値（§16.3）の暫定推奨値の桁感を得る（正式 snapshot 形式は Phase 1・確定しない）。
// あわせて素朴 JSON 化の serialize/parse 時間・サイズ・復元後 hash 一致を参考計測する。
// 注: applyOperation は毎回全文書を clone する（immutable 契約）ため replay は O(N^2) 傾向。
//     これは「replay を軽く保つには snapshot が要る」ことの実測根拠になる。
// 実行: node --expose-gc --import tsx src/bench-replay.ts [--full] [--pretty]

import v8 from 'node:v8';
import {
  applyOperation,
  canonicalSerialize,
  createDocument,
  documentHash,
  type CellRecord,
  type DocumentOperation,
  type RowMeta,
  type SheetDocument,
} from '@nanairo-sheet/sheet-core';
import type { ColumnId, RowId } from '@nanairo-sheet/sheet-types';
import { DEFAULT_LIMITS, FormulaSheet, num, parse, type Expr } from '@nanairo-sheet/sheet-formula';
import { generateOperations } from './op-gen';

const round = (x: number): number => Number(x.toFixed(3));
const forceGc = (): void => globalThis.gc?.();
const heapUsed = (): number => v8.getHeapStatistics().used_heap_size;

interface Checkpoint {
  ops: number;
  cumulativeMs: number;
}

function replayWithCheckpoints(
  seedDoc: SheetDocument,
  operations: readonly DocumentOperation[],
  checkpoints: readonly number[],
): { doc: SheetDocument; points: Checkpoint[] } {
  const set = new Set(checkpoints);
  const points: Checkpoint[] = [];
  let doc = seedDoc;
  let rev = 2;
  forceGc();
  const t0 = performance.now();
  for (let i = 0; i < operations.length; i += 1) {
    const op = operations[i];
    if (op !== undefined) doc = applyOperation(doc, op, { revision: rev }).document;
    rev += 1;
    if (set.has(i + 1)) points.push({ ops: i + 1, cumulativeMs: round(performance.now() - t0) });
  }
  return { doc, points };
}

// ---- 素朴 snapshot（Map→配列）。正式形式ではない・桁感把握用 ----
interface PlainSnapshot {
  revision: number;
  rowOrder: string[];
  rowMeta: Array<[string, RowMeta]>;
  columnOrder: string[];
  cells: Array<[string, Array<[string, CellRecord]>]>;
}
function toPlainSnapshot(doc: SheetDocument): PlainSnapshot {
  const rowMeta: Array<[string, RowMeta]> = [];
  for (const [id, m] of doc.rowMeta) rowMeta.push([id, m]);
  const cells: Array<[string, Array<[string, CellRecord]>]> = [];
  for (const [rid, cm] of doc.cells) {
    const row: Array<[string, CellRecord]> = [];
    for (const [cid, rec] of cm) row.push([cid, rec]);
    cells.push([rid, row]);
  }
  return {
    revision: doc.revision,
    rowOrder: [...doc.rowOrder],
    rowMeta,
    columnOrder: [...doc.columnOrder],
    cells,
  };
}
function fromPlainSnapshot(s: PlainSnapshot): SheetDocument {
  const rowMeta = new Map<RowId, RowMeta>(s.rowMeta as Array<[RowId, RowMeta]>);
  const cells = new Map<RowId, Map<ColumnId, CellRecord>>();
  for (const [rid, cm] of s.cells) cells.set(rid as RowId, new Map(cm as Array<[ColumnId, CellRecord]>));
  return {
    revision: s.revision,
    rowOrder: s.rowOrder as RowId[],
    rowMeta,
    columnOrder: s.columnOrder as ColumnId[],
    cells,
  };
}

function ast(formula: string): Expr {
  const p = parse(formula, DEFAULT_LIMITS);
  if (!p.ok) throw new Error(p.error);
  return p.ast;
}

function main(): void {
  const argv = process.argv.slice(2);
  const full = argv.includes('--full');
  const pretty = argv.includes('--pretty');
  const count = full ? 100_000 : 10_000;
  const seed = 20260712;
  const initialRows = 500;
  const cols = 10;

  const { columns, initialRowIds, operations } = generateOperations({ count, seed, initialRows, cols });
  const seedDoc = applyOperation(
    createDocument(columns),
    { type: 'insertRows', afterRowId: null, rows: initialRowIds.map((rowId) => ({ rowId })) },
    { revision: 1 },
  ).document;

  const checkpoints = [1_000, 5_000, 10_000, 50_000, 100_000].filter((c) => c <= count);
  const { doc, points } = replayWithCheckpoints(seedDoc, operations, checkpoints);
  const finalHash = documentHash(doc);

  // snapshot 参考計測（素朴 JSON 化）。
  forceGc();
  const memBefore = heapUsed();
  const plain = toPlainSnapshot(doc);
  const ts0 = performance.now();
  const json = JSON.stringify(plain);
  const serializeMs = round(performance.now() - ts0);
  const tp0 = performance.now();
  const parsed = JSON.parse(json) as PlainSnapshot;
  const parseMs = round(performance.now() - tp0);
  const restored = fromPlainSnapshot(parsed);
  forceGc();
  const restoredHeapDelta = heapUsed() - memBefore;
  const hashMatches = documentHash(restored) === finalHash;

  // formula 付き一括再計算の参考計測（Operation replay とは別レイヤー）。
  const fsheet = new FormulaSheet(200);
  const formulaCells = full ? 10_000 : 1_000;
  for (let i = 0; i < 500; i += 1) fsheet.setInput(i, 0, num(i));
  for (let k = 0; k < formulaCells; k += 1) fsheet.setFormula(1 + Math.floor(k / 200), (k % 200) + 1, ast('=SUM(A1:A500)'));
  const tr0 = performance.now();
  fsheet.recalcAll();
  const formulaRecalcMs = round(performance.now() - tr0);

  const mu = process.memoryUsage();
  const output = {
    meta: {
      runtime: 'node',
      runtimeVersion: process.version,
      count,
      initialRows,
      cols,
      full,
      gcExposed: typeof globalThis.gc === 'function',
      note: 'applyOperation は immutable（毎回全文書 clone）ゆえ replay は O(N^2) 傾向。snapshot が必要な根拠。',
    },
    replay: {
      checkpoints: points,
      finalHash,
      documentRows: doc.rowOrder.length,
      serializedLength: canonicalSerialize(doc).length,
      memoryBytes: { rss: mu.rss, heapUsed: mu.heapUsed },
    },
    snapshotReference: {
      jsonBytes: json.length,
      serializeMs,
      parseMs,
      restoredHeapDeltaBytes: restoredHeapDelta,
      hashMatches, // 復元文書の hash が一致（round-trip 健全性）
    },
    formulaReference: { formulaCells, recalcMs: formulaRecalcMs },
  };
  process.stdout.write(JSON.stringify(output, null, pretty ? 2 : 0) + '\n');
}

main();
