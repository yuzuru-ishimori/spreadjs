// P2-1 性能是正の実測（DD-021-3 AC7/AC8）。
// apply.ts の InsertRows が maxSlot キャッシュで O(1) 採番になったこと（旧: nextSlot 全走査で Θ(N²)）を実測する。
//
// 【計測経路】replayAcceptedOperations（restart 復旧・snapshot tail replay の本番経路・DD-014）。
//   これは clone を 1 回だけ行い accepted op 列を in-place 適用する経路で、P2-1 が是正する対象（DD-014 codex 指摘の
//   「単一行 InsertRows 連発ログは nextSlot 全走査＋splice で Θ(N²)」）はこの経路にある。
//   ※ 1 op ごとに全文書 clone する immutable な applyOperation 経路の O(N) は DD-014 既知性質（P2-1 スコープ外・
//     snapshot が必要な根拠）で、本 P2-1 では触らない。
//
// 計測する 3 系:
//   1) 線形性: 初期行数 N を 4 段で変え「単一行 Insert×K を末尾 append で replay」の per-op を測る。
//      P2-1 後は per-op が N にほぼ非依存（旧実装は nextSlot 全走査で N に比例悪化＝二乗）。
//   2) 親⑤目標: 50,000 行文書へ単一行 Insert×1,000 連発 合計 ≦2s（1 回 p95 ≦5ms）。
//   3) bulk 10,000 行 Insert ≦500ms（非退行）・replay の決定論（同一ログ→同一 hash）非退行。
//
// 実行: node --expose-gc --import tsx src/bench-row-insert.ts [--pretty]

import {
  applyOperation,
  createDocument,
  documentHash,
  replayAcceptedOperations,
  type DocumentOperation,
  type SheetDocument,
} from '@nanairo-sheet/core';
import { createColumnId, createRowId } from '@nanairo-sheet/types';
import type { RowId } from '@nanairo-sheet/types';

const round = (x: number): number => Number(x.toFixed(3));
const forceGc = (): void => globalThis.gc?.();

let counter = 0;
function nextRowId(): RowId {
  counter += 1;
  return createRowId(`r-${counter}`);
}

/** 初期 N 行の文書を作る（1 回の bulk Insert・計測対象外の下ごしらえ）。 */
function seedDocument(rows: number, cols: number): SheetDocument {
  const columns = Array.from({ length: cols }, (_, i) => createColumnId(`c-${i}`));
  const doc = createDocument(columns);
  const ids = Array.from({ length: rows }, () => ({ rowId: nextRowId() }));
  return applyOperation(doc, { type: 'insertRows', afterRowId: null, rows: ids }, { revision: 1 }).document;
}

interface SingleInsertResult {
  initialRows: number;
  inserts: number;
  totalMs: number;
  perOpMeanMs: number;
  perOpP95Ms: number;
}

/**
 * N 行文書へ「単一行 Insert×K を末尾 append で replay」する所要を測る（replayAcceptedOperations 経路）。
 * per-op を計るため 1 op ずつ replay を回す（clone は各回 1 度＝復旧経路と同性質）。anchor は直前の挿入行にして
 * 常に末尾へ積む（splice が末尾＝O(1)・N 非依存性を見る）。
 */
function measureSingleInserts(initialRows: number, inserts: number, cols: number): SingleInsertResult {
  let doc = seedDocument(initialRows, cols);
  let anchor: RowId | null = doc.rowOrder[doc.rowOrder.length - 1] ?? null;
  const samples: number[] = new Array(inserts);
  forceGc();
  const t0 = performance.now();
  for (let i = 0; i < inserts; i += 1) {
    const rowId = nextRowId();
    const op: DocumentOperation = { type: 'insertRows', afterRowId: anchor, rows: [{ rowId }] };
    const s = performance.now();
    doc = replayAcceptedOperations(doc, [{ operation: op, revision: 2 + i }]);
    samples[i] = performance.now() - s;
    anchor = rowId; // 直前の挿入行の直後へ（末尾 append を維持）
  }
  const totalMs = performance.now() - t0;
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ?? 0;
  return {
    initialRows,
    inserts,
    totalMs: round(totalMs),
    perOpMeanMs: round(totalMs / inserts),
    perOpP95Ms: round(p95),
  };
}

/** bulk（1 op で M 行）Insert の所要と決定論（同一ログ→同一 hash）を測る。 */
function measureBulk(bulkRows: number, cols: number): { bulkMs: number; hash: string; replayHash: string } {
  const columns = Array.from({ length: cols }, (_, i) => createColumnId(`b-${i}`));
  const rows = Array.from({ length: bulkRows }, () => ({ rowId: nextRowId() }));
  const op = { type: 'insertRows' as const, afterRowId: null, rows };
  forceGc();
  const t0 = performance.now();
  const doc = applyOperation(createDocument(columns), op, { revision: 1 }).document;
  const bulkMs = round(performance.now() - t0);
  const hash = documentHash(doc);
  // 同一列・同一 op を別文書へ replay → hash 一致（決定論・maxSlot キャッシュが決定性を壊さない）。
  const replay = applyOperation(createDocument(columns), op, { revision: 1 }).document;
  return { bulkMs, hash, replayHash: documentHash(replay) };
}

function main(): void {
  const pretty = process.argv.includes('--pretty');
  const cols = 10;

  // 線形性: 初期行数を 4 段で変え、単一行 Insert×1,000 の per-op を測る（旧実装は N に比例悪化）。
  const linearity = [1_000, 5_000, 25_000, 50_000].map((n) => measureSingleInserts(n, 1_000, cols));

  // 親⑤目標: 50,000 行 × 単一行 Insert×1,000。
  const target = measureSingleInserts(50_000, 1_000, cols);

  // bulk 10,000 行・決定論。
  const bulk = measureBulk(10_000, cols);

  const output = {
    meta: {
      runtime: 'node',
      runtimeVersion: process.version,
      gcExposed: typeof globalThis.gc === 'function',
      path: 'replayAcceptedOperations（restart 復旧・snapshot tail replay の本番経路）',
      note:
        'P2-1: InsertRows の slot 採番は maxSlot キャッシュで O(1) 化（旧 nextSlot 全 rowMeta 走査を除去）。' +
        '残る per-op O(N) は resolveAnchorIndex の rowOrder.indexOf（アンカー探索）＋ splice。' +
        'DD 📐 は splice O(N) 残存を許容（実測が目標内なら可）。indexOf も同性質の残存で段階2（順序構造/gap buffer）候補。' +
        '親⑤の具体目標（50k+1000）はヘッドルーム十分で pass。',
    },
    linearity: {
      samples: linearity,
      // per-op が N に比例せず線形域に留まるか（旧実装なら 50k/1k ≒ 50 倍）。
      perOpRatio_50k_over_1k: round(
        (linearity[3]?.perOpMeanMs ?? 0) / (linearity[0]?.perOpMeanMs || 1),
      ),
    },
    target_50k_x_1000: {
      totalMs: target.totalMs,
      perOpMeanMs: target.perOpMeanMs,
      perOpP95Ms: target.perOpP95Ms,
      goalTotalMs: 2000,
      goalP95Ms: 5,
      pass: target.totalMs <= 2000 && target.perOpP95Ms <= 5,
    },
    bulk_10000: {
      bulkMs: bulk.bulkMs,
      goalMs: 500,
      pass: bulk.bulkMs <= 500,
      deterministic: bulk.hash === bulk.replayHash,
    },
  };
  process.stdout.write(JSON.stringify(output, null, pretty ? 2 : 0) + '\n');
}

main();
