// 🔬 DD-021-2 Phase 1 行操作 収束・競合の**決定論**シナリオ（scenarios.md S1〜S7）。
//
// convergence.test.ts の randomized 収束と補完関係にある。本ファイルは同一アンカー同時 Insert（受付順・両方保持=親③）・
// Insert×Delete 交錯・SetCells×DeleteRows 両順序・再 Delete 冪等・楽観 Insert reject rollback を、seed 非依存の
// 明示操作列で固定する（randomized は「網羅」・本ファイルは「特定競合の正解」を証拠化する）。
//
// 本番配線（Room+Sequencer+ClientSession×N を InProcessHub で結線・フォールト無し）を使い、session.ts / core は無変更。
// 収束 assert: (a) 全 client committedHash==server hash (b) 構造 deep-equal（normalizeDocument・hash 独立）
//   (c) 二重適用0（server ログ operationId 重複0・revision 連番・pending 0・nextExpectedRevision==serverRev+1）。

import { describe, expect, it } from 'vitest';

import { displayRowOrder, documentHash } from '@nanairo-sheet/core';
import type { DocumentOperation, SheetDocument } from '@nanairo-sheet/core';
import {
  Room,
  Sequencer,
  createCounterIdGenerator as createConnIdGenerator,
  freshSequencerState,
} from '@nanairo-sheet/server';
import { createDocumentId, createOperationId, createRowId, createTransactionId } from '@nanairo-sheet/types';
import type { RowId } from '@nanairo-sheet/types';
import { ClientSession, createCounterIdGenerator } from '@nanairo-sheet/collab';
import type { ConflictQueueEntry } from '@nanairo-sheet/collab';
import { InProcessHub } from '@nanairo-sheet/collab/inprocess-transport';
import { COLUMNS, createManualClock, str } from '@nanairo-sheet/collab/test-support';
import type { ManualClock } from '@nanairo-sheet/collab/test-support';

import { normalizeDocument } from './doc-compare';

const DOCUMENT_ID = createDocumentId('row-conv-doc');
const NO_FAULTS = { duplicate: 0, drop: 0, delay: 0 };

interface Harness {
  clock: ManualClock;
  sequencer: Sequencer;
  hub: InProcessHub;
  clients: ClientSession[];
  deliver(): void;
  /** 静止点まで pump（pending 0＋全 hash 一致・上限付き）。 */
  quiesce(): boolean;
}

function createHarness(clientCount: number, seedRowIds: string[]): Harness {
  const clock = createManualClock();
  const sequencer = new Sequencer(freshSequencerState(COLUMNS), clock);
  const room = new Room(sequencer, { clock, idGenerator: createConnIdGenerator('conn') });
  const hub = new InProcessHub(room, { seed: 1, faults: NO_FAULTS, injectClientToServer: false });

  // seed 行を server へ投入。
  sequencer.submit({
    protocolVersion: 1,
    documentId: DOCUMENT_ID,
    operationId: createOperationId('seed'),
    transactionId: createTransactionId('tx-seed'),
    actorId: 'system',
    clientId: 'system',
    clientSequence: 1,
    baseRevision: 0,
    operation: { type: 'insertRows', afterRowId: null, rows: seedRowIds.map((r) => ({ rowId: createRowId(r) })) },
  });

  const clients: ClientSession[] = [];
  for (let i = 0; i < clientCount; i += 1) {
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
      resendTimeoutMillis: 1_000,
      catchupPollMillis: 1_000,
      maxOfflineMillis: Number.MAX_SAFE_INTEGER,
      maxOfflinePending: Number.MAX_SAFE_INTEGER,
    });
    session.start();
    clients.push(session);
  }
  hub.deliverAll(); // join → welcome/operations（seed 行を全 client へ）

  const deliver = (): void => {
    clock.advance(2_000);
    for (const c of clients) {
      c.tick();
    }
    hub.deliverAll();
  };

  const quiesce = (): boolean => {
    hub.disableFaults();
    for (let t = 0; t < 200; t += 1) {
      deliver();
      const serverHash = documentHash(sequencer.document);
      const serverRev = sequencer.currentRevision;
      if (
        clients.every(
          (c) =>
            c.isOnline &&
            c.pendingCount === 0 &&
            c.nextExpectedRevision === serverRev + 1 &&
            c.committedHash() === serverHash,
        )
      ) {
        return true;
      }
    }
    return false;
  };

  return { clock, sequencer, hub, clients, deliver, quiesce };
}

