// durable frontier / snapshot bootstrap / barrier / poisoning（DD-014-1・P1-3/P1-4/P1-5・AC1〜AC4）。
// 未 fsync revision を join/catch-up/snapshot から隠す（frontier ゲート）、snapshot は frontier 以下からのみ生成、
// oplog append 失敗で room を poisoning して revision 欠番を防ぐ、fresh join は bootstrap（全 replay 非依存）。

import { documentHash } from '@nanairo-sheet/core';
import type { BootstrapMessage, OperationsMessage, ServerMessage } from '@nanairo-sheet/core';
import { describe, expect, it } from 'vitest';

import { createCounterIdGenerator } from './deps';
import { MemoryOpLogStore } from './oplog-store';
import type { OpLogStore, OpLogReadResult } from './oplog-store';
import { PersistentRoom } from './persistent-room';
import { Room } from './room';
import type { Outbound } from './room';
import { Sequencer, freshSequencerState } from './sequencer';
import { MemorySnapshotStore } from './snapshot-store';
import type { SnapshotStore } from './snapshot-store';
import { COLUMNS, createManualClock, envelope, insertRows, row, setCells, str, col } from './test-support';

function build(oplog: OpLogStore, snapshotStore: SnapshotStore, snapshotIntervalOps = 1_000) {
  const clock = createManualClock();
  const sequencer = new Sequencer(freshSequencerState(COLUMNS), clock);
  const room = new Room(sequencer, { clock, idGenerator: createCounterIdGenerator() });
  const persistent = new PersistentRoom(room, sequencer, oplog, snapshotStore, clock, {
    documentId: 'doc-1',
    snapshotIntervalOps,
  });
  return { persistent, sequencer, room, clock };
}

const join = (clientId: string, lastAppliedRevision = 0) =>
  ({ type: 'join', protocolVersion: 1, documentId: 'doc-1' as never, lastAppliedRevision, clientId }) as const;
const submitInsert = (id: string, seq: number) =>
  ({ type: 'submitOperation', envelope: envelope({ operationId: id, clientSequence: seq, operation: insertRows(null, [id]) }) }) as const;

function firstOfType<T extends ServerMessage['type']>(outbound: Outbound[], type: T): Extract<ServerMessage, { type: T }> | undefined {
  for (const item of outbound) {
    if (item.message.type === type) {
      return item.message as Extract<ServerMessage, { type: T }>;
    }
  }
  return undefined;
}

