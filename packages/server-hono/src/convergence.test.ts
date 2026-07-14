// 🔬 Phase 5 収束試験（S-M1〜M4・AC1）: シード付き PRNG で 10,000 件のランダム Operation
// （SetCells/InsertRows/DeleteRows 混合）を 3〜10 クライアントへ流し、in-process フォールト注入
// （重複/欠落/遅延/切断再接続）を経ても静止点で全 committed が Room と一致することを検証する。
//
// 決定論: 選択（どのクライアント・どの op・どの行/列/値・いつ切断）は mulberry32(seed)、ID は決定的連番
// （operationId/transactionId=`${clientId}-op-n`・rowId=`ins-${index}-${seq}`＝D4 の再現性）、時刻は手動クロック。
// Date.now()/Math.random() は**シミュレーションに使わない**（実行時間の計測にのみ performance.now を使う＝観測）。
//
// 収束 assert（D7/D12 の具体化・全部入れる）:
//   (a) 全 Client committed hash == Room hash（AC1）
//   (b) == スナップショットのログ replay hash（verifySnapshotIntegrity）
//   (c) rowOrder/tombstone を含む構造 deep-equal（hash 盲点＝D12 対策・hash と独立の導出）
//   (d) 二重適用0（サーバーログ operationId 重複なし・revision 連番・各 Client の適用 revision 列が単調連続）
//   (e) フォールト発火カウンター > 0 を種類ごと（S-M3・「テストのための実装」化の否定）
//   (f) 自明でない invariant（非空セル>0・Insert/Delete 適用≥1・reject≥1＝S-M4）

import { performance } from 'node:perf_hooks';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { displayRowOrder, documentHash, forEachCellInRow, getCell } from '@nanairo-sheet/core';
import type {
  ClientMessage,
  ClientOperationEnvelope,
  DocumentOperation,
  SheetDocument,
} from '@nanairo-sheet/core';
import {
  Room,
  Sequencer,
  createCounterIdGenerator as createConnIdGenerator,
  freshSequencerState,
  serializeSnapshot,
  verifySnapshotIntegrity,
} from '@nanairo-sheet/server';
import { createDocumentId, createOperationId, createRowId, createTransactionId } from '@nanairo-sheet/types';
import type { ColumnId, RowId } from '@nanairo-sheet/types';
import { ClientSession, createCounterIdGenerator } from '@nanairo-sheet/collab';
import type { ClientTransport, TransportListener } from '@nanairo-sheet/collab';
import { InProcessHub } from '@nanairo-sheet/collab/inprocess-transport';
import type { FaultCounters, FaultProbabilities } from '@nanairo-sheet/collab/inprocess-transport';
import { COLUMNS, createManualClock, num, setCells, str } from '@nanairo-sheet/collab/test-support';
import type { ManualClock } from '@nanairo-sheet/collab/test-support';

import { normalizeDocument } from './doc-compare';

// ---- 決定論 PRNG（試験用・実装コードでは使わない）----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- catchup/submit を数えるトランスポート装飾（session は無変更・No-Go 計測用）----
class CountingTransport implements ClientTransport {
  catchupCount = 0;
  submitCount = 0;

  constructor(private readonly inner: ClientTransport) {}

  setListener(listener: TransportListener): void {
    this.inner.setListener(listener);
  }

  connect(): void {
    this.inner.connect();
  }

  send(message: ClientMessage): void {
    if (message.type === 'requestCatchup') {
      this.catchupCount += 1;
    } else if (message.type === 'submitOperation') {
      this.submitCount += 1;
    }
    this.inner.send(message);
  }
}

interface HarnessClient {
  clientId: string;
  index: number;
  session: ClientSession;
  transport: CountingTransport;
  rowSeq: number;
  opSeq: number;
  disconnected: boolean;
  reconnectAt: number;
}

interface HotCell {
  rowId: RowId;
  columnId: ColumnId;
}

interface ConvergenceOptions {
  seed: number;
  clientCount: number;
  opCount: number;
  faults: FaultProbabilities;
  disconnectRate: number;
  seedRows: number;
  maxRows: number;
  minLiveRows: number;
  hotCells: number;
}