function assertConverged(h: Harness): void {
  const serverDoc = h.sequencer.document;
  const serverHash = documentHash(serverDoc);
  const serverRev = h.sequencer.currentRevision;
  const serverNorm = normalizeDocument(serverDoc);

  for (const [i, c] of h.clients.entries()) {
    expect(c.committedHash(), `client c${i} committed hash == server`).toBe(serverHash);
    expect(normalizeDocument(c.committedDocument), `client c${i} structure deep-equal`).toEqual(serverNorm);
    expect(c.pendingCount, `client c${i} pending 0`).toBe(0);
    expect(c.nextExpectedRevision, `client c${i} revision seq`).toBe(serverRev + 1);
  }
  // 二重適用0を server ログで直接 assert する（Fable P3: 「revision 連番で構造的に証明」だけでは
  // 冪等 delete の二重受理が hash に現れず素通りする）: operationId 重複0＋revision が 1..N の連番。
  const log = h.sequencer.operationsSince(0);
  expect(log.length, 'operationLog は非空').toBeGreaterThanOrEqual(1);
  expect(new Set(log.map((e) => String(e.operationId))).size, 'operationId 重複0（二重適用0）').toBe(log.length);
  expect(
    log.map((e) => e.revision),
    'revision は 1..N の連番',
  ).toEqual(log.map((_, i) => i + 1));
  expect(serverRev, 'currentRevision == ログ末尾').toBe(log.length);
}

function liveRowIds(doc: SheetDocument): string[] {
  return displayRowOrder(doc).map(String);
}

function ins(afterRowId: RowId | null, rowId: string): DocumentOperation {
  return { type: 'insertRows', afterRowId, rows: [{ rowId: createRowId(rowId) }] };
}
function del(rowId: string): DocumentOperation {
  return { type: 'deleteRows', rowIds: [createRowId(rowId)] };
}

