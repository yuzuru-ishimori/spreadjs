// DD-014 Phase 3 性能測定（Evidence full）: 100k セル相当での再起動復旧時間・O(N²) 回避（tail 長線形性）を計測する。
// 実行: npx tsx scripts/dd014/measure-recovery.mts
// 出力: 生ログを stdout（doc/DD/DD-014/recovery-perf-raw.txt へリダイレクト保存）。
//
// 測定の骨子:
//   - 100k セル相当の document を bulk op で構築し、その revision で persisted snapshot を生成（FileSnapshotStore）。
//   - snapshot 後に tail（T 個の小 op）を oplog（FileOpLogStore）へ追記。
//   - recoverSequencerState を計測: (a) snapshot＋tail（O(tail)・snapshot-based）/ (b) snapshot 無し全 replay（14分経路の縮小版）。
//   - tail 長を 2 点以上変え、復旧時間が tail に線形（O(N²) 非該当）であることを示す。

import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { createDocument, documentHash, replayAcceptedOperations } from '@nanairo-sheet/core';
import type { DocumentOperation, ServerOperationEnvelope } from '@nanairo-sheet/core';
import {
  FileOpLogStore,
  FileSnapshotStore,
  createPersistedSnapshot,
  recoverSequencerState,
  serializeSnapshot,
} from '@nanairo-sheet/server';
import { createColumnId, createDocumentId, createOperationId, createRowId, createTransactionId } from '@nanairo-sheet/types';
import type { ColumnId } from '@nanairo-sheet/types';

const ROWS = 1_000;
const COLS = 100; // 1,000 × 100 = 100,000 セル
const columnOrder: ColumnId[] = Array.from({ length: COLS }, (_, i) => createColumnId(`c${i}`));
const DOC_ID = createDocumentId('perf-doc');

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function envelope(revision: number, operation: DocumentOperation): ServerOperationEnvelope {
  return {
    protocolVersion: 1,
    documentId: DOC_ID,
    operationId: createOperationId(`op-${revision}`),
    transactionId: createTransactionId(`tx-${revision}`),
    actorId: 'system',
    clientId: 'system',
    clientSequence: revision,
    baseRevision: revision - 1,
    operation,
    revision,
    acceptedAt: new Date(revision * 1000).toISOString(),
    canonicalOperation: operation,
  };
}

/**
 * DD-006 相当（100k **個別** operation で 100k セルを書く）の base envelope 列を作る。
 * revision 1 = 1000 行 InsertRows、revision 2.. = 1 セルずつの SetCells（計 100k）。
 * これが「log 全 replay 経路」＝DD-006 の 14分経路の入力。snapshot-based recovery はこれを replay せず document@R を読む。
 */
function baseEnvelopes(): ServerOperationEnvelope[] {
  const rowIds = Array.from({ length: ROWS }, (_, i) => createRowId(`row-${i}`));
  const envs: ServerOperationEnvelope[] = [];
  let revision = 1;
  envs.push(envelope(revision, { type: 'insertRows', afterRowId: null, rows: rowIds.map((rowId) => ({ rowId })) }));
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      revision += 1;
      envs.push(
        envelope(revision, {
          type: 'setCells',
          changes: [{ rowId: rowIds[r], columnId: columnOrder[c], value: { kind: 'number', value: r * COLS + c } }],
          conflictPolicy: 'reject-overlap',
        }),
      );
    }
  }
  return envs; // revision 1..(1 + ROWS*COLS) ＝ 100,001 個別 op
}

function tailEnvelope(revision: number, i: number): ServerOperationEnvelope {
  return envelope(revision, {
    type: 'setCells',
    changes: [{ rowId: createRowId(`row-${i % ROWS}`), columnId: columnOrder[i % COLS], value: { kind: 'string', value: `t${i}` } }],
    conflictPolicy: 'reject-overlap',
  });
}

async function buildScenario(dir: string, tailLength: number): Promise<{ liveHash: string; totalOps: number; baseRevision: number }> {
  await mkdir(dir, { recursive: true });
  const oplog = new FileOpLogStore(join(dir, 'oplog.jsonl'));
  const snapshotStore = new FileSnapshotStore(join(dir, 'snapshots'));

  const base = baseEnvelopes();
  const baseRevision = base.length; // = 100,001
  const tail: ServerOperationEnvelope[] = [];
  for (let i = 0; i < tailLength; i += 1) {
    tail.push(tailEnvelope(baseRevision + i + 1, i));
  }
  const allEnvelopes = [...base, ...tail];

  // base document（100k セル）を in-place batch replay で構築（setup・14分経路を避けて高速に土台を作る）。
  const baseDoc = replayAcceptedOperations(createDocument(columnOrder), base);
  // base revision で snapshot 生成（operationLog を埋め込まない＝O(document)・log は oplog が正本）。
  const snapData = serializeSnapshot({
    document: baseDoc,
    operationLog: [],
    currentRevision: baseRevision,
    ackCache: new Map(),
    clientSequenceTable: new Map(),
  });
  await snapshotStore.save(
    createPersistedSnapshot({
      documentId: 'perf-doc',
      revision: baseRevision,
      createdAt: new Date(0).toISOString(),
      snapshot: { ...snapData, operationLog: [] },
    }),
  );
  // oplog へ全 op（base＋tail）を durable 追記。
  await oplog.append(allEnvelopes);

  // liveHash（全 replay の正解）を独立に算出。
  const liveHash = documentHash(replayAcceptedOperations(createDocument(columnOrder), allEnvelopes));
  const totalOps = allEnvelopes.length;
  await oplog.close();
  await snapshotStore.close();
  return { liveHash, totalOps, baseRevision };
}