interface ConvergenceMetrics {
  seed: number;
  clientCount: number;
  opCount: number;
  durationMs: number;
  opsPerSec: number;
  faults: FaultCounters;
  submittedOps: number;
  acceptedOps: number;
  insertOps: number;
  deleteOps: number;
  setOps: number;
  catchupRequests: number;
  maxPendingDepth: number;
  serverOpApplications: number; // rollback/replay 量の代理（各 Client が applied revision 数だけ replay する）
  totalConflicts: number;
  totalRejects: number;
  liveRows: number;
  tombstonedRows: number;
  nonEmptyCells: number;
  finalRevision: number;
  serverHash: string;
  quiescenceTicks: number;
}

interface ConvergenceRun {
  metrics: ConvergenceMetrics;
  clients: HarnessClient[];
  sequencer: Sequencer;
  snapshot: ReturnType<typeof serializeSnapshot>;
  converged: boolean;
}

const DOCUMENT_ID = createDocumentId('conv-doc');
const RESEND_MILLIS = 1_000;
const CATCHUP_POLL_MILLIS = 1_000;
const PUMP_ADVANCE = 2_000; // resend/catchup タイマー双方を毎 tick で満了させる（> 両閾値）
const PUMP_EVERY = 4; // 主ループの pump 間隔（小窓＝競合を生みつつ pending を有界に保つ）
const HUGE = Number.MAX_SAFE_INTEGER; // offline 上限に達しない（本試験の対象外・reconnect.test で別途検証）
const MAX_QUIESCE_TICKS = 1_000;

function isLive(doc: SheetDocument, rowId: RowId): boolean {
  const meta = doc.rowMeta.get(rowId);
  return meta !== undefined && !meta.tombstone;
}

function genInsert(client: HarnessClient, liveRows: RowId[], rng: () => number): DocumentOperation {
  const rowId = createRowId(`ins-${client.index}-${client.rowSeq}`);
  client.rowSeq += 1;
  // アンカー: 先頭(null) か view 上の生存行（committed 由来 or 自 pending＝clientSequence 順で先に処理され有効）。
  let anchor: RowId | null = null;
  if (liveRows.length > 0 && rng() >= 0.2) {
    anchor = liveRows[Math.floor(rng() * liveRows.length)];
  }
  return { type: 'insertRows', afterRowId: anchor, rows: [{ rowId }] };
}

function genDelete(liveRows: RowId[], rng: () => number): DocumentOperation | undefined {
  // 削除対象は**任意の挿入行**（`ins-` プレフィックス。seed 行は hot cell 温存のため除外）。異なる Client が
  // 同一行を並行 Delete し得る＝敗者の Delete はサーバー noop 化する（S-E4）。この敗者の acked-noop を
  // rebuildView で除去する修正（session.ts・Codex [P1]/D33）が入ったため、並行 Delete でも収束する。
  const candidates = liveRows.filter((r) => String(r).startsWith('ins-'));
  if (candidates.length === 0) {
    return undefined;
  }
  const target = candidates[Math.floor(rng() * candidates.length)];
  return { type: 'deleteRows', rowIds: [target] };
}

function generateOp(
  client: HarnessClient,
  rng: () => number,
  opts: ConvergenceOptions,
  hot: HotCell[],
): DocumentOperation | undefined {
  const session = client.session;
  const view = session.viewDocument;
  const liveRows = displayRowOrder(view);
  const totalRows = view.rowOrder.length;
  const roll = rng();

  if (liveRows.length < opts.minLiveRows && totalRows < opts.maxRows) {
    return genInsert(client, liveRows, rng); // 土台の行が足りない
  }
  if (roll < 0.15 && totalRows < opts.maxRows) {
    return genInsert(client, liveRows, rng); // doc サイズ上限まで挿入（D16 抑制）
  }
  if (roll < 0.3 && liveRows.length > opts.minLiveRows) {
    const del = genDelete(liveRows, rng);
    if (del !== undefined) {
      return del;
    }
  }
  // 完全同期（pending 0）の Client は hot cell を beforeRevision 付きで編集＝競合で server reject を誘発。
  if (session.pendingCount === 0 && hot.length > 0 && rng() < 0.5) {
    const cell = hot[Math.floor(rng() * hot.length)];
    if (isLive(view, cell.rowId)) {
      const beforeRevision = getCell(session.committedDocument, cell.rowId, cell.columnId)?.lastChangedRevision ?? 0;
      const value = str(`h${client.index}-${client.opSeq}`);
      client.opSeq += 1;
      return setCells([{ rowId: cell.rowId, columnId: cell.columnId, beforeRevision, value }]);
    }
  }
  if (liveRows.length === 0) {
    return genInsert(client, liveRows, rng);
  }
  // 通常 SetCells（beforeRevision 無し＝last-write-wins・reject しない）
  const targetRow = liveRows[Math.floor(rng() * liveRows.length)];
  const targetCol = COLUMNS[Math.floor(rng() * COLUMNS.length)];
  const value = rng() < 0.5 ? str(`v${client.index}-${client.opSeq}`) : num(client.opSeq);
  client.opSeq += 1;
  return setCells([{ rowId: targetRow, columnId: targetCol, value }]);
}

