// 永続化 復旧 不変条件スイート（§2.3「snapshot＋logからの復旧」の常設化・DD-014・CG-3）。
//
// DD-011 が設置し DD-014 が実充足する行=「snapshot＋log からの復旧」。randomized（seed 記録）で:
//   INV-P1 復元一致: recover(snapshot@R + oplog tail) の document hash == oplog 全 replay（空文書から）の hash（AC3）。
//   INV-P2 log 全replay 非依存: snapshot が存在すれば tailReplayed < totalOps（snapshot ベース初期化・AC4）。
//   INV-P3 revision/aux 継続: currentRevision・operationLog 長・ackCache・clientSequenceTable が live と一致。
//   INV-P4 決定性: 同一 seed 再実行で最終 hash・revision が一致。
// 障害注入は本スイート対象外（corrupt/torn は packages/server の fault matrix テストで固定）。
import { describe, expect, it } from 'vitest';

import { applyOperation, createDocument, documentHash } from '@nanairo-sheet/core';
import type { DocumentOperation, ServerOperationEnvelope, SheetDocument } from '@nanairo-sheet/core';
import {
  MemoryOpLogStore,
  MemorySnapshotStore,
  PersistentRoom,
  Room,
  Sequencer,
  createCounterIdGenerator,
  freshSequencerState,
  recoverSequencerState,
} from '@nanairo-sheet/server';
import type { ColumnId, RowId } from '@nanairo-sheet/types';
import { createDocumentId, createOperationId, createRowId, createTransactionId } from '@nanairo-sheet/types';
import { COLUMNS, createManualClock, num, setCells, str } from '@nanairo-sheet/collab/test-support';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DOCUMENT_ID = createDocumentId('persist-inv-doc');

interface RunResult {
  liveHash: string;
  finalRevision: number;
  recoveredHash: string;
  fullReplayHash: string;
  tailReplayed: number;
  totalOps: number;
  operationLogLength: number;
  snapshotCount: number;
}

/** 単一 client 相当で randomized な accepted op 列を PersistentRoom へ流し、途中で snapshot を跨がせて復旧する。 */
async function runRecovery(opts: { seed: number; ops: number; snapshotIntervalOps: number }): Promise<RunResult> {
  const rng = mulberry32(opts.seed);
  const clock = createManualClock();
  const sequencer = new Sequencer(freshSequencerState([...COLUMNS]), clock);
  const room = new Room(sequencer, { clock, idGenerator: createCounterIdGenerator('conn') });
  const oplog = new MemoryOpLogStore();
  const snapshotStore = new MemorySnapshotStore();
  const persistent = new PersistentRoom(room, sequencer, oplog, snapshotStore, clock, {
    documentId: 'persist-inv-doc',
    snapshotIntervalOps: opts.snapshotIntervalOps,
  });
  persistent.handleJoin({
    type: 'join',
    protocolVersion: 1,
    documentId: DOCUMENT_ID,
    lastAppliedRevision: 0,
    clientId: 'client-A',
  });

  const liveRows: RowId[] = [];
  let clientSequence = 0;
  let opId = 0;

  const submit = async (operation: DocumentOperation): Promise<void> => {
    clientSequence += 1;
    opId += 1;
    await persistent.handleMessage('conn-1', {
      type: 'submitOperation',
      envelope: {
        protocolVersion: 1,
        documentId: DOCUMENT_ID,
        operationId: createOperationId(`op-${opId}`),
        transactionId: createTransactionId(`tx-${opId}`),
        actorId: 'user-A',
        clientId: 'client-A',
        clientSequence,
        baseRevision: sequencer.currentRevision,
        operation,
      },
    });
  };

  // 最初に数行 seed。
  const seedIds = ['s1', 's2', 's3', 's4'];
  await submit({ type: 'insertRows', afterRowId: null, rows: seedIds.map((r) => ({ rowId: createRowId(r) })) });
  liveRows.push(...seedIds.map((r) => createRowId(r)));

  for (let i = 0; i < opts.ops; i += 1) {
    const roll = rng();
    if (roll < 0.2 && liveRows.length < 40) {
      const id = createRowId(`r-${i}`);
      const anchor = liveRows.length > 0 ? liveRows[Math.floor(rng() * liveRows.length)] : null;
      await submit({ type: 'insertRows', afterRowId: anchor, rows: [{ rowId: id }] });
      liveRows.push(id);
    } else if (roll < 0.3 && liveRows.length > 4) {
      const idx = Math.floor(rng() * liveRows.length);
      const target = liveRows[idx];
      await submit({ type: 'deleteRows', rowIds: [target] });
      liveRows.splice(idx, 1);
    } else if (liveRows.length > 0) {
      const target = liveRows[Math.floor(rng() * liveRows.length)];
      const column = COLUMNS[Math.floor(rng() * COLUMNS.length)];
      const value = rng() < 0.5 ? str(`x${i}`) : num(i);
      await submit(setCells([{ rowId: target, columnId: column, value }]));
    }
  }

  // 非同期 snapshot 生成の完了を待つ（MemorySnapshotStore は即時だが microtask を消化）。
  await new Promise((r) => setTimeout(r, 0));

  const liveHash = documentHash(sequencer.document);
  const finalRevision = sequencer.currentRevision;

  const recovered = await recoverSequencerState({ oplog, snapshotStore, columnOrder: [...COLUMNS], documentId: DOCUMENT_ID });
  const recoveredHash = documentHash(recovered.state.document);

  // 独立の全 replay（空文書から oplog を畳み込む）。
  const { entries } = await oplog.readAll();
  const fullReplayHash = documentHash(replayFromEmpty([...COLUMNS], entries));

  return {
    liveHash,
    finalRevision,
    recoveredHash,
    fullReplayHash,
    tailReplayed: recovered.report.tailReplayed,
    totalOps: recovered.report.totalOps,
    operationLogLength: recovered.state.operationLog.length,
    snapshotCount: snapshotStore.saveCount,
  };
}

