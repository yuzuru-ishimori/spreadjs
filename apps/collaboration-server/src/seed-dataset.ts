// 統合PoC（DD-005 Phase 2）用の決定論シード。開発起動時に 50,000行×200列・非空約10万セルの文書を
// サーバー権威文書へ投入する。ClientSession を Document State の唯一の正本に保つため（#1/#2）、シードは
// **サーバーの Operation ログ**として積む（InsertRows 1件＋SetCells 複数バッチ）。join した各クライアントは
// この Operation ログを replay して committed 文書を構築する（= #6 初期 snapshot 経路の計測対象）。
//
// 決定性: 自己完結の PRNG（mulberry32）と固定シードで、同一設定から常に同一の (rowId,columnId,value) 集合を返す。
// Node/ws/hono は参照しない純データ生成（sheet-core / sheet-types 型のみ）。server.ts が起動時に呼ぶ。

import type { ClientOperationEnvelope, SetCellsChange } from '@nanairo-sheet/sheet-core';
import {
  createColumnId,
  createDocumentId,
  createOperationId,
  createRowId,
  createTransactionId,
} from '@nanairo-sheet/sheet-types';
import type { ColumnId } from '@nanairo-sheet/sheet-types';
import type { Sequencer } from '@nanairo-sheet/sheet-server-core';

const PROTOCOL_VERSION = 1;
const SEED_CLIENT_ID = 'system-seed';

/** 統合データセットの規模設定（既定は DD-005 決定事項: 50,000行×200列・非空約10万）。 */
export interface IntegrationDatasetConfig {
  rows: number;
  cols: number;
  nonEmpty: number;
  seed: number;
  /** 1 SetCells あたりの変更件数（初期 replay の applyOperation clone 回数を左右する）。 */
  batchSize?: number;
}

export const DEFAULT_INTEGRATION_DATASET: IntegrationDatasetConfig = {
  rows: 50_000,
  cols: 200,
  nonEmpty: 100_000,
  seed: 20_260_712,
  batchSize: 10_000,
};

/** rowId 文字列（display も RowId 安定も `row-<n>` で一意・1 始まり）。 */
export function integrationRowId(index1: number): string {
  return `row-${index1}`;
}

/** columnId 文字列（`col-<0..cols-1>`）。 */
export function integrationColumnId(index0: number): string {
  return `col-${index0}`;
}

/** 統合データセットの列順（col-0..col-(cols-1)）。ClientSession/サーバー双方が同一列順を使う。 */
export function integrationColumnOrder(cols: number): ColumnId[] {
  const order: ColumnId[] = [];
  for (let c = 0; c < cols; c += 1) {
    order.push(createColumnId(integrationColumnId(c)));
  }
  return order;
}

/** 決定論 PRNG（mulberry32・自己完結）。 */
function createPrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHORT_ASCII = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const JP_WORDS = [
  '営業部',
  '開発部',
  '田中 太郎',
  '鈴木 花子',
  '承認済み',
  '保留中',
  '要確認',
  '対応中',
  '完了',
  '未着手',
] as const;

function makeValue(prng: () => number): SetCellsChange['value'] {
  const r = prng();
  if (r < 0.45) {
    // 数値（整数・小数を混在）。
    return prng() < 0.5
      ? { kind: 'number', value: Math.floor(prng() * 1_000_000) }
      : { kind: 'number', value: Math.floor(prng() * 1_000_000) / 100 };
  }
  if (r < 0.75) {
    // 短い ASCII。
    const len = 3 + Math.floor(prng() * 4);
    let s = '';
    for (let i = 0; i < len; i += 1) {
      s += SHORT_ASCII[Math.floor(prng() * SHORT_ASCII.length)] ?? 'X';
    }
    return { kind: 'string', value: s };
  }
  // 日本語（IME・描画負荷の確認用）。
  return { kind: 'string', value: JP_WORDS[Math.floor(prng() * JP_WORDS.length)] ?? '完了' };
}

/**
 * 決定論的に非空セルの (row1, col0, value) を生成する（重複位置は dedup・出力は行→列で決定的）。
 * @returns SetCells 用の change 配列（行昇順・列昇順に整列済み）。
 */
export function generateIntegrationCells(config: IntegrationDatasetConfig): SetCellsChange[] {
  const capacity = config.rows * config.cols;
  const target = Math.min(Math.max(config.nonEmpty, 0), capacity);
  const prng = createPrng(config.seed);
  const seen = new Set<number>();
  const raw: Array<{ row1: number; col0: number; value: SetCellsChange['value'] }> = [];
  while (raw.length < target) {
    const row0 = Math.floor(prng() * config.rows);
    const col0 = Math.floor(prng() * config.cols);
    const key = row0 * config.cols + col0;
    if (seen.has(key)) {
      prng(); // 値抽選分を消費して決定論を保つ
      continue;
    }
    seen.add(key);
    raw.push({ row1: row0 + 1, col0, value: makeValue(prng) });
  }
  raw.sort((a, b) => (a.row1 === b.row1 ? a.col0 - b.col0 : a.row1 - b.row1));
  return raw.map((c) => ({
    rowId: createRowId(integrationRowId(c.row1)),
    columnId: createColumnId(integrationColumnId(c.col0)),
    value: c.value,
  }));
}

/** InsertRows（row-1..row-rows を一括）＋SetCells バッチ列を submit する。決定論で ClientSession 側 replay と一致。 */
export function seedIntegrationDataset(
  sequencer: Sequencer,
  documentId: string,
  config: IntegrationDatasetConfig = DEFAULT_INTEGRATION_DATASET,
): { rows: number; nonEmptyCells: number; operations: number } {
  const docId = createDocumentId(documentId);
  let clientSequence = 0;
  const submit = (opId: string, operation: ClientOperationEnvelope['operation']): void => {
    clientSequence += 1;
    const envelope: ClientOperationEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      documentId: docId,
      operationId: createOperationId(opId),
      transactionId: createTransactionId(`tx-${opId}`),
      actorId: 'system',
      clientId: SEED_CLIENT_ID,
      clientSequence,
      baseRevision: 0, // 0 ≤ currentRevision を常に満たす（受理条件）
      operation,
    };
    sequencer.submit(envelope);
  };

  // 1) 行を一括投入（row-1..row-N）。RowId 安定の基準（AC4 の行挿入追従の前提）。
  const rows = Array.from({ length: config.rows }, (_v, i) => ({
    rowId: createRowId(integrationRowId(i + 1)),
  }));
  submit('seed-insert-rows', { type: 'insertRows', afterRowId: null, rows });

  // 2) セルをバッチ SetCells で投入（初期 replay の clone 回数＝バッチ数）。
  const changes = generateIntegrationCells(config);
  const batchSize = config.batchSize ?? DEFAULT_INTEGRATION_DATASET.batchSize ?? 10_000;
  let batchIndex = 0;
  for (let i = 0; i < changes.length; i += batchSize) {
    const slice = changes.slice(i, i + batchSize);
    submit(`seed-cells-${batchIndex}`, {
      type: 'setCells',
      changes: slice,
      conflictPolicy: 'reject-overlap',
    });
    batchIndex += 1;
  }

  return { rows: config.rows, nonEmptyCells: changes.length, operations: clientSequence };
}