function seedServer(sequencer: Sequencer, seededRowIds: string[]): void {
  const envelope: ClientOperationEnvelope = {
    protocolVersion: 1,
    documentId: DOCUMENT_ID,
    operationId: createOperationId('seed'),
    transactionId: createTransactionId('tx-seed'),
    actorId: 'system',
    clientId: 'system',
    clientSequence: 1,
    baseRevision: 0,
    operation: { type: 'insertRows', afterRowId: null, rows: seededRowIds.map((r) => ({ rowId: createRowId(r) })) },
  };
  sequencer.submit(envelope);
}

function onlineClients(clients: HarnessClient[]): HarnessClient[] {
  return clients.filter((c) => !c.disconnected);
}

function pickOnline(clients: HarnessClient[], rng: () => number): HarnessClient | undefined {
  const online = onlineClients(clients);
  if (online.length === 0) {
    return undefined;
  }
  return online[Math.floor(rng() * online.length)];
}

function runInProcessConvergence(opts: ConvergenceOptions): ConvergenceRun {
  const startedAt = performance.now();
  const rng = mulberry32(opts.seed);
  const clock: ManualClock = createManualClock();
  const sequencer = new Sequencer(freshSequencerState(COLUMNS), clock);
  const room = new Room(sequencer, { clock, idGenerator: createConnIdGenerator('conn') });
  // フォールトは server→client（operations/operationAck）のみへ注入する（欠落→catch-up・重複→無視・
  // 遅延→リオーダーで回復する経路）。submitOperation drop（client→server）は seq gap を生み、その回復は
  // D27 の deferred 境界（violation 時の clientSequence 完全再整列）に依存するため除外する（下記 D35）。
  const hub = new InProcessHub(room, { seed: opts.seed, faults: opts.faults, injectClientToServer: false });

  const seededRowIds = Array.from({ length: opts.seedRows }, (_, i) => `seed-${i + 1}`);
  seedServer(sequencer, seededRowIds);

  const hot: HotCell[] = seededRowIds.slice(0, opts.hotCells).map((r, i) => ({
    rowId: createRowId(r),
    columnId: COLUMNS[i % COLUMNS.length],
  }));

  const clients: HarnessClient[] = [];
  for (let i = 0; i < opts.clientCount; i += 1) {
    const clientId = `c${i}`;
    const transport = new CountingTransport(hub.connect(clientId));
    const session = new ClientSession({
      clientId,
      userId: `u${i}`,
      displayName: `User${i}`,
      documentId: DOCUMENT_ID,
      columnOrder: COLUMNS,
      transport,
      clock,
      idGenerator: createCounterIdGenerator(`${clientId}-op`),
      resendTimeoutMillis: RESEND_MILLIS,
      catchupPollMillis: CATCHUP_POLL_MILLIS,
      maxOfflineMillis: HUGE,
      maxOfflinePending: HUGE,
    });
    session.start();
    clients.push({ clientId, index: i, session, transport, rowSeq: 0, opSeq: 0, disconnected: false, reconnectAt: -1 });
  }
  hub.deliverAll(); // join → welcome/operations（seed 行を全 Client へ）

  let submittedOps = 0;
  let maxPendingDepth = 0;

  // 主ループ: 1 反復 = 1 Client が 1 op を送信。PUMP_EVERY 反復ごとに配送する（この小窓の間だけ Client 群が
  // 非同期＝同一 hot cell への同時編集で競合＝reject を生む）。窓を小さく保つことで各 Client の未 ACK pending を
  // 有界に保ち（送信 1 に対し配送で回収）、queue/rebuildView の O(pending) 肥大＝O(ops²) を避ける。
  for (let i = 0; i < opts.opCount; i += 1) {
    // 1. 期限到来の再接続
    for (const client of clients) {
      if (client.disconnected && i >= client.reconnectAt) {
        hub.reconnect(client.clientId);
        client.disconnected = false;
      }
    }
    // 2. 切断（先に deliverAll で当該 Client へキュー済み reject/ack を配送してから落とす＝D27 の reject 喪失を防ぐ）
    if (onlineClients(clients).length > 1 && rng() < opts.disconnectRate) {
      const victim = pickOnline(clients, rng);
      if (victim !== undefined) {
        hub.deliverAll();
        hub.disconnect(victim.clientId);
        victim.disconnected = true;
        victim.reconnectAt = i + 2 + Math.floor(rng() * 6);
      }
    }
    // 3. online な 1 Client が op を生成・楽観適用・送信
    const actor = pickOnline(clients, rng);
    if (actor !== undefined) {
      const op = generateOp(actor, rng, opts, hot);
      if (op !== undefined) {
        actor.session.submitLocalOperation(op);
        submittedOps += 1;
      }
    }
    // 4. pending 深度サンプリング
    for (const client of clients) {
      maxPendingDepth = Math.max(maxPendingDepth, client.session.pendingCount);
    }
    // 5. 周期 pump（フォールト有効・resend/catchup を駆動）
    if (i % PUMP_EVERY === 0) {
      clock.advance(PUMP_ADVANCE);
      for (const client of clients) {
        if (!client.disconnected) {
          client.session.tick();
        }
      }
      hub.deliverAll();
    }
  }

  // ---- 静止点: フォールト無効化 → 全再接続 → pending 空＋全 hash 一致まで tick 前進（上限付き）----
  hub.disableFaults();
  for (const client of clients) {
    if (client.disconnected) {
      hub.reconnect(client.clientId);
      client.disconnected = false;
    }
  }
  let quiescenceTicks = 0;
  let converged = false;
  while (quiescenceTicks < MAX_QUIESCE_TICKS) {
    clock.advance(PUMP_ADVANCE);
    for (const client of clients) {
      client.session.tick();
    }
    hub.deliverAll();
    quiescenceTicks += 1;
    const serverHash = documentHash(sequencer.document);
    const serverRev = sequencer.currentRevision;
    if (
      clients.every(
        (c) =>
          c.session.isOnline &&
          c.session.pendingCount === 0 &&
          c.session.nextExpectedRevision === serverRev + 1 &&
          c.session.committedHash() === serverHash,
      )
    ) {
      converged = true;
      break;
    }
  }

  const durationMs = performance.now() - startedAt;
  const snapshot = serializeSnapshot(sequencer.exportState());
  const serverDoc = sequencer.document;
  const log = snapshot.operationLog;
  const liveRows = displayRowOrder(serverDoc).length;
  let nonEmptyCells = 0;
  for (const rowId of serverDoc.rowMeta.keys()) {
    forEachCellInRow(serverDoc, rowId, (_columnId, record) => {
      if (record.value.kind !== 'blank') {
        nonEmptyCells += 1;
      }
    });
  }
  const conflicts = clients.flatMap((c) => [...c.session.conflictQueue]);
  const finalRevision = sequencer.currentRevision;
  const metrics: ConvergenceMetrics = {
    seed: opts.seed,
    clientCount: opts.clientCount,
    opCount: opts.opCount,
    durationMs,
    opsPerSec: durationMs > 0 ? Math.round((opts.opCount / durationMs) * 1000) : 0,
    faults: { ...hub.counters },
    submittedOps,
    acceptedOps: log.length,
    insertOps: log.filter((e) => e.operation.type === 'insertRows').length,
    deleteOps: log.filter((e) => e.operation.type === 'deleteRows').length,
    setOps: log.filter((e) => e.operation.type === 'setCells').length,
    catchupRequests: clients.reduce((sum, c) => sum + c.transport.catchupCount, 0),
    maxPendingDepth,
    serverOpApplications: opts.clientCount * finalRevision,
    totalConflicts: conflicts.length,
    totalRejects: conflicts.filter((e) => e.reason === 'rejected').length,
    liveRows,
    tombstonedRows: serverDoc.rowOrder.length - liveRows,
    nonEmptyCells,
    finalRevision,
    serverHash: documentHash(serverDoc),
    quiescenceTicks,
  };
  return { metrics, clients, sequencer, snapshot, converged };
}

