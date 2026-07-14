// DD-015 Phase 2: Room の再接続 reconcile（join.pending → welcome.reconcile）と catch-up snapshot 再取得閾値（T=1000）を固定する。
// - reconcile: join.pending の operationId を ackCache と突合せ、受理済み集合＋処理済み clientSequence 高水位を返す。
// - 閾値: 再接続で差分>T なら tail（operations）ではなく bootstrap（snapshot@frontier）を返す（client と対称判定）。

import { describe, expect, it } from 'vitest';

import { CATCHUP_SNAPSHOT_THRESHOLD } from '@nanairo-sheet/core';
import type { BootstrapMessage, JoinMessage, OperationsMessage, ServerMessage, WelcomeMessage } from '@nanairo-sheet/core';
import { createDocumentId, createOperationId } from '@nanairo-sheet/types';
import type { OperationId } from '@nanairo-sheet/types';

import { createCounterIdGenerator } from './deps';
import { Room } from './room';
import type { Outbound } from './room';
import { Sequencer, freshSequencerState } from './sequencer';
import { COLUMNS, createManualClock, envelope, insertRows } from './test-support';

function createTestRoom(): { room: Room; sequencer: Sequencer } {
  const clock = createManualClock();
  const sequencer = new Sequencer(freshSequencerState(COLUMNS), clock);
  const room = new Room(sequencer, { clock, idGenerator: createCounterIdGenerator() });
  return { room, sequencer };
}

/** clientId から count 件の insertRows を submit（全 accepted・revision 1..count）。返り値は operationId 列。 */
function seedOps(sequencer: Sequencer, clientId: string, count: number, startSeq = 1): OperationId[] {
  const ids: OperationId[] = [];
  for (let i = 0; i < count; i += 1) {
    const seq = startSeq + i;
    const opId = `${clientId}-op-${seq}`;
    ids.push(createOperationId(opId));
    sequencer.submit(
      envelope({ operationId: opId, clientId, clientSequence: seq, baseRevision: 0, operation: insertRows(null, [`r-${clientId}-${seq}`]) }),
    );
  }
  return ids;
}

function joinMsg(o: Partial<JoinMessage> & { clientId: string }): JoinMessage {
  return {
    type: 'join',
    protocolVersion: 1,
    documentId: createDocumentId('doc-1'),
    lastAppliedRevision: o.lastAppliedRevision ?? 0,
    clientId: o.clientId,
    ...(o.pending !== undefined ? { pending: o.pending } : {}),
  };
}

function firstOfType<T extends ServerMessage['type']>(outbound: Outbound[], type: T): Extract<ServerMessage, { type: T }> | undefined {
  const item = outbound.find((o) => o.message.type === type);
  return item?.message as Extract<ServerMessage, { type: T }> | undefined;
}

describe('DD-015 Room 再接続 reconcile（join.pending → welcome.reconcile）', () => {
  it('join.pending 省略時は welcome.reconcile を付けない（legacy/fresh 後方互換）', () => {
    const { room } = createTestRoom();
    const { outbound } = room.handleJoin(joinMsg({ clientId: 'cA' }));
    const welcome = firstOfType(outbound, 'welcome') as WelcomeMessage;
    expect(welcome.reconcile).toBeUndefined();
  });

  it('join.pending 提示時は accepted 集合＋処理済み clientSequence 高水位を返す', () => {
    const { room, sequencer } = createTestRoom();
    const [opX] = seedOps(sequencer, 'cA', 1); // opX accepted（rev1・ackCache 在・seq1 消費）
    const opY = createOperationId('cA-op-2'); // 未 submit（ackCache 不在）

    const { outbound } = room.handleJoin(
      joinMsg({
        clientId: 'cA',
        lastAppliedRevision: 0,
        pending: [
          { operationId: opX, clientSequence: 1 },
          { operationId: opY, clientSequence: 2 },
        ],
      }),
    );
    const welcome = firstOfType(outbound, 'welcome') as WelcomeMessage;
    expect(welcome.reconcile).toBeDefined();
    expect(welcome.reconcile?.ackedClientSequence).toBe(1); // clientSequenceTable[cA]=1
    expect(welcome.reconcile?.acceptedOperationIds).toEqual([opX]); // opX のみ ackCache 在（opY は未処理）
  });

  it('別 client の pending は当該 client の高水位に影響しない（clientId 分離）', () => {
    const { room, sequencer } = createTestRoom();
    seedOps(sequencer, 'cA', 3); // cA seq1..3
    const { outbound } = room.handleJoin(joinMsg({ clientId: 'cB', lastAppliedRevision: 0, pending: [] }));
    const welcome = firstOfType(outbound, 'welcome') as WelcomeMessage;
    expect(welcome.reconcile?.ackedClientSequence).toBe(0); // cB は未処理（cA の 3 に引きずられない）
    expect(welcome.reconcile?.acceptedOperationIds).toEqual([]);
  });
});