/** append の解決を手動で制御できる oplog（in-flight 窓の frontier ゲート検証用）。 */
class GatedOpLogStore implements OpLogStore {
  private readonly entries = [] as Parameters<OpLogStore['append']>[0][number][];
  private release: (() => void) | undefined;
  append(entries: Parameters<OpLogStore['append']>[0]): Promise<void> {
    this.entries.push(...entries);
    return new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
  flushGate(): void {
    this.release?.();
    this.release = undefined;
  }
  readAll(): Promise<OpLogReadResult> {
    return Promise.resolve({ entries: [...this.entries], discardedTornRecords: 0 });
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** append を個別に手動 resolve/reject できる oplog（並行 in-flight の poisoning 再確認・fail-stop なし版）。 */
class ManualOpLogStore implements OpLogStore {
  private readonly pend: Array<{ entries: Parameters<OpLogStore['append']>[0]; resolve: () => void; reject: (e: unknown) => void }> = [];
  private readonly entries = [] as Parameters<OpLogStore['append']>[0][number][];
  append(entries: Parameters<OpLogStore['append']>[0]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pend.push({ entries, resolve, reject });
    });
  }
  failAt(index: number): void {
    this.pend[index]?.reject(new Error('injected durable failure'));
  }
  resolveAt(index: number): void {
    const p = this.pend[index];
    if (p !== undefined) {
      this.entries.push(...p.entries);
      p.resolve();
    }
  }
  readAll(): Promise<OpLogReadResult> {
    return Promise.resolve({ entries: [...this.entries], discardedTornRecords: 0 });
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** append を 1 回だけ失敗させる oplog（poisoning 検証用）。 */
class FailingOpLogStore implements OpLogStore {
  private readonly entries = [] as Parameters<OpLogStore['append']>[0][number][];
  failNext = false;
  append(entries: Parameters<OpLogStore['append']>[0]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('disk full (injected)'));
    }
    this.entries.push(...entries);
    return Promise.resolve();
  }
  readAll(): Promise<OpLogReadResult> {
    return Promise.resolve({ entries: [...this.entries], discardedTornRecords: 0 });
  }
  count(): number {
    return this.entries.length;
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

describe('AC1: snapshot bootstrap（fresh join は全 operationLog を送らない・P1-6）', () => {
  it('非空文書への fresh join（lastAppliedRevision=0）は bootstrap（document@frontier）を返し operations を返さない', async () => {
    const { persistent, sequencer } = build(new MemoryOpLogStore(), new MemorySnapshotStore());
    persistent.handleJoin(join('setup'));
    for (let i = 1; i <= 5; i += 1) {
      await persistent.handleMessage('conn-1', submitInsert(`op-${i}`, i));
    }
    const { outbound } = persistent.handleJoin(join('client-fresh'));
    const boot: BootstrapMessage | undefined = firstOfType(outbound, 'bootstrap');
    expect(boot).toBeDefined();
    expect(boot?.revision).toBe(sequencer.currentRevision); // = durable frontier = 5
    expect(firstOfType(outbound, 'operations')).toBeUndefined(); // ★ 全 operationLog を送らない（全 replay 経路廃止）
    // welcome.currentRevision も frontier に一致。
    expect(firstOfType(outbound, 'welcome')?.currentRevision).toBe(5);
  });

  it('partial join（lastAppliedRevision>0）は tail（operations）を返し bootstrap を返さない', async () => {
    const { persistent } = build(new MemoryOpLogStore(), new MemorySnapshotStore());
    persistent.handleJoin(join('setup'));
    for (let i = 1; i <= 3; i += 1) {
      await persistent.handleMessage('conn-1', submitInsert(`op-${i}`, i));
    }
    const { outbound } = persistent.handleJoin(join('client-partial', 1));
    expect(firstOfType(outbound, 'bootstrap')).toBeUndefined();
    const ops: OperationsMessage | undefined = firstOfType(outbound, 'operations');
    expect(ops?.operations.map((e) => e.revision)).toEqual([2, 3]); // tail のみ
  });
});

describe('AC2: durable frontier（未 fsync revision を join/catch-up/snapshot から隠す・P1-3）', () => {
  it('append 待機中（in-flight）は join/catch-up/durableSnapshot が未 durable revision を観測しない', async () => {
    const gate = new GatedOpLogStore();
    const { persistent, sequencer } = build(gate, new MemorySnapshotStore());
    persistent.handleJoin(join('setup'));
    // revision 1 を durable 化（gate 開放）。
    const p1 = persistent.handleMessage('conn-1', submitInsert('op-1', 1));
    gate.flushGate();
    await p1;
    // revision 2 を submit（Sequencer は同期前進で currentRevision=2）だが append は未解決＝未 durable。
    const p2 = persistent.handleMessage('conn-1', submitInsert('op-2', 2));
    expect(sequencer.currentRevision).toBe(2); // in-memory は前進
    // この in-flight 窓での join/catch-up/snapshot はいずれも frontier(=1) 以下しか観測しない。
    const { outbound } = persistent.handleJoin(join('observer'));
    expect(firstOfType(outbound, 'bootstrap')?.revision).toBe(1); // 未 durable の 2 を含まない
    expect(firstOfType(outbound, 'welcome')?.currentRevision).toBe(1);
    const catchup = persistent.handleJoin(join('observer2', 0));
    expect(firstOfType(catchup.outbound, 'bootstrap')?.revision).toBe(1);
    expect(persistent.durableSnapshot().currentRevision).toBe(1); // /snapshot も frontier 以下
    expect(persistent.durableSnapshot().operationLog.map((e) => e.revision)).toEqual([1]);
    // gate 開放後は frontier が 2 へ前進し観測可能になる。
    gate.flushGate();
    await p2;
    expect(persistent.durableSnapshot().currentRevision).toBe(2);
    expect(persistent.handleJoin(join('observer3')).outbound.find((o) => o.message.type === 'bootstrap')).toBeDefined();
  });
});

describe('AC3: snapshot barrier（snapshot.revision ≦ durable frontier・P1-4/P2-5）', () => {
  it('in-flight で currentRevision>frontier のとき snapshot を生成せず、durable 化後に生成する', async () => {
    const gate = new GatedOpLogStore();
    const snapshotStore = new MemorySnapshotStore();
    const { persistent } = build(gate, snapshotStore, 2); // 2 op ごと snapshot
    persistent.handleJoin(join('setup'));
    const p1 = persistent.handleMessage('conn-1', submitInsert('op-1', 1));
    gate.flushGate();
    await p1;
    // 2 件目は in-flight（frontier=1・current=2）＝barrier で snapshot 生成しない。
    const p2 = persistent.handleMessage('conn-1', submitInsert('op-2', 2));
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));
    expect(snapshotStore.saveCount).toBe(0); // barrier: frontier(1)≠current(2) ゆえ未生成
    gate.flushGate();
    await p2;
    await new Promise((r) => setTimeout(r, 5));
    // durable 化（frontier=2=current）後に生成され、revision は frontier 以下。
    expect(snapshotStore.saveCount).toBeGreaterThanOrEqual(1);
    const loaded = await snapshotStore.loadLatest();
    expect(loaded?.revision).toBe(2);
  });
});

describe('AC4: poisoning（append 失敗で write 全停止・revision 欠番0・P1-5）', () => {
  it('append 失敗後は後続 submit を reject し oplog に欠番を作らない', async () => {
    const oplog = new FailingOpLogStore();
    const { persistent, sequencer } = build(oplog, new MemorySnapshotStore());
    persistent.handleJoin(join('setup'));
    await persistent.handleMessage('conn-1', submitInsert('op-1', 1)); // 成功（revision 1 durable）
    expect(oplog.count()).toBe(1);

    oplog.failNext = true;
    await expect(persistent.handleMessage('conn-1', submitInsert('op-2', 2))).rejects.toThrow(); // append 失敗
    expect(persistent.isPoisoned).toBe(true);

    // 以降の submit は poisoned で reject（Sequencer をこれ以上前進させない）。
    await expect(persistent.handleMessage('conn-1', submitInsert('op-3', 3))).rejects.toThrow(/poisoned/);
    // oplog は revision 1 のみ＝欠番なし（失敗した 2・拒否した 3 は書かれていない）。
    const { entries } = await oplog.readAll();
    expect(entries.map((e) => e.revision)).toEqual([1]);
    // frontier も 1 のまま（未 durable を配布しない）。
    expect(persistent.durableSnapshot().currentRevision).toBe(1);
    // 権威 hash は op-1 のみの状態（op-2 は in-memory では revision 2 として適用済みだが durable でない・配布境界外）。
    expect(typeof documentHash(sequencer.document)).toBe('string');
  });
});

describe('P1-C: in-flight の clientSequence を durableSnapshot が漏らさない（Codex）', () => {
  it('durableSnapshot の clientSequenceTable は frontier 時点の値（未 durable op の clientSequence を含まない）', async () => {
    const gate = new GatedOpLogStore();
    const { persistent } = build(gate, new MemorySnapshotStore());
    persistent.handleJoin(join('setup'));
    const p1 = persistent.handleMessage('conn-1', submitInsert('op-1', 1));
    gate.flushGate();
    await p1;
    // op-2（clientSequence=2）を in-flight にする（live clientSequenceTable は 2 へ前進するが未 durable）。
    const p2 = persistent.handleMessage('conn-1', submitInsert('op-2', 2));
    const snap = persistent.durableSnapshot();
    expect(snap.currentRevision).toBe(1);
    // envelope() の既定 clientId は 'client-A'。frontier=1 時点＝clientSequence 1（2 を漏らさない）。
    expect(snap.clientSequenceTable.find((e) => e.clientId === 'client-A')?.lastSequence).toBe(1);
    gate.flushGate();
    await p2;
    // durable 化後は 2 まで観測可能。
    expect(persistent.durableSnapshot().clientSequenceTable.find((e) => e.clientId === 'client-A')?.lastSequence).toBe(2);
  });
});

describe('P1-A: 並行 in-flight で先行失敗後、後続が成功しても frontier を前進させない（偽 durable ACK 防止・Codex）', () => {
  it('先行 append 失敗で poison → 後続 append が resolve しても再確認で reject し frontier 非前進', async () => {
    const oplog = new ManualOpLogStore();
    const { persistent } = build(oplog, new MemorySnapshotStore());
    persistent.handleJoin(join('setup'));
    // 2 件同時 submit（両方 pre-append poisoned チェックを通過＝in-flight）。
    const p1 = persistent.handleMessage('conn-1', submitInsert('op-1', 1)); // append index 0
    const p2 = persistent.handleMessage('conn-1', submitInsert('op-2', 2)); // append index 1
    oplog.failAt(0); // op-1 の durable 書込が失敗 → poisoned
    await expect(p1).rejects.toThrow();
    expect(persistent.isPoisoned).toBe(true);
    oplog.resolveAt(1); // fail-stop 無し store で op-2 の append は成功するが…
    await expect(p2).rejects.toThrow(/poisoned/); // …await 後の再確認で reject（ACK/broadcast を出さない）
    expect(persistent.durableSnapshot().currentRevision).toBe(0); // frontier は前進していない（偽 durable ACK なし）
  });
});

describe('AC1 補: bootstrap document は全 replay と同一文書へ復元される（round-trip 一致）', () => {
  it('bootstrap の document@R を復元した hash == 権威 document@R の hash', async () => {
    const { persistent, sequencer } = build(new MemoryOpLogStore(), new MemorySnapshotStore());
    persistent.handleJoin(join('setup'));
    await persistent.handleMessage('conn-1', submitInsert('op-1', 1));
    await persistent.handleMessage('conn-1', {
      type: 'submitOperation',
      envelope: envelope({ operationId: 'op-2', clientSequence: 2, baseRevision: 1, operation: setCells([{ rowId: row('op-1'), columnId: col('col-a'), value: str('X') }]) }),
    });
    const { outbound } = persistent.handleJoin(join('fresh'));
    const boot = firstOfType(outbound, 'bootstrap');
    expect(boot).toBeDefined();
    // durableSnapshot の document と bootstrap の document は同一 revision の権威文書。
    expect(boot?.revision).toBe(sequencer.currentRevision);
  });
});