function logMetrics(label: string, m: ConvergenceMetrics): void {
  // No-Go 判断材料（ops/sec・rollback/replay 量・catch-up 回数・最大 pending 深度）を標準出力へ。
  // 失敗時はこの seed で完全再現できる（S-M1）。process.stdout.write は console.* ではない（P21 準拠）。
  process.stdout.write(
    `\n[convergence ${label}] ${JSON.stringify({
      seed: m.seed,
      clients: m.clientCount,
      ops: m.opCount,
      durationMs: Math.round(m.durationMs),
      opsPerSec: m.opsPerSec,
      accepted: m.acceptedOps,
      set: m.setOps,
      insert: m.insertOps,
      delete: m.deleteOps,
      faults: m.faults,
      catchupRequests: m.catchupRequests,
      maxPendingDepth: m.maxPendingDepth,
      serverOpApplications: m.serverOpApplications,
      conflicts: m.totalConflicts,
      rejects: m.totalRejects,
      liveRows: m.liveRows,
      tombstoned: m.tombstonedRows,
      nonEmptyCells: m.nonEmptyCells,
      finalRevision: m.finalRevision,
      quiescenceTicks: m.quiescenceTicks,
    })}\n`,
  );
}

function assertConvergence(run: ConvergenceRun): void {
  const { metrics, clients, sequencer, snapshot } = run;
  const serverDoc = sequencer.document;
  const serverHash = documentHash(serverDoc);
  const serverRev = sequencer.currentRevision;
  const serverNorm = normalizeDocument(serverDoc);

  // 静止点に到達（上限 tick 内）
  expect(run.converged, `did not reach quiescence within ${MAX_QUIESCE_TICKS} ticks`).toBe(true);

  // (a) 全 Client committed hash == Room hash（AC1）
  for (const client of clients) {
    expect(client.session.committedHash(), `client ${client.clientId} committed hash`).toBe(serverHash);
  }

  // (b) Room hash == スナップショットのログ replay hash（構築経路非依存・S-B2/S-K1）
  const integrity = verifySnapshotIntegrity(snapshot);
  expect(integrity.ok).toBe(true);
  expect(integrity.replayHash).toBe(serverHash);
  expect(integrity.documentHash).toBe(serverHash);

  // (c) 構造 deep-equal（rowOrder/tombstone/slot/全セル・hash と独立＝D12 盲点対策）
  for (const client of clients) {
    expect(normalizeDocument(client.session.committedDocument), `client ${client.clientId} structure`).toEqual(
      serverNorm,
    );
  }

  // (d) 二重適用0: サーバーログ operationId 重複なし・revision 連番・各 Client の適用 revision 列が単調連続
  const operationIds = snapshot.operationLog.map((e) => e.operationId);
  expect(new Set(operationIds).size, 'server log has no duplicate operationId').toBe(operationIds.length);
  snapshot.operationLog.forEach((envelope, index) => {
    expect(envelope.revision, 'server log revisions are contiguous 1..N').toBe(index + 1);
  });
  for (const client of clients) {
    // nextExpectedRevision === serverRev+1 は「revision 1..serverRev を各1回・連続で適用」を構造的に証明する
    // （drainBuffer は expectedRevision のみ適用し +1 で前進＝重複/欠番なく単調連続）。
    expect(client.session.nextExpectedRevision, `client ${client.clientId} applied revision sequence`).toBe(
      serverRev + 1,
    );
    expect(client.session.committedDocument.revision).toBe(serverRev);
    expect(client.session.pendingCount).toBe(0);
  }

  // (e) フォールト発火カウンター > 0（種類ごと・S-M3）
  expect(metrics.faults.duplicate, 'duplicate fault fired').toBeGreaterThan(0);
  expect(metrics.faults.drop, 'drop fault fired').toBeGreaterThan(0);
  expect(metrics.faults.delay, 'delay fault fired').toBeGreaterThan(0);
  expect(metrics.faults.disconnect, 'disconnect fault fired').toBeGreaterThan(0);

  // (f) 自明でない invariant（S-M4・全 no-op で緑にならない）
  expect(metrics.nonEmptyCells, 'non-empty cells exist').toBeGreaterThan(0);
  expect(metrics.insertOps, 'InsertRows applied at least once').toBeGreaterThanOrEqual(1);
  expect(metrics.deleteOps, 'DeleteRows applied at least once').toBeGreaterThanOrEqual(1);
  expect(metrics.totalRejects, 'at least one server reject preserved in Conflict Queue').toBeGreaterThanOrEqual(1);
}