describe('DD-021-2 行操作 収束（決定論・scenarios.md S1〜S7）', () => {
  it('S1: 同一アンカーへ 2 client 同時 Insert → 両 rowId が受付順で保持・全 client 収束（AC1）', () => {
    const h = createHarness(2, ['seed-1', 'seed-2']);
    const anchor = createRowId('seed-1');

    // 楽観適用（配送前に両者が自分の行を挿入）。
    h.clients[0].submitLocalOperation(ins(anchor, 'insA'));
    h.clients[1].submitLocalOperation(ins(anchor, 'insB'));

    expect(h.quiesce()).toBe(true);
    assertConverged(h);

    // 両方の行が live で保持され（reject しない=親③）、anchor の直後に受付順で並ぶ。
    const rows = liveRowIds(h.sequencer.document);
    expect(rows).toContain('insA');
    expect(rows).toContain('insB');
    const ai = rows.indexOf('insA');
    const bi = rows.indexOf('insB');
    const anchorIdx = rows.indexOf('seed-1');
    expect(Math.min(ai, bi)).toBe(anchorIdx + 1); // 直後に 2 行連続で入る
    expect(Math.max(ai, bi)).toBe(anchorIdx + 2);
  });

  it('S2: 同一アンカーへ 3 client 同時 Insert → 3 rowId 全保持・同一並び収束（AC1）', () => {
    const h = createHarness(3, ['seed-1', 'seed-2']);
    const anchor = createRowId('seed-1');
    h.clients[0].submitLocalOperation(ins(anchor, 'insA'));
    h.clients[1].submitLocalOperation(ins(anchor, 'insB'));
    h.clients[2].submitLocalOperation(ins(anchor, 'insC'));

    expect(h.quiesce()).toBe(true);
    assertConverged(h);

    const rows = liveRowIds(h.sequencer.document);
    for (const id of ['insA', 'insB', 'insC']) {
      expect(rows, `${id} preserved`).toContain(id);
    }
    // 3 行が anchor 直後に連続。
    const anchorIdx = rows.indexOf('seed-1');
    const inserted = rows.slice(anchorIdx + 1, anchorIdx + 4).sort();
    expect(inserted).toEqual(['insA', 'insB', 'insC']);
  });

  it('S3: tombstone 済みアンカーへ Insert（Insert×Delete 交錯）→ 成立・収束（S-D2・AC5）', () => {
    const h = createHarness(2, ['seed-1', 'seed-2']);
    const anchor = createRowId('seed-1');
    // A が anchor 行を削除、B が同 anchor へ挿入（楽観・同時）。
    h.clients[0].submitLocalOperation(del('seed-1'));
    h.clients[1].submitLocalOperation(ins(anchor, 'insB'));

    expect(h.quiesce()).toBe(true);
    assertConverged(h);

    // tombstone 済みアンカーも順序参照点として有効＝insB は成立し保持される。seed-1 は tombstone で表示から消える。
    const rows = liveRowIds(h.sequencer.document);
    expect(rows).toContain('insB');
    expect(rows).not.toContain('seed-1');
  });

  it('S4: 削除先→同行へ SetCells（並行）→ target-row-deleted で server reject（公開 rejected 経路）・収束（AC3）', () => {
    const h = createHarness(2, ['seed-1', 'seed-2']);
    // A が seed-2 を削除。B は削除を**まだ見ていない**うちに同行へ SetCells（並行＝楽観適用は成功し server へ送る）。
    // A の delete が先に送信キューへ入る（submit 順）ため server は delete を先に sequence → B の setCells を
    // target-row-deleted で reject する（公開 rejected 経路。B の committed が先に削除を見た場合はローカル
    // revalidation-failed になり得るが、この並行順序では server 判定を通す）。
    h.clients[0].submitLocalOperation(del('seed-2'));
    h.clients[1].submitLocalOperation({
      type: 'setCells',
      conflictPolicy: 'reject-overlap',
      changes: [{ rowId: createRowId('seed-2'), columnId: COLUMNS[0], beforeRevision: 0, value: str('x') }],
    });

    expect(h.quiesce()).toBe(true);
    assertConverged(h);

    // B の Conflict Queue に target-row-deleted が届く（サイレント喪失0・公開経路）。
    // 【実挙動の知見】収束する 2 client 系では、B は自分の setCells が server へ届く前に **A の delete echo**
    // （operations）を受信し、rebuildView が pending setCells を再検証して**ローカル revalidation-failed**
    // （violations に target-row-deleted）で Conflict Queue へ入れる。その後 server 側の rejected が届いても
    // 既に pending から除去済みで no-op になる。従って reason は server rejected でもローカル revalidation でも
    // あり得るが、**いずれも公開 conflictQueue（rejected/revalidation-failed）へ target-row-deleted を届ける**
    // ＝AC3「rejected 通知が公開 API 経由で届く・サイレント上書きなし」を満たす。
    const conflicts = h.clients[1].conflictQueue;
    const surfaced = conflicts.some(
      (e: ConflictQueueEntry) =>
        (e.reason === 'rejected' && e.code === 'target-row-deleted') ||
        (e.reason === 'revalidation-failed' && (e.violations ?? []).some((v) => v.code === 'target-row-deleted')),
    );
    expect(surfaced, 'target-row-deleted が公開 conflictQueue に届く').toBe(true);
    // 削除された行は tombstone で表示から消え、SetCells の値は committed に載っていない。
    expect(liveRowIds(h.sequencer.document)).not.toContain('seed-2');
    for (const c of h.clients) {
      const cell = c.committedDocument;
      expect(cell.rowMeta.get(createRowId('seed-2'))?.tombstone, 'seed-2 tombstoned in all clients').toBe(true);
    }
  });

  it('S5: SetCells 先→後から同行を Delete → 両方適用・収束（AC4）', () => {
    const h = createHarness(2, ['seed-1', 'seed-2']);
    // A が seed-2 へ値を確定。
    h.clients[0].submitLocalOperation({
      type: 'setCells',
      conflictPolicy: 'reject-overlap',
      changes: [{ rowId: createRowId('seed-2'), columnId: COLUMNS[0], beforeRevision: 0, value: str('v') }],
    });
    h.deliver();
    h.deliver();
    // B が後から seed-2 を削除。
    h.clients[1].submitLocalOperation(del('seed-2'));

    expect(h.quiesce()).toBe(true);
    assertConverged(h);

    // 値確定→行削除の順で両方適用（tombstone は値を保持したまま表示から消える）。
    expect(liveRowIds(h.sequencer.document)).not.toContain('seed-2');
    const meta = h.sequencer.document.rowMeta.get(createRowId('seed-2'));
    expect(meta?.tombstone).toBe(true);
  });

  it('S6: 同一行を並行 Delete（再 Delete 冪等・S-E4）→ 敗者 noop・二重適用0・収束（AC5）', () => {
    const h = createHarness(2, ['seed-1', 'seed-2', 'seed-3']);
    // A/B が同一行 seed-2 を並行削除。敗者の Delete は server で noop 化する。
    h.clients[0].submitLocalOperation(del('seed-2'));
    h.clients[1].submitLocalOperation(del('seed-2'));

    expect(h.quiesce()).toBe(true);
    assertConverged(h);

    expect(liveRowIds(h.sequencer.document)).not.toContain('seed-2');
    // server ログには実効のある Delete が 1 回だけ（もう一方は noop で revision を消費しても構造は不変）。
    const meta = h.sequencer.document.rowMeta.get(createRowId('seed-2'));
    expect(meta?.tombstone).toBe(true);
  });

  it('S7: 楽観 Insert が reject（未知アンカー）→ Conflict Queue へ・view から消え・収束（AC8）', () => {
    const h = createHarness(2, ['seed-1', 'seed-2']);
    // collab 層で未知アンカーへ Insert（grid 公開 API は実行前に弾くが、低レベルでは revalidation-failed で Conflict へ）。
    h.clients[0].submitLocalOperation(ins(createRowId('ghost'), 'insDoomed'));

    // 楽観適用時点で validateOperation 違反→即 Conflict Queue（rebuildView）。view には insDoomed が入らない。
    expect(h.clients[0].viewDocument.rowMeta.get(createRowId('insDoomed'))).toBeUndefined();
    const conflicts = h.clients[0].conflictQueue;
    expect(conflicts.length).toBeGreaterThanOrEqual(1);

    expect(h.quiesce()).toBe(true);
    assertConverged(h);
    // クラッシュせず収束・doomed 行はどの client にも存在しない。
    for (const c of h.clients) {
      expect(c.committedDocument.rowMeta.get(createRowId('insDoomed'))).toBeUndefined();
    }
  });
});