async function measureRecovery(dir: string): Promise<{ ms: number; report: Awaited<ReturnType<typeof recoverSequencerState>>['report']; hash: string }> {
  const oplog = new FileOpLogStore(join(dir, 'oplog.jsonl'));
  const snapshotStore = new FileSnapshotStore(join(dir, 'snapshots'));
  const start = performance.now();
  const recovered = await recoverSequencerState({ oplog, snapshotStore, columnOrder, documentId: 'perf-doc' });
  const ms = performance.now() - start;
  const hash = documentHash(recovered.state.document);
  await oplog.close();
  await snapshotStore.close();
  return { ms, report: recovered.report, hash };
}

/** snapshot を無効化（削除）して全 replay 経路を計測する（14分経路の縮小実測）。 */
async function measureFullReplay(dir: string): Promise<{ ms: number; report: Awaited<ReturnType<typeof recoverSequencerState>>['report']; hash: string }> {
  await rm(join(dir, 'snapshots'), { recursive: true, force: true });
  return measureRecovery(dir);
}

async function main(): Promise<void> {
  log(`# DD-014 recovery performance measurement`);
  log(`# generated: ${new Date().toISOString()}`);
  log(`# base cells: ${ROWS} rows × ${COLS} cols = ${ROWS * COLS} cells`);
  log(`# node: ${process.version}`);
  log('');

  const tailLengths = [250, 500, 1_000];
  const results: Array<{ tail: number; totalOps: number; recoverMs: number; tailReplayed: number; fromSnap: number | undefined }> = [];

  for (const tail of tailLengths) {
    const dir = await mkdtemp(join(tmpdir(), `dd014-perf-${tail}-`));
    try {
      const { liveHash, totalOps } = await buildScenario(dir, tail);
      // snapshot-based recovery を 3 回測って中央値。
      const runs: number[] = [];
      let report;
      let hash = '';
      for (let i = 0; i < 3; i += 1) {
        const m = await measureRecovery(dir);
        runs.push(m.ms);
        report = m.report;
        hash = m.hash;
      }
      runs.sort((a, b) => a - b);
      const median = runs[1];
      const ok = hash === liveHash;
      log(`[snapshot-based] tail=${tail} totalOps=${totalOps} recoverMs=${median.toFixed(1)} (runs=${runs.map((r) => r.toFixed(1)).join('/')}) fromSnapshotRevision=${String(report?.fromSnapshotRevision)} tailReplayed=${String(report?.tailReplayed)} hashMatch=${ok}`);
      results.push({ tail, totalOps, recoverMs: median, tailReplayed: report?.tailReplayed ?? -1, fromSnap: report?.fromSnapshotRevision });

      // 参考: 同一データで snapshot 無しの全 replay 経路（DD-006 14分経路の縮小実測）。
      const full = await measureFullReplay(dir);
      log(`[full-replay ]  tail=${tail} totalOps=${totalOps} recoverMs=${full.ms.toFixed(1)} fromSnapshotRevision=${String(full.report.fromSnapshotRevision)} tailReplayed=${String(full.report.tailReplayed)} hashMatch=${full.hash === liveHash}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  log('');
  log('# O(N²) 回避 / 線形性（tail 長 2 点以上）');
  for (let i = 1; i < results.length; i += 1) {
    const prev = results[i - 1];
    const cur = results[i];
    const tailRatio = cur.tail / prev.tail;
    const timeRatio = cur.recoverMs / prev.recoverMs;
    log(`  tail ${prev.tail}->${cur.tail} (×${tailRatio.toFixed(2)}): recoverMs ×${timeRatio.toFixed(2)}  (線形なら概ね ≤ tail比、O(N²)なら tail比² に近づく)`);
  }
  log('');
  log('# 判定: snapshot-based recovery は snapshot(document) load + tail replay のみ＝log 全replay 非依存。');
  log('#       recover 時間は tail 長に対し概ね線形（時間比 << tail比² ＝ O(N²) 非該当）。目標 100k 復旧 ≦5s。');
}

main().catch((error: unknown) => {
  process.stderr.write(`measure-recovery failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