describe('DD-015 Room catch-up snapshot 再取得閾値（T=1000・要確認②）', () => {
  it('定数は 1000（DD-014 snapshot 生成間隔と同値）', () => {
    expect(CATCHUP_SNAPSHOT_THRESHOLD).toBe(1_000);
  });

  it('再接続で差分==T は tail（operations）・差分==T+1 は bootstrap（snapshot 再取得）', () => {
    const { room, sequencer } = createTestRoom();
    seedOps(sequencer, 'seed', CATCHUP_SNAPSHOT_THRESHOLD + 2); // frontier = 1002

    // 差分 = 1002 - 2 = 1000 == T → tail（bootstrap ではない）
    const tail = room.handleJoin(joinMsg({ clientId: 'cA', lastAppliedRevision: 2, pending: [] })).outbound;
    expect(firstOfType(tail, 'bootstrap')).toBeUndefined();
    const ops = firstOfType(tail, 'operations') as OperationsMessage;
    expect(ops.operations).toHaveLength(1000); // rev 3..1002

    // 差分 = 1002 - 1 = 1001 > T → bootstrap（snapshot@frontier・大量差分の catch-up を回避）
    const boot = room.handleJoin(joinMsg({ clientId: 'cB', lastAppliedRevision: 1, pending: [] })).outbound;
    const bootstrap = firstOfType(boot, 'bootstrap') as BootstrapMessage;
    expect(bootstrap).toBeDefined();
    expect(bootstrap.revision).toBe(1002); // document@frontier
    expect(firstOfType(boot, 'operations')).toBeUndefined(); // tail は送らない
  });

  it('fresh join（lastAppliedRevision=0・差分≦T でも）は常に bootstrap（§8 既知制約回収・回帰）', () => {
    const { room, sequencer } = createTestRoom();
    seedOps(sequencer, 'seed', 5); // frontier=5（差分 5 ≤ T）
    const boot = room.handleJoin(joinMsg({ clientId: 'cA', lastAppliedRevision: 0 })).outbound;
    expect(firstOfType(boot, 'bootstrap')).toBeDefined(); // fresh は閾値によらず bootstrap
  });
});

describe('DD-015 Room requestCatchup は tail（operations）のみ返す（Codex 第3回 P1-a・snapshot 再取得は reconcile を伴う join 経路限定）', () => {
  it('requestCatchup は差分>閾値でも operations（tail）を返す（bootstrap にしない＝reconcile 無し phantom conflict を避ける）', () => {
    const { room, sequencer } = createTestRoom();
    seedOps(sequencer, 'seed', CATCHUP_SNAPSHOT_THRESHOLD + 2); // frontier=1002
    const { connectionId } = room.handleJoin(joinMsg({ clientId: 'cA', lastAppliedRevision: 1002 }));
    // 差分 1002-1=1001 > T でも bootstrap にせず tail（operations）を返す（reconcile 情報を伴わない snapshot 再取得を作らない）
    const out = room.handleMessage(connectionId, { type: 'requestCatchup', afterRevision: 1 });
    expect(firstOfType(out, 'bootstrap')).toBeUndefined();
    const ops = firstOfType(out, 'operations') as OperationsMessage;
    expect(ops).toBeDefined();
    expect(ops.operations).toHaveLength(1001); // rev 2..1002（incremental 適用・phantom なし）
  });
});

describe('DD-015 Room revision 連続性 fail-fast（C11・server 側判定）', () => {
  it('join.lastAppliedRevision ≦ frontier は diverged を立てない（正常）', () => {
    const { room, sequencer } = createTestRoom();
    seedOps(sequencer, 'seed', 10); // frontier=10
    const welcome = firstOfType(room.handleJoin(joinMsg({ clientId: 'cA', lastAppliedRevision: 10 })).outbound, 'welcome') as WelcomeMessage;
    expect(welcome.diverged).toBeUndefined();
  });

  it('join.lastAppliedRevision > frontier（client が権威より先＝server 巻き戻り）は diverged=true', () => {
    const { room, sequencer } = createTestRoom();
    seedOps(sequencer, 'seed', 3); // frontier=3（非永続 server が再起動で seed まで巻き戻った想定）
    const welcome = firstOfType(room.handleJoin(joinMsg({ clientId: 'cA', lastAppliedRevision: 50 })).outbound, 'welcome') as WelcomeMessage;
    expect(welcome.diverged).toBe(true); // client committed 50 > frontier 3
  });
});
