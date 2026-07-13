// 権威 Room（トランスポート非依存・メッセージ in/out）。Sequencer（全順序 Operation）と PresenceRegistry を束ね、
// クライアントメッセージ＋connectionId を入力に、宛先付きサーバーメッセージ列（Outbound[]）を返す純粋インターフェース。
// 実 WS/in-process いずれのトランスポートからも同じ Room を駆動できる（Phase 3/4）。
//
// connectionId はサーバーが払い出す（welcome.sessionId＝Presence 管理単位）。clientId（envelope）は clientSequence/
// 冪等キーで再接続不変（protocol-subset §2）。時刻・ID は注入（clock / idGenerator）でテスト再現可能。

import { serializeDocument } from '@nanairo-sheet/core';
import type {
  ClientMessageExceptJoin,
  ClientOperationEnvelope,
  JoinMessage,
  ServerMessage,
  ServerOperationEnvelope,
  SheetDocument,
} from '@nanairo-sheet/core';

import { createCounterIdGenerator } from './deps';
import type { Clock, IdGenerator } from './deps';
import { PresenceRegistry } from './presence';
import type { Sequencer, SequencerState } from './sequencer';

/**
 * durable 読取境界（DD-014-1・P1-3）。join/requestCatchup/welcome が観測してよい最大 revision（frontier）と
 * その revision に対応する権威文書を供給する。永続化無効時は Room が Sequencer の現在値を frontier とみなす
 * （in-memory のみ＝全 revision が即読取可能）。PersistentRoom が fsync 済み境界を注入して未 durable を隠す。
 */
export interface DurableBoundary {
  frontierRevision(): number; // fsync 済み最大 revision（この revision 以下のみ配布する）
  frontierDocument(): SheetDocument; // document@frontierRevision（COW ゆえ以降の op で不変・snapshot bootstrap の源）
}

/** Outbound の宛先。transport が 'all'/'others' を活性接続へ fan-out する。 */
export type OutboundTarget =
  | { kind: 'connection'; connectionId: string } // 直接宛先
  | { kind: 'others'; exceptConnectionId: string } // 送信元以外へ
  | { kind: 'all' }; // 全接続（送信元含む＝operations エコー）

export interface Outbound {
  target: OutboundTarget;
  message: ServerMessage;
}

const DEFAULT_TTL_MILLIS = 15_000; // §9.3 初期値（Presence TTL 目安 15 秒）
const PROTOCOL_VERSION = 1;

export class Room {
  private readonly sequencer: Sequencer;
  private readonly presence: PresenceRegistry;
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;
  private readonly connections = new Map<string, { clientId: string }>();
  private durableBoundary: DurableBoundary | undefined;

  constructor(
    sequencer: Sequencer,
    deps: { clock: Clock; idGenerator?: IdGenerator; ttlMillis?: number },
  ) {
    this.sequencer = sequencer;
    this.clock = deps.clock;
    this.idGenerator = deps.idGenerator ?? createCounterIdGenerator();
    this.presence = new PresenceRegistry({
      clock: deps.clock,
      ttlMillis: deps.ttlMillis ?? DEFAULT_TTL_MILLIS,
    });
  }

  /**
   * durable 読取境界を注入する（PersistentRoom が構築時に呼ぶ・DD-014-1 P1-3）。以降 join/catch-up/welcome は
   * frontier 以下のみを配布する。未注入（永続化無効）なら Sequencer の現在 revision/document を frontier とみなす。
   */
  attachDurableBoundary(boundary: DurableBoundary): void {
    this.durableBoundary = boundary;
  }

  /** 配布してよい最大 revision（durable frontier）。永続化無効時は現在 revision（全 in-memory が読取可能）。 */
  private frontierRevision(): number {
    return this.durableBoundary?.frontierRevision() ?? this.sequencer.currentRevision;
  }

  /** frontier revision に対応する権威文書（snapshot bootstrap の源）。 */
  private frontierDocument(): SheetDocument {
    return this.durableBoundary?.frontierDocument() ?? this.sequencer.document;
  }

  /**
   * afterRevision 超〜frontier 以下の未受信 op を返す（catch-up/join tail 共通）。durable 境界未注入（永続化無効）時は
   * frontier=currentRevision ゆえ余計な filter 割当を避ける（実 WS 収束経路の per-message オーバーヘッドを増やさない）。
   */
  private operationsUpToFrontier(afterRevision: number, frontier: number): ServerOperationEnvelope[] {
    const since = this.sequencer.operationsSince(afterRevision);
    if (this.durableBoundary === undefined) {
      return since; // frontier == currentRevision＝全て配布可（filter 不要）
    }
    return since.filter((e) => e.revision <= frontier);
  }

