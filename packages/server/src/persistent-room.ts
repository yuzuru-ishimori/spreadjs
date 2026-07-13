// 永続化 Room（DD-014・CG-3）。純粋な Room/Sequencer（同期・トランスポート非依存）に **durable 境界** と
// **snapshot 生成/再起動復旧** を合成する。DD-013（同期）と描画・IME には触れない。
//
// durable ACK 契約（要確認②確定）: submitOperation が accepted のとき、**oplog append（fsync）完了後に** ACK/broadcast を
//   dispatch する（＝「ACK 受領＝再起動後も失われない」）。submit 自体（revision 割当）は同期ゆえ順序は到着順で確定する。
// 再起動復旧（要確認④）: 最新 snapshot（document@R）を読み、oplog の tail（revision>R）だけ replay ＝ O(tail)。
//   snapshot 無しは oplog 全 replay（DD-006 の 14分経路・snapshot が無い縮退時のみ）。
// snapshot 生成（要確認③）: 前回から N=1,000 accepted op ごとに非同期生成。保持 K=2 世代。log 切詰めなし（正本保全）。

import { replayAcceptedOperations } from '@nanairo-sheet/core';
import type { ClientMessageExceptJoin, ServerOperationEnvelope } from '@nanairo-sheet/core';
import type { ColumnId } from '@nanairo-sheet/types';

import type { Clock } from './deps';
import type { OpLogStore } from './oplog-store';
import type { Outbound, Room } from './room';
import { Sequencer, freshSequencerState } from './sequencer';
import type { SequencerState } from './sequencer';
import { serializeSnapshot, deserializeSnapshot } from './snapshot';
import { createPersistedSnapshot } from './snapshot-store';
import type { SnapshotStore } from './snapshot-store';

/** 再起動復旧の内訳（Evidence・性能測定用）。 */
export interface RecoveryReport {
  fromSnapshotRevision: number | undefined; // snapshot を使えば R、無ければ undefined（全 replay）
  totalOps: number; // oplog 全 operation 数（= 最終 revision N）
  tailReplayed: number; // 実際に replay した tail op 数（O(tail)。snapshot 無し時は N）
  discardedTornRecords: number; // 末尾 torn write の破棄件数
}

export interface RecoveryResult {
  state: SequencerState;
  report: RecoveryReport;
}

/**
 * snapshot＋oplog から Sequencer 状態を復元する（再起動復旧・§8「snapshotベース初期化」回収）。
 * - snapshot 有: document@R を起点に oplog tail（revision>R）のみ replay（O(tail)・14分経路を排除）。
 * - snapshot 無: oplog を空文書から全 replay（縮退・snapshot 生成前のみ）。
 * - fail-fast（AC6）: oplog の revision 連番違反・snapshot が oplog より先（R>N）・snapshot 参照 op 欠落を throw。
 */
export async function recoverSequencerState(opts: {
  oplog: OpLogStore;
  snapshotStore: SnapshotStore;
  columnOrder: ColumnId[];
}): Promise<RecoveryResult> {
  const persisted = await opts.snapshotStore.loadLatest(); // 破損なら throw（fail-fast）
  const { entries, discardedTornRecords } = await opts.oplog.readAll();

  // oplog は accepted のみ・revision 消費ゆえ 1..N 連番でなければ破損（fail-fast・AC6）。
  entries.forEach((entry, index) => {
    if (entry.revision !== index + 1) {
      throw new Error(
        `recoverSequencerState: oplog revision 不連続（index ${index} で revision ${entry.revision}・破損）`,
      );
    }
  });
  const totalOps = entries.length;

  if (persisted === undefined) {
    // snapshot 無し: 空文書から全 replay（縮退経路）。in-place batch replay で op ごとの full clone を避ける（O(N²) 回避）。
    const state = freshSequencerState(opts.columnOrder);
    state.document = replayAcceptedOperations(state.document, entries);
    updateAuxFromOps(state, entries);
    state.currentRevision = totalOps;
    state.operationLog = [...entries];
    return {
      state,
      report: { fromSnapshotRevision: undefined, totalOps, tailReplayed: totalOps, discardedTornRecords },
    };
  }

  const base = deserializeSnapshot(persisted.snapshot); // document@R・aux@R（operationLog は空・owned＝破壊可）
  const snapshotRevision = persisted.revision;
  if (snapshotRevision > totalOps) {
    throw new Error(
      `recoverSequencerState: snapshot revision ${snapshotRevision} が oplog 長 ${totalOps} を超過（破損・snapshot が log より先）`,
    );
  }
  // document@R を起点に tail（revision>R）だけ **in-place** replay（clone 1 回＝O(tail)・14分経路排除・AC4/AC5）。
  // log 全体は catch-up 供給のため in-memory へ復元する。
  const tail = entries.slice(snapshotRevision); // revision R+1..N
  const document = replayAcceptedOperations(base.document, tail);
  updateAuxFromOps(base, tail);
  const state: SequencerState = {
    document,
    operationLog: [...entries],
    currentRevision: totalOps,
    ackCache: base.ackCache,
    clientSequenceTable: base.clientSequenceTable,
  };
  return {
    state,
    report: {
      fromSnapshotRevision: snapshotRevision,
      totalOps,
      tailReplayed: tail.length,
      discardedTornRecords,
    },
  };
}

