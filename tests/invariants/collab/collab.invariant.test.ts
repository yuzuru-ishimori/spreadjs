// 共同編集 不変条件スイート（§2.3 共同編集不変条件）。DD-011 設置・**実充足は DD-013**。
//
// このスイートは DD-013 で「最小 replay ケース」から「randomized 収束スイート」へ実充足された。
// 本番配線（Room＋Sequencer＋ClientSession×N を InProcessHub で結線）へ seed 付きフォールト
// （duplicate/drop/delay）を注入し、静止点で §2.3 の本DD担当不変条件（INV-1〜6）を機械検証する。
//
// スコープ（DD-013）: 「同期」のみ。reconnect/catch-up の製品保証は DD-015 ゆえ **disconnect は注入しない**
//   （既存 reconnect/catchup は packages/collab の別テストで回帰維持）。durable/snapshot 復旧は DD-014。
//   規模（要確認④確定）: 3〜5 クライアント × 500 op 以上 × 複数 seed（CI 時間を抑える）。DD-003 の
//   10,000op 級は apps/collaboration-server/test/convergence.test.ts にワンショット証跡として残す。
//
// §2.3 本DD担当不変条件（scenarios.md 対応表）:
//   INV-1 全順序 → client 最終 hash 一致（＋snapshot replay hash 一致）
//   INV-2 rollback/replay 収束（pending 0・revision 連続・構造 deep-equal）
//   INV-3 beforeRevision 不一致でサイレント上書きなし（reject 値が committed に載らない・reject≥1）
//   INV-4 reject 時に利用者入力を保持（Conflict Queue が元 operation を保持）
//   INV-5 idempotency（server ログ operationId 重複0・revision 連番・duplicate 発火>0）
//   INV-6 RowId・ColumnId 安定（構造 deep-equal＝hash 独立の導出）
import { describe, expect, it } from 'vitest';
import process from 'node:process';

