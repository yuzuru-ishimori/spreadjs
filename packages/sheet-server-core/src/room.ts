// 権威 Room（トランスポート非依存・メッセージ in/out）。Sequencer（全順序 Operation）と PresenceRegistry を束ね、
// クライアントメッセージ＋connectionId を入力に、宛先付きサーバーメッセージ列（Outbound[]）を返す純粋インターフェース。
// 実 WS/in-process いずれのトランスポートからも同じ Room を駆動できる（Phase 3/4）。
//
// connectionId はサーバーが払い出す（welcome.sessionId＝Presence 管理単位）。clientId（envelope）は clientSequence/
// 冪等キーで再接続不変（protocol-subset §2）。時刻・ID は注入（clock / idGenerator）でテスト再現可能。

import type {
  ClientMessageExceptJoin,
  ClientOperationEnvelope,
  JoinMessage,
  ServerMessage,
  ServerOperationEnvelope,
} from '@nanairo-sheet/sheet-core';

import { createCounterIdGenerator } from './deps';
import type { Clock, IdGenerator } from './deps';
import { PresenceRegistry } from './presence';
import type { Sequencer, SequencerState } from './sequencer';

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
   * join を処理し connectionId を払い出す（§8.2）。welcome ＋ lastAppliedRevision 以降の operations ＋
   * presenceSnapshot を送信元へ返す。join は userId/displayName を持たない（§1）ため presenceDelta は
   * 最初の presence メッセージで配信する（colorKey は join で予約・S-L1）。
   */
  handleJoin(join: JoinMessage): { connectionId: string; outbound: Outbound[] } {
    const connectionId = this.idGenerator.next();
    this.connections.set(connectionId, { clientId: join.clientId });
    const colorKey = this.presence.register(connectionId); // colorKey を welcome で返す（Phase 3 指示 3）

    const outbound: Outbound[] = [
      {
        target: { kind: 'connection', connectionId },
        message: {
          type: 'welcome',
          sessionId: connectionId,
          colorKey,
          currentRevision: this.sequencer.currentRevision,
          capabilities: { protocolVersion: PROTOCOL_VERSION },
        },
      },
    ];

    const missed = this.sequencer.operationsSince(join.lastAppliedRevision);
    if (missed.length > 0) {
      outbound.push({
        target: { kind: 'connection', connectionId },
        message: operationsMessage(missed),
      });
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
    const missed = this.sequencer.operationsSince(afterRevision);
    // off-by-one: fromRevision = afterRevision+1（afterRevision 自身は再送しない・S-I5）。空でも range を返し確定応答。
    return [
      {
        target: { kind: 'connection', connectionId },
        message: {
          type: 'operations',
          fromRevision: afterRevision + 1,
          toRevision: this.sequencer.currentRevision,
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