  /**
   * join を処理し connectionId を払い出す（§8.2）。welcome ＋ lastAppliedRevision 以降の operations ＋
   * presenceSnapshot を送信元へ返す。join は userId/displayName を持たない（§1）ため presenceDelta は
   * 最初の presence メッセージで配信する（colorKey は join で予約・S-L1）。
   */
  handleJoin(join: JoinMessage): { connectionId: string; outbound: Outbound[] } {
    const connectionId = this.idGenerator.next();
    this.connections.set(connectionId, { clientId: join.clientId });
    const colorKey = this.presence.register(connectionId); // colorKey を welcome で返す（Phase 3 指示 3）

    const frontier = this.frontierRevision(); // welcome/配布は durable frontier 以下に限定（P1-3・未 durable を隠す）
    const outbound: Outbound[] = [
      {
        target: { kind: 'connection', connectionId },
        message: {
          type: 'welcome',
          sessionId: connectionId,
          colorKey,
          currentRevision: frontier,
          capabilities: { protocolVersion: PROTOCOL_VERSION },
        },
      },
    ];

    // snapshot bootstrap（P1-6/P1-7・§8 既知制約回収）: fresh join（lastAppliedRevision<=0）で文書が空でなければ、
    // 全 operationLog を送らず document@frontier（snapshot）1 通で committed を確立させる（全 replay 経路を廃止）。
    if (join.lastAppliedRevision <= 0 && frontier > 0) {
      outbound.push({
        target: { kind: 'connection', connectionId },
        message: {
          type: 'bootstrap',
          document: serializeDocument(this.frontierDocument()),
          revision: frontier,
        },
      });
    } else {
      // tail 経路（reconnect/catch-up・lastAppliedRevision>0）: frontier 以下の未受信 op だけを送る。
      const missed = this.operationsUpToFrontier(join.lastAppliedRevision, frontier);
      if (missed.length > 0) {
        outbound.push({
          target: { kind: 'connection', connectionId },
          message: operationsMessage(missed),
        });
      }
    }

    outbound.push({
      target: { kind: 'connection', connectionId },
      message: { type: 'presenceSnapshot', users: this.presence.snapshot() },
    });

    return { connectionId, outbound };
  }

  /** 確立済み接続からのメッセージ（join 以外）を処理する。 */
  handleMessage(connectionId: string, message: ClientMessageExceptJoin): Outbound[] {
    switch (message.type) {
      case 'submitOperation':
        return this.handleSubmit(connectionId, message.envelope);
      case 'presence':
        return this.handlePresence(connectionId, message.sequence, message.payload);
      case 'heartbeat':
        return this.handleHeartbeat(connectionId);
      case 'requestCatchup':
        return this.handleRequestCatchup(connectionId, message.afterRevision);
    }
  }

  /** 正常 close: 接続削除・Presence 即時削除（TTL を待たない・S-L6）。 */
  handleDisconnect(connectionId: string): Outbound[] {
    this.connections.delete(connectionId);
    const hadPresence = this.presence.remove(connectionId);
    if (!hadPresence) {
      return [];
    }
    return [
      {
        target: { kind: 'others', exceptConnectionId: connectionId },
        message: { type: 'presenceRemoved', sessionId: connectionId },
      },
    ];
  }

  /** TTL 失効スイープ（注入クロックで明示発火・DA D6）。失効接続を presenceRemoved で配信（S-L5）。 */
  sweep(): Outbound[] {
    const outbound: Outbound[] = [];
    for (const removed of this.presence.sweep()) {
      this.connections.delete(removed.connectionId);
      if (removed.hadPresence) {
        outbound.push({
          target: { kind: 'others', exceptConnectionId: removed.connectionId },
          message: { type: 'presenceRemoved', sessionId: removed.connectionId },
        });
      }
    }
    return outbound;
  }

  /** 'all'/'others' 展開用の活性接続一覧（transport が fan-out する）。 */
  activeConnectionIds(): readonly string[] {
    return [...this.connections.keys()];
  }

  /** snapshot エクスポート用に Sequencer 状態を返す（Presence は非永続ゆえ含めない）。 */
  exportState(): SequencerState {
    return this.sequencer.exportState();
  }

  private handleSubmit(connectionId: string, envelope: ClientOperationEnvelope): Outbound[] {
    const outcome = this.sequencer.submit(envelope);
    switch (outcome.status) {
      case 'accepted':
        return [
          { target: { kind: 'connection', connectionId }, message: outcome.ack },
          { target: { kind: 'all' }, message: operationsMessage([outcome.envelope]) },
        ];
      case 'noop':
      case 'duplicate':
        return [{ target: { kind: 'connection', connectionId }, message: outcome.ack }];
      case 'rejected':
        return [{ target: { kind: 'connection', connectionId }, message: outcome.rejection }];
    }
  }

  private handlePresence(
    connectionId: string,
    sequence: number,
    payload: Parameters<PresenceRegistry['update']>[2],
  ): Outbound[] {
    const presence = this.presence.update(connectionId, sequence, payload);
    if (presence === undefined) {
      return []; // 未登録 or 古い sequence（S-L3）
    }
    return [
      {
        target: { kind: 'others', exceptConnectionId: connectionId },
        message: { type: 'presenceDelta', presence },
      },
    ];
  }

  private handleHeartbeat(connectionId: string): Outbound[] {
    this.presence.touch(connectionId);
    return [
      {
        target: { kind: 'connection', connectionId },
        message: { type: 'heartbeatAck', serverTime: this.clock.now() },
      },
    ];
  }

  private handleRequestCatchup(connectionId: string, afterRevision: number): Outbound[] {
    // durable frontier 以下のみ配布する（未 fsync revision を catch-up から観測させない・P1-3）。
    const frontier = this.frontierRevision();
    const missed = this.operationsUpToFrontier(afterRevision, frontier);
    // off-by-one: fromRevision = afterRevision+1（afterRevision 自身は再送しない・S-I5）。空でも range を返し確定応答。
    return [
      {
        target: { kind: 'connection', connectionId },
        message: {
          type: 'operations',
          fromRevision: afterRevision + 1,
          toRevision: frontier,
          operations: missed,
        },
      },
    ];
  }
}

function operationsMessage(operations: ServerOperationEnvelope[]): ServerMessage {
  return {
    type: 'operations',
    fromRevision: operations[0].revision,
    toRevision: operations[operations.length - 1].revision,
    operations,
  };
}