/** accepted op 列から ackCache/clientSequenceTable を前進させる（document は replayAcceptedOperations が担当）。 */
function updateAuxFromOps(
  target: Pick<SequencerState, 'ackCache' | 'clientSequenceTable'>,
  ops: readonly ServerOperationEnvelope[],
): void {
  for (const env of ops) {
    target.ackCache.set(env.operationId, env.revision);
    target.clientSequenceTable.set(env.clientId, env.clientSequence);
  }
}

/** 復元済み Sequencer を作るヘルパー（app 層が Room 構築に使う）。 */
export function createRecoveredSequencer(state: SequencerState, clock: Clock): Sequencer {
  return new Sequencer(state, clock);
}

export interface PersistentRoomOptions {
  documentId: string;
  snapshotIntervalOps?: number; // 既定 1,000（要確認③）
}

const DEFAULT_SNAPSHOT_INTERVAL = 1_000;

/**
 * Room に durable ACK 境界と snapshot 生成を合成する。RoomBridge（transport）は本クラスを Room と同じ形で駆動できる
 * （handleJoin/handleDisconnect/sweep/activeConnectionIds は同期委譲、handleMessage は submit のみ durable のため Promise）。
 */
export class PersistentRoom {
  private readonly snapshotIntervalOps: number;
  private opsSinceSnapshot = 0;
  private snapshotInProgress = false;
  private lastSnapshotError: unknown;

  constructor(
    private readonly room: Room,
    private readonly sequencer: Sequencer,
    private readonly oplog: OpLogStore,
    private readonly snapshotStore: SnapshotStore,
    private readonly clock: Clock,
    private readonly options: PersistentRoomOptions,
  ) {
    this.snapshotIntervalOps = options.snapshotIntervalOps ?? DEFAULT_SNAPSHOT_INTERVAL;
  }

  handleJoin(join: Parameters<Room['handleJoin']>[0]): ReturnType<Room['handleJoin']> {
    return this.room.handleJoin(join);
  }

  /**
   * submit のみ durable 境界を挟む（oplog append=fsync 完了後に ACK/broadcast を返す）。それ以外は同期委譲。
   * 返り値の dispatch（RoomBridge 側）は Promise 解決後＝durable 化後に行われる。
   */
  async handleMessage(connectionId: string, message: ClientMessageExceptJoin): Promise<Outbound[]> {
    if (message.type !== 'submitOperation') {
      return this.room.handleMessage(connectionId, message);
    }
    const revisionBefore = this.sequencer.currentRevision;
    // submit（revision 割当・ログ in-memory 追記）は同期。ここまでで順序が確定する。
    const outbound = this.room.handleMessage(connectionId, message);
    const accepted = this.sequencer.operationsSince(revisionBefore); // 新規 accepted（0 or 1 件）
    if (accepted.length > 0) {
      await this.oplog.append(accepted); // ★ durable 境界（fsync）。解決後に呼び出し側が ACK/broadcast を dispatch。
      this.opsSinceSnapshot += accepted.length;
      this.maybeSnapshot();
    }
    return outbound;
  }

  handleDisconnect(connectionId: string): Outbound[] {
    return this.room.handleDisconnect(connectionId);
  }

  sweep(): Outbound[] {
    return this.room.sweep();
  }

  activeConnectionIds(): readonly string[] {
    return this.room.activeConnectionIds();
  }

  exportState(): SequencerState {
    return this.room.exportState();
  }

  /** 直近の非同期 snapshot 生成で発生したエラー（あれば）。運用監視用。 */
  get snapshotError(): unknown {
    return this.lastSnapshotError;
  }

  /** N op ごとに非同期 snapshot 生成をトリガーする（生成中の重複起動はしない・取り漏らしは oplog が正本ゆえ発生しない）。 */
  private maybeSnapshot(): void {
    if (this.snapshotInProgress || this.opsSinceSnapshot < this.snapshotIntervalOps) {
      return;
    }
    this.opsSinceSnapshot = 0;
    this.snapshotInProgress = true;
    // exportState は同期＝生成時点の一貫した状態（document は COW ゆえ以降の op で不変）。async write は競合しない。
    const state = this.sequencer.exportState();
    const revision = state.currentRevision;
    void this.writeSnapshot(state, revision)
      .catch((error: unknown) => {
        this.lastSnapshotError = error; // snapshot は最適化物＝生成失敗でも oplog（正本）は無傷。ACK は既に durable。
      })
      .finally(() => {
        this.snapshotInProgress = false;
      });
  }

  private async writeSnapshot(state: SequencerState, revision: number): Promise<void> {
    const data = serializeSnapshot(state);
    const persisted = createPersistedSnapshot({
      documentId: this.options.documentId,
      revision,
      createdAt: new Date(this.clock.now()).toISOString(),
      // persisted snapshot は operationLog を埋め込まない（log は oplog が正本・O(document) サイズ・write amplification 回避）。
      snapshot: { ...data, operationLog: [] },
    });
    await this.snapshotStore.save(persisted);
  }

  /** 保留中の durable 書込を確定してから閉じる（graceful shutdown）。 */
  async close(): Promise<void> {
    await this.oplog.close();
    await this.snapshotStore.close();
  }

  /** テスト用: 手動 snapshot 生成（生成トリガーを待たずに現在状態を永続化する）。 */
  async forceSnapshot(): Promise<void> {
    const state = this.sequencer.exportState();
    await this.writeSnapshot(state, state.currentRevision);
    this.opsSinceSnapshot = 0;
  }
}