describe('収束試験（in-process・フォールト注入・10,000 件）— AC1/S-M1〜M4', () => {
  it(
    '3 クライアント × 10,000 件（重複/欠落/遅延/切断再接続）→ 全 committed 収束・二重適用0',
    () => {
      const opts: ConvergenceOptions = {
        seed: 20_260_712,
        clientCount: 3,
        opCount: 10_000,
        faults: { duplicate: 0.15, drop: 0.15, delay: 0.2 },
        disconnectRate: 0.02,
        seedRows: 6,
        maxRows: 40,
        minLiveRows: 6,
        hotCells: 2,
      };
      const run = runInProcessConvergence(opts);
      logMetrics('3clients', run.metrics);
      try {
        assertConvergence(run);
      } catch (error) {
        process.stdout.write(`\n[CONVERGENCE FAILED] reproduce with seed=${opts.seed} clients=3 ops=10000\n`);
        throw error;
      }
    },
    120_000,
  );

  it(
    '10 クライアント × 10,000 件（重複/欠落/遅延/切断再接続）→ 全 committed 収束・二重適用0',
    () => {
      const opts: ConvergenceOptions = {
        seed: 424_242,
        clientCount: 10,
        opCount: 10_000,
        faults: { duplicate: 0.12, drop: 0.12, delay: 0.2 },
        disconnectRate: 0.02,
        seedRows: 8,
        maxRows: 48,
        minLiveRows: 8,
        hotCells: 3,
      };
      const run = runInProcessConvergence(opts);
      logMetrics('10clients', run.metrics);
      try {
        assertConvergence(run);
      } catch (error) {
        process.stdout.write(`\n[CONVERGENCE FAILED] reproduce with seed=${opts.seed} clients=10 ops=10000\n`);
        throw error;
      }
    },
    120_000,
  );

  it(
    '同一シード再実行で完全に同一の実行列・最終 hash（決定論・S-M2）',
    () => {
      const opts: ConvergenceOptions = {
        seed: 1_337,
        clientCount: 4,
        opCount: 2_500,
        faults: { duplicate: 0.15, drop: 0.15, delay: 0.2 },
        disconnectRate: 0.03,
        seedRows: 6,
        maxRows: 36,
        minLiveRows: 6,
        hotCells: 2,
      };
      const first = runInProcessConvergence(opts);
      const second = runInProcessConvergence({ ...opts });
      logMetrics('repro-1', first.metrics);
      assertConvergence(first);
      assertConvergence(second);
      // 完全再現: 最終 hash・revision・受理数・フォールト発火・catch-up 回数が一致（ID もシード由来＝D4）
      expect(second.metrics.serverHash).toBe(first.metrics.serverHash);
      expect(second.metrics.finalRevision).toBe(first.metrics.finalRevision);
      expect(second.metrics.acceptedOps).toBe(first.metrics.acceptedOps);
      expect(second.metrics.submittedOps).toBe(first.metrics.submittedOps);
      expect(second.metrics.faults).toEqual(first.metrics.faults);
      expect(second.metrics.catchupRequests).toBe(first.metrics.catchupRequests);
      expect(second.metrics.totalRejects).toBe(first.metrics.totalRejects);
    },
    120_000,
  );
});