import {
  applyOperation,
  createDocument,
  displayRowOrder,
  documentHash,
  forEachCellInRow,
  getCell,
} from '@nanairo-sheet/core';
import type {
  CellScalar,
  DocumentOperation,
  SetCellsOperation,
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
import type { ConflictQueueEntry } from '@nanairo-sheet/collab';
import { InProcessHub } from '@nanairo-sheet/collab/inprocess-transport';
import type { FaultProbabilities } from '@nanairo-sheet/collab/inprocess-transport';
import { COLUMNS, createManualClock, num, setCells, str } from '@nanairo-sheet/collab/test-support';
import type { ManualClock } from '@nanairo-sheet/collab/test-support';

// ---------------------------------------------------------------------------
// 最小ケース（DD-011 設置時の形骸チェックを回帰として残す）
// ---------------------------------------------------------------------------

/** 全順序ログを空文書へ畳み込む（revision はサーバー付与＝1..n）。 */
function replay(log: DocumentOperation[]): SheetDocument {
  let doc = createDocument([...COLUMNS]);
  let revision = 0;
  for (const op of log) {
    revision += 1;
    doc = applyOperation(doc, op, { revision }).document;
  }
  return doc;
}

describe('invariant/collab（最小・回帰）: 全順序 → hash 一致・決定論', () => {
  const orderedLog: DocumentOperation[] = [
    { type: 'insertRows', afterRowId: null, rows: [{ rowId: createRowId('r1') }] },
    { type: 'insertRows', afterRowId: createRowId('r1'), rows: [{ rowId: createRowId('r2') }] },
    setCells([{ rowId: createRowId('r1'), columnId: COLUMNS[0], value: str('あ') }]),
    setCells([{ rowId: createRowId('r2'), columnId: COLUMNS[1], value: str('い') }]),
    setCells([{ rowId: createRowId('r1'), columnId: COLUMNS[0], value: str('あ2') }]),
  ];

  it('同一の全順序ログを独立2ドキュメントへ replay すると canonical hash が一致する', () => {
    expect(documentHash(replay(orderedLog))).toBe(documentHash(replay(orderedLog)));
  });
});

// ---------------------------------------------------------------------------
// randomized 収束ハーネス（DD-013 実充足）
//
// 本番配線を使う（session.ts 本体は無変更）。決定論: 選択は mulberry32(seed)、ID は決定的連番、
// 時刻は手動クロック。Date.now()/Math.random() はシミュレーションに使わない（再現性）。
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DOCUMENT_ID = createDocumentId('collab-inv-doc');
const RESEND_MILLIS = 1_000;
const CATCHUP_POLL_MILLIS = 1_000;
const PUMP_ADVANCE = 2_000; // resend/catchup タイマー双方を毎 pump で満了させる（> 両閾値）
const PUMP_EVERY = 4; // 主ループの pump 間隔（小窓＝競合を生みつつ pending を有界に保つ）
const HUGE = Number.MAX_SAFE_INTEGER;
const MAX_QUIESCE_TICKS = 1_000;

interface HotCell {
  rowId: RowId;
  columnId: ColumnId;
}

interface Client {
  clientId: string;
  index: number;
  session: ClientSession;
  rowSeq: number;
  opSeq: number;
}

interface RunOptions {
  seed: number;
  clientCount: number;
  opCount: number;
  faults: FaultProbabilities;
  seedRows: number;
  maxRows: number;
  minLiveRows: number;
  hotCells: number;
}

interface RunResult {
  clients: Client[];
  sequencer: Sequencer;
  snapshot: ReturnType<typeof serializeSnapshot>;
  converged: boolean;
  quiescenceTicks: number;
  faultCounters: { duplicate: number; drop: number; delay: number; disconnect: number };
  submittedOps: number;
  setOps: number;
  insertOps: number;
  deleteOps: number;
  nonEmptyCells: number;
  rejects: ConflictQueueEntry[];
  occAttemptIds: Set<string>; // OCC 競合狙いで submit した op の operationId（INV-3 追跡）
  submittedOpById: Map<string, DocumentOperation>; // operationId → submit した元 op のクローン（INV-4 照合）
  acceptedIds: Set<string>; // server ログに accepted された operationId
  operationLogDigest: string; // 全順序ログの決定的ダイジェスト（INV 決定性の trace 比較）
  serverHash: string;
  finalRevision: number;
}

function isLive(doc: SheetDocument, rowId: RowId): boolean {
  const meta = doc.rowMeta.get(rowId);
  return meta !== undefined && !meta.tombstone;
}

function genInsert(client: Client, liveRows: RowId[], rng: () => number): DocumentOperation {
  const rowId = createRowId(`ins-${client.index}-${client.rowSeq}`);
  client.rowSeq += 1;
  let anchor: RowId | null = null;
  if (liveRows.length > 0 && rng() >= 0.2) {
    anchor = liveRows[Math.floor(rng() * liveRows.length)];
  }
  return { type: 'insertRows', afterRowId: anchor, rows: [{ rowId }] };
}

function genDelete(liveRows: RowId[], rng: () => number): DocumentOperation | undefined {
  const candidates = liveRows.filter((r) => String(r).startsWith('ins-'));
  if (candidates.length === 0) {
    return undefined;
  }
  const target = candidates[Math.floor(rng() * candidates.length)];
  return { type: 'deleteRows', rowIds: [target] };
}

/** 生成された op。`occAttempt=true` は hot cell を beforeRevision 付きで編集した OCC 競合狙い（INV-3 の追跡対象）。 */
interface GeneratedOp {
  op: DocumentOperation;
  occAttempt: boolean;
}

/**
 * 1 op を生成する。SetCells 中心＋InsertRows/DeleteRows 混合（要確認①: 行操作は混合するが競合仕様は保証外）。
 * pending 0（完全同期）の client は hot cell を beforeRevision 付きで編集 → OCC reject を誘発する
 * （INV-3「サイレント上書きなし」を実際に発火させるため）。occAttempt フラグで OCC 狙いの op を追跡する。
 */
function generateOp(client: Client, rng: () => number, opts: RunOptions, hot: HotCell[]): GeneratedOp | undefined {
  const session = client.session;
  const view = session.viewDocument;
  const liveRows = displayRowOrder(view);
  const totalRows = view.rowOrder.length;
  const roll = rng();

  if (liveRows.length < opts.minLiveRows && totalRows < opts.maxRows) {
    return { op: genInsert(client, liveRows, rng), occAttempt: false };
  }
  if (roll < 0.15 && totalRows < opts.maxRows) {
    return { op: genInsert(client, liveRows, rng), occAttempt: false };
  }
  if (roll < 0.3 && liveRows.length > opts.minLiveRows) {
    const del = genDelete(liveRows, rng);
    if (del !== undefined) {
      return { op: del, occAttempt: false };
    }
  }
  // 完全同期の client のみ hot cell を beforeRevision 付きで編集＝競合で server reject を誘発。
  if (session.pendingCount === 0 && hot.length > 0 && rng() < 0.5) {
    const cell = hot[Math.floor(rng() * hot.length)];
    if (isLive(view, cell.rowId)) {
      const beforeRevision = getCell(session.committedDocument, cell.rowId, cell.columnId)?.lastChangedRevision ?? 0;
      const value = str(`h${client.index}-${client.opSeq}`);
      client.opSeq += 1;
      return { op: setCells([{ rowId: cell.rowId, columnId: cell.columnId, beforeRevision, value }]), occAttempt: true };
    }
  }
  if (liveRows.length === 0) {
    return { op: genInsert(client, liveRows, rng), occAttempt: false };
  }
  const targetRow = liveRows[Math.floor(rng() * liveRows.length)];
  const targetCol = COLUMNS[Math.floor(rng() * COLUMNS.length)];
  const value = rng() < 0.5 ? str(`v${client.index}-${client.opSeq}`) : num(client.opSeq);
  client.opSeq += 1;
  return { op: setCells([{ rowId: targetRow, columnId: targetCol, value }]), occAttempt: false };
}

function seedServer(sequencer: Sequencer, seededRowIds: string[]): void {
  sequencer.submit({
    protocolVersion: 1,
    documentId: DOCUMENT_ID,
    operationId: createOperationId('seed'),
    transactionId: createTransactionId('tx-seed'),
    actorId: 'system',
    clientId: 'system',
    clientSequence: 1,
    baseRevision: 0,
    operation: { type: 'insertRows', afterRowId: null, rows: seededRowIds.map((r) => ({ rowId: createRowId(r) })) },
  });
}

function runConvergence(opts: RunOptions): RunResult {
  const rng = mulberry32(opts.seed);
  const clock: ManualClock = createManualClock();
  const sequencer = new Sequencer(freshSequencerState(COLUMNS), clock);
  const room = new Room(sequencer, { clock, idGenerator: createConnIdGenerator('conn') });
  // フォールトは server→client（operations/operationAck）のみへ注入する（欠落→catch-up・重複→無視・
  // 遅延→リオーダーで回復する経路）。submitOperation drop（client→server）は seq gap を生み reconnect
  // 経路（DD-015 スコープ）に依存するため注入しない。
  const hub = new InProcessHub(room, { seed: opts.seed, faults: opts.faults, injectClientToServer: false });

  const seededRowIds = Array.from({ length: opts.seedRows }, (_, i) => `seed-${i + 1}`);
  seedServer(sequencer, seededRowIds);

  const hot: HotCell[] = seededRowIds.slice(0, opts.hotCells).map((r, i) => ({
    rowId: createRowId(r),
    columnId: COLUMNS[i % COLUMNS.length],
  }));

  const clients: Client[] = [];
  for (let i = 0; i < opts.clientCount; i += 1) {
    const clientId = `c${i}`;
    const session = new ClientSession({
      clientId,
      userId: `u${i}`,
      displayName: `User${i}`,
      documentId: DOCUMENT_ID,
      columnOrder: COLUMNS,
      transport: hub.connect(clientId),
      clock,
      idGenerator: createCounterIdGenerator(`${clientId}-op`),
      resendTimeoutMillis: RESEND_MILLIS,
      catchupPollMillis: CATCHUP_POLL_MILLIS,
      maxOfflineMillis: HUGE,
      maxOfflinePending: HUGE,
    });
    session.start();
    clients.push({ clientId, index: i, session, rowSeq: 0, opSeq: 0 });
  }
  hub.deliverAll(); // join → welcome/operations（seed 行を全 client へ）

  let submittedOps = 0;
  const occAttemptIds = new Set<string>();
  const submittedOpById = new Map<string, DocumentOperation>();
  for (let i = 0; i < opts.opCount; i += 1) {
    const actor = clients[Math.floor(rng() * clients.length)];
    const generated = generateOp(actor, rng, opts, hot);
    if (generated !== undefined) {
      const operationId = actor.session.submitLocalOperation(generated.op);
      submittedOps += 1;
      // 元 op を JSON クローンで保存（INV-4: conflict entry が元値を保持しているかの照合基準・深いコピー検証）。
      submittedOpById.set(String(operationId), cloneOp(generated.op));
      if (generated.occAttempt) {
        occAttemptIds.add(String(operationId));
      }
    }
    if (i % PUMP_EVERY === 0) {
      clock.advance(PUMP_ADVANCE);
      for (const client of clients) {
        client.session.tick();
      }
      hub.deliverAll();
    }
  }

  // 静止点: フォールト無効化 → pending 空＋全 hash 一致まで tick 前進（上限付き）。
  hub.disableFaults();
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

  const snapshot = serializeSnapshot(sequencer.exportState());
  const serverDoc = sequencer.document;
  const log = snapshot.operationLog;
  let nonEmptyCells = 0;
  for (const rowId of serverDoc.rowMeta.keys()) {
    forEachCellInRow(serverDoc, rowId, (_columnId, record) => {
      if (record.value.kind !== 'blank') {
        nonEmptyCells += 1;
      }
    });
  }
  const rejects = clients.flatMap((c) => c.session.conflictQueue.filter((e) => e.reason === 'rejected'));
  const acceptedIds = new Set(log.map((e) => String(e.operationId)));
  // 全順序ログの決定的ダイジェスト（revision→operationId→operation。event trace の再現性照合・Codex P2）。
  const operationLogDigest = JSON.stringify(
    log.map((e) => ({ revision: e.revision, operationId: String(e.operationId), operation: e.operation })),
  );

  return {
    clients,
    sequencer,
    snapshot,
    converged,
    quiescenceTicks,
    faultCounters: { ...hub.counters },
    submittedOps,
    setOps: log.filter((e) => e.operation.type === 'setCells').length,
    insertOps: log.filter((e) => e.operation.type === 'insertRows').length,
    deleteOps: log.filter((e) => e.operation.type === 'deleteRows').length,
    nonEmptyCells,
    rejects,
    occAttemptIds,
    submittedOpById,
    acceptedIds,
    operationLogDigest,
    serverHash: documentHash(serverDoc),
    finalRevision: sequencer.currentRevision,
  };
}

/** DocumentOperation の JSON 深いコピー（元入力の保全確認用・INV-4 の照合基準）。 */
function cloneOp(op: DocumentOperation): DocumentOperation {
  return JSON.parse(JSON.stringify(op)) as DocumentOperation;
}

// ---- hash 非依存の構造正規化（INV-6・RowId/ColumnId 安定を hash と独立に検出）----
interface NormalizedCell {
  rowId: string;
  columnId: string;
  value: CellScalar;
  lastChangedRevision: number;
}
interface NormalizedDoc {
  revision: number;
  columnOrder: string[];
  rowOrder: string[];
  rowMeta: Array<{ id: string; slot: number; tombstone: boolean; lastChangedRevision: number }>;
  orphanRowMeta: string[]; // rowOrder に無い rowMeta キー（孤児メタ・Codex P2: hash 盲点を独立検出）
  cells: NormalizedCell[];
}
function normalize(doc: SheetDocument): NormalizedDoc {
  // rowMeta は rowOrder ではなく **全キー**を列挙する（rollback/replay が rowOrder から外れた孤児メタを
  // 残しても documentHash は無視するため、hash と独立に構造差を検出する・Codex P2）。
  const rowOrderSet = new Set(doc.rowOrder.map(String));
  const rowMeta = [...doc.rowMeta.keys()]
    .map(String)
    .sort()
    .map((id) => {
      const meta = doc.rowMeta.get(createRowId(id));
      return {
        id,
        slot: meta?.slot ?? -1,
        tombstone: meta?.tombstone ?? false,
        lastChangedRevision: meta?.lastChangedRevision ?? -1,
      };
    });
  const orphanRowMeta = rowMeta.map((m) => m.id).filter((id) => !rowOrderSet.has(id));
  const cells: NormalizedCell[] = [];
  for (const rowId of doc.rowOrder) {
    for (const columnId of doc.columnOrder) {
      const record = getCell(doc, rowId, columnId);
      if (record === undefined) {
        continue;
      }
      cells.push({ rowId: String(rowId), columnId: String(columnId), value: record.value, lastChangedRevision: record.lastChangedRevision });
    }
  }
  return {
    revision: doc.revision,
    columnOrder: doc.columnOrder.map(String),
    rowOrder: doc.rowOrder.map(String),
    rowMeta,
    orphanRowMeta,
    cells,
  };
}

/** reject された setCells の値が server committed に載っていないこと（サイレント上書きなし・INV-3）。 */
function rejectedValueNotInCommitted(reject: ConflictQueueEntry, serverDoc: SheetDocument): boolean {
  if (reject.operation.type !== 'setCells') {
    return true; // 行操作 reject は本判定の対象外（要確認①: 行操作競合は保証外）
  }
  const setOp: SetCellsOperation = reject.operation;
  for (const change of setOp.changes) {
    const record = getCell(serverDoc, change.rowId, change.columnId);
    if (record !== undefined && sameScalar(record.value, change.value)) {
      // reject された値が確定文書に載っている＝サイレント上書きの疑い。
      // ただし別 client が偶然同値を先着確定した可能性は hot cell 値がユニーク（`h{index}-{opSeq}`）なので排除される。
      return false;
    }
  }
  return true;
}

function sameScalar(a: CellScalar, b: CellScalar): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- §2.3 不変条件 assert（scenarios.md INV-1〜6・meta）----
function assertInvariants(label: string, run: RunResult): void {
  const serverDoc = run.sequencer.document;
  const serverHash = documentHash(serverDoc);
  const serverRev = run.sequencer.currentRevision;
  const serverNorm = normalize(serverDoc);

  // 静止点に到達（上限 tick 内）
  expect(run.converged, `[${label}] did not reach quiescence within ${MAX_QUIESCE_TICKS} ticks`).toBe(true);

  // INV-1: 全 client committed hash == server hash ＋ snapshot replay hash 一致
  for (const client of run.clients) {
    expect(client.session.committedHash(), `[${label}] INV-1 client ${client.clientId} hash`).toBe(serverHash);
  }
  const integrity = verifySnapshotIntegrity(run.snapshot);
  expect(integrity.ok, `[${label}] INV-1 snapshot integrity`).toBe(true);
  expect(integrity.replayHash, `[${label}] INV-1 snapshot replay hash`).toBe(serverHash);

  // INV-2: rollback/replay 収束（pending 0・revision 連続）
  for (const client of run.clients) {
    expect(client.session.pendingCount, `[${label}] INV-2 client ${client.clientId} pending`).toBe(0);
    expect(client.session.nextExpectedRevision, `[${label}] INV-2 client ${client.clientId} revision seq`).toBe(serverRev + 1);
  }

  // INV-6: RowId/ColumnId 安定（構造 deep-equal＝hash 独立の導出）
  for (const client of run.clients) {
    expect(normalize(client.session.committedDocument), `[${label}] INV-6 client ${client.clientId} structure`).toEqual(serverNorm);
  }

  // INV-5: idempotency（二重適用0）
  const operationIds = run.snapshot.operationLog.map((e) => e.operationId);
  expect(new Set(operationIds).size, `[${label}] INV-5 no duplicate operationId in server log`).toBe(operationIds.length);
  run.snapshot.operationLog.forEach((envelope, index) => {
    expect(envelope.revision, `[${label}] INV-5 contiguous revisions`).toBe(index + 1);
  });
  expect(run.faultCounters.duplicate, `[${label}] INV-5 duplicate fault fired`).toBeGreaterThan(0);

  // INV-3: サイレント上書きなし（Codex P1 反映で強化）。
  // (a) 意図的に生成した OCC 競合（hot cell beforeRevision 編集）のうち**少なくとも1件が
  //     stale-cell-revision で reject**されている＝OCC 照合が実際に効いている。stale 照合が
  //     regress（黙殺 accept）すると occ-stale reject が 0 になり本 assert が落ちる（他の reject 混入では緑化しない）。
  const occStaleRejects = run.rejects.filter(
    (r) => run.occAttemptIds.has(String(r.operationId)) && r.code === 'stale-cell-revision',
  );
  expect(occStaleRejects.length, `[${label}] INV-3(a) an intentional OCC attempt was rejected with stale-cell-revision`).toBeGreaterThanOrEqual(1);
  // (b) reject された OCC 狙い op は server 確定ログに accepted されていない（黙って適用されていない）。
  for (const reject of run.rejects) {
    if (run.occAttemptIds.has(String(reject.operationId))) {
      expect(run.acceptedIds.has(String(reject.operationId)), `[${label}] INV-3(b) rejected OCC op not in accepted log (${reject.operationId})`).toBe(false);
    }
  }
  // (c) reject された setCells の値が committed に載っていない（最終文書からの独立確認）。
  for (const reject of run.rejects) {
    expect(rejectedValueNotInCommitted(reject, serverDoc), `[${label}] INV-3(c) rejected value not silently applied (op ${reject.operationId})`).toBe(true);
  }

  // INV-4: reject 時に利用者入力を保持（Codex P2 反映）。Conflict Queue の operation が
  // **submit した元 op と厳密に一致**する（切り詰め・別 op すり替えを検出。makeConflictEntry の深いコピーが
  // 元値を欠落なく保全していることを、記録した submit 元 op（JSON クローン）との deep-equal で照合）。
  for (const reject of run.rejects) {
    const original = run.submittedOpById.get(String(reject.operationId));
    expect(original, `[${label}] INV-4 conflict op has recorded original (${reject.operationId})`).toBeDefined();
    expect(reject.operation, `[${label}] INV-4 conflict retains exact original operation (${reject.operationId})`).toEqual(original);
  }

  // meta: フォールト実発火・非自明（「通るように書いたテスト」の否定・DA）
  expect(run.faultCounters.drop, `[${label}] meta drop fault fired`).toBeGreaterThan(0);
  expect(run.faultCounters.delay, `[${label}] meta delay fault fired`).toBeGreaterThan(0);
  expect(run.nonEmptyCells, `[${label}] meta non-empty cells exist`).toBeGreaterThan(0);
  expect(run.insertOps, `[${label}] meta InsertRows applied`).toBeGreaterThanOrEqual(1);
  expect(run.deleteOps, `[${label}] meta DeleteRows applied`).toBeGreaterThanOrEqual(1);
}

function logConvergence(label: string, run: RunResult, seed: number, clients: number, ops: number): void {
  process.stdout.write(
    `\n[collab-invariant ${label}] ${JSON.stringify({
      seed,
      clients,
      ops,
      accepted: run.snapshot.operationLog.length,
      set: run.setOps,
      insert: run.insertOps,
      delete: run.deleteOps,
      faults: run.faultCounters,
      rejects: run.rejects.length,
      nonEmptyCells: run.nonEmptyCells,
      finalRevision: run.finalRevision,
      serverHash: run.serverHash,
      quiescenceTicks: run.quiescenceTicks,
    })}\n`,
  );
}

// ---------------------------------------------------------------------------
// randomized 収束（3〜5 クライアント × 500op 以上 × 複数 seed・要確認④）
// ---------------------------------------------------------------------------
const SEEDS: Array<{ seed: number; clientCount: number; opCount: number }> = [
  { seed: 20_260_713, clientCount: 3, opCount: 600 },
  { seed: 1_337, clientCount: 4, opCount: 600 },
  { seed: 987_654, clientCount: 5, opCount: 500 },
  { seed: 424_242, clientCount: 4, opCount: 800 },
];

describe('invariant/collab（DD-013 実充足）: randomized 収束・§2.3 不変条件 INV-1〜6', () => {
  for (const { seed, clientCount, opCount } of SEEDS) {
    it(
      `seed=${seed}・${clientCount}クライアント×${opCount}op（duplicate/drop/delay 注入）→ 全 client 収束・サイレント上書き0`,
      () => {
        const opts: RunOptions = {
          seed,
          clientCount,
          opCount,
          faults: { duplicate: 0.15, drop: 0.15, delay: 0.2 },
          seedRows: 6,
          maxRows: 36,
          minLiveRows: 6,
          hotCells: 3,
        };
        const run = runConvergence(opts);
        logConvergence(`seed-${seed}`, run, seed, clientCount, opCount);
        try {
          assertInvariants(`seed-${seed}`, run);
        } catch (error) {
          process.stdout.write(
            `\n[COLLAB-INVARIANT FAILED] reproduce with: seed=${seed} clients=${clientCount} ops=${opCount}\n`,
          );
          throw error;
        }
      },
      120_000,
    );
  }

  it('同一 seed 再実行で完全に同一の最終 hash・受理数・reject 数（決定論・再現性）', () => {
    const opts: RunOptions = {
      seed: 555_123,
      clientCount: 4,
      opCount: 500,
      faults: { duplicate: 0.15, drop: 0.15, delay: 0.2 },
      seedRows: 6,
      maxRows: 36,
      minLiveRows: 6,
      hotCells: 3,
    };
    const first = runConvergence(opts);
    const second = runConvergence({ ...opts });
    assertInvariants('determinism-1', first);
    assertInvariants('determinism-2', second);
    // 全順序ログの trace（revision→operationId→operation）まで一致＝報告 seed が失敗系列を厳密再現する
    // （集計値一致だけでは別順序で同一集計になり得る・Codex P2）。
    expect(second.operationLogDigest, 'operation log trace matches (seed reproducibility)').toBe(first.operationLogDigest);
    // conflict の identity（operationId＋reason＋code）も一致。
    const conflictIds = (run: RunResult): string[] =>
      run.rejects.map((r) => `${String(r.operationId)}|${r.reason}|${r.code ?? ''}`).sort();
    expect(conflictIds(second)).toEqual(conflictIds(first));
    expect(second.serverHash).toBe(first.serverHash);
    expect(second.finalRevision).toBe(first.finalRevision);
    expect(second.faultCounters).toEqual(first.faultCounters);
  });
});