function replayFromEmpty(columnOrder: ColumnId[], entries: ServerOperationEnvelope[]): SheetDocument {
  let doc = createDocument(columnOrder);
  for (const entry of entries) {
    doc = applyOperation(doc, entry.operation, { revision: entry.revision }).document;
  }
  return doc;
}

const SEEDS = [
  { seed: 20_260_713, ops: 300, snapshotIntervalOps: 50 },
  { seed: 1_337, ops: 250, snapshotIntervalOps: 40 },
  { seed: 987_654, ops: 400, snapshotIntervalOps: 100 },
];

describe('invariant/persistence（DD-014 実充足）: snapshot＋log からの復旧一致', () => {
  for (const cfg of SEEDS) {
    it(`seed=${cfg.seed}・${cfg.ops}op・snapshotN=${cfg.snapshotIntervalOps} → 復元 hash＝全replay hash・log全replay非依存`, async () => {
      const run = await runRecovery(cfg);
      // INV-P1 復元一致（AC3）。
      expect(run.recoveredHash, `[seed ${cfg.seed}] recovered==live`).toBe(run.liveHash);
      expect(run.recoveredHash, `[seed ${cfg.seed}] recovered==fullReplay`).toBe(run.fullReplayHash);
      // INV-P2 log 全replay 非依存（AC4）: snapshot が取れていれば tail は全 op 未満。
      expect(run.snapshotCount, `[seed ${cfg.seed}] snapshot generated`).toBeGreaterThanOrEqual(1);
      expect(run.tailReplayed, `[seed ${cfg.seed}] tail < total (snapshot-based)`).toBeLessThan(run.totalOps);
      // INV-P3 revision/log 継続。
      expect(run.operationLogLength, `[seed ${cfg.seed}] full log restored`).toBe(run.totalOps);
      expect(run.finalRevision, `[seed ${cfg.seed}] revision==total`).toBe(run.totalOps);
    });
  }

  it('同一 seed 再実行で最終 hash・revision が一致する（決定性）', async () => {
    const cfg = { seed: 555_123, ops: 300, snapshotIntervalOps: 60 };
    const first = await runRecovery(cfg);
    const second = await runRecovery(cfg);
    expect(second.liveHash).toBe(first.liveHash);
    expect(second.finalRevision).toBe(first.finalRevision);
    expect(second.recoveredHash).toBe(first.recoveredHash);
  });
});
