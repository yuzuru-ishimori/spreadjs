// in-process 試験ハーネストランスポート（Room 直結・シード付き PRNG フォールト注入・発火カウンター）。
// 収束試験（Phase 3 スモーク・Phase 5）で複数 ClientSession を 1 Room に結線し、重複・欠落・遅延・切断を
// 決定論的に注入する（実タイマー不使用＝遅延はイベントキュー順序操作で表現）。
//
// これは試験ハーネスゆえ Room（sheet-server-core）に依存してよい（client-session 本体 session.ts は非依存を維持）。
// フォールト注入は Math.random ではなくシード付き mulberry32（同一シード→同一実行＝S-M2 の再現性）。

import type { ClientMessage, ServerMessage } from '@nanairo-sheet/sheet-core';
import { Room } from '@nanairo-sheet/sheet-server-core';
import type { Outbound, OutboundTarget } from '@nanairo-sheet/sheet-server-core';

import type { ClientTransport, TransportListener } from './session';

/** フォールト発火確率（0..1）。未指定は 0（発火しない）。 */
export interface FaultProbabilities {
  duplicate?: number;
  drop?: number;
  delay?: number;
  disconnect?: number;
}

/** フォールト発火カウンター（S-M3 メタ検証＝フォールトが実際に発火したかの assert に使う・指示 5）。 */
export interface FaultCounters {
  duplicate: number;
  drop: number;
  delay: number;
  disconnect: number;
}

interface Delivery {
  connectionId: string;
  message: ServerMessage;
}

/** 小さなシード付き PRNG（決定論・実装コードでは使わない試験用）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 複数 ClientSession を 1 Room に結線するハブ。クライアント→サーバーは Room を同期呼び出しし、
 * サーバー→クライアントの Outbound を遅延キューへ積む。deliverAll/deliverNext で決定論的に配送する。
 */
export class InProcessHub {
  readonly counters: FaultCounters = { duplicate: 0, drop: 0, delay: 0, disconnect: 0 };

  private readonly room: Room;
  private readonly rand: () => number;
  private faults: FaultProbabilities;
  private readonly transports = new Map<string, InProcessTransport>(); // clientId → transport
  private readonly connToClient = new Map<string, string>(); // connectionId → clientId
  private readonly clientToConn = new Map<string, string>(); // clientId → 現接続 connectionId
  private readonly disconnected = new Set<string>(); // 現在切断中の clientId
  private readonly deliveryQueue: Delivery[] = [];
  private readonly injectClientToServer: boolean; // submitOperation（client→server）にも drop/duplicate を注入するか

  constructor(
    room: Room,
    options: { seed: number; faults?: FaultProbabilities; injectClientToServer?: boolean },
  ) {
    this.room = room;
    this.rand = mulberry32(options.seed);
    this.faults = options.faults ?? {};
    // 既定 true（従来動作）。false にすると submitOperation は確実配信し、フォールトは server→client の
    // operations/operationAck のみへ注入する（欠落→catch-up・重複→無視・遅延→リオーダーで回復する経路）。
    // submitOperation drop は seq gap を生み、その回復は D27 の deferred 境界（violation 時の clientSequence
    // 完全再整列は未実装）に依存するため、Phase 5 収束試験はこの経路を除外して安定した収束を検証する。
    this.injectClientToServer = options.injectClientToServer ?? true;
  }

  /** clientId 用のトランスポートを作る（ClientSession に注入する）。 */
  connect(clientId: string): InProcessTransport {
    const transport = new InProcessTransport(this, clientId);
    this.transports.set(clientId, transport);
    return transport;
  }

  /**
   * 以降のフォールト注入を無効化する（発火済みカウンターは保持）。収束試験の静止点作成用:
   * 全送信完了後にこれを呼べば、新規の drop/duplicate/delay が止まり、周期 catch-up/再送で
   * 有限 tick 内に収束できる（Phase 5 収束試験の「フォールト無効化 → tick 前進」・S-M1）。
   */
  disableFaults(): void {
    this.faults = {};
  }

  /** 遅延キューを空になるまで配送する（決定論・maxSteps は安全上限）。 */
  deliverAll(maxSteps = 100_000): void {
    let steps = 0;
    while (steps < maxSteps && this.deliverNext()) {
      steps += 1;
    }
    if (steps >= maxSteps) {
      // 収束機構が働いていれば配送は有限で止まる。上限到達はメッセージ増幅（例: 再送→violation→再送の
      // 指数ループ）を示すので、静かに打ち切って収束を偽装せず、明示的に失敗させる（試験の信頼性）。
      throw new Error(`InProcessHub.deliverAll: message storm (hit maxSteps=${maxSteps}, queueLen=${this.deliveryQueue.length})`);
    }
  }

  /** 遅延キューから 1 件配送する（delay 注入時は後方インデックスを選ぶ＝reorder）。空なら false。 */
  deliverNext(): boolean {
    if (this.deliveryQueue.length === 0) {
      return false;
    }
    let index = 0;
    if (this.deliveryQueue.length > 1 && this.roll(this.faults.delay)) {
      this.counters.delay += 1;
      index = 1 + Math.floor(this.rand() * (this.deliveryQueue.length - 1)); // 後方＝順序を入れ替え
    }
    const removed = this.deliveryQueue.splice(index, 1);
    const delivery = removed[0];
    if (delivery === undefined) {
      return true; // 到達不能（index は有効）
    }
    const clientId = this.connToClient.get(delivery.connectionId);
    if (clientId === undefined || this.disconnected.has(clientId)) {
      return true; // 未知接続 or 切断中の宛先へは配送しない（破棄）
    }
    this.transports.get(clientId)?.deliver(delivery.message);
    return true;
  }

  /**
   * 切断フォールト（abnormal disconnect）: 対象を offline にし通知する。サーバーは異常切断をいずれ検知して
   * 旧コネクションを解放する（実 WS の close/error・TTL 相当）。ここで旧 connectionId を Room から外し、
   * 再接続で作られる新 connectionId とスタール旧接続が二重に残ってブロードキャスト fan-out が増大する
   * （多数回の再接続で配送が O(接続数) に膨らむ）のを防ぐ。旧接続宛にキュー済みのメッセージは配送時に
   * connectionId 未解決となり破棄される（offline へは不達＝従来と同じ・reject 喪失境界 D27 は不変）。
   */
  disconnect(clientId: string): void {
    if (this.disconnected.has(clientId)) {
      return;
    }
    this.disconnected.add(clientId);
    this.counters.disconnect += 1;
    const connectionId = this.clientToConn.get(clientId);
    if (connectionId !== undefined) {
      this.enqueueOutbound(this.room.handleDisconnect(connectionId)); // presenceRemoved（others）＝presence 未使用時は空
      this.connToClient.delete(connectionId);
      this.clientToConn.delete(clientId);
    }
    this.transports.get(clientId)?.notifyDisconnected();
  }

  /** 再接続: offline を解除し handleConnected を発火（session が同一 clientId で再 join する）。 */
  reconnect(clientId: string): void {
    if (!this.disconnected.has(clientId)) {
      return;
    }
    this.disconnected.delete(clientId);
    this.transports.get(clientId)?.notifyConnected();
  }

  /** TTL sweep を発火し presenceRemoved を配送（Phase 4/5 用。注入クロックは Room 側）。 */
  sweep(): void {
    this.enqueueOutbound(this.room.sweep());
  }

  /** InProcessTransport から呼ばれる: クライアント→サーバーのメッセージを Room へ渡す。 */
  routeFromClient(clientId: string, message: ClientMessage): void {
    if (this.disconnected.has(clientId)) {
      return; // 切断中は送信不達
    }
    // フォールト対象は submitOperation のみ（drop→再送・duplicate→冪等）。制御系（join/catchup/presence/
    // heartbeat）は欠落させない（catch-up の stall や接続不整合を避ける）。server→client の欠落/遅延で十分に注入する。
    // injectClientToServer=false のときは submitOperation も確実配信（Phase 5 収束試験の安定化・上記コンストラクタ）。
    const faultable = this.injectClientToServer && message.type === 'submitOperation';
    if (faultable && this.roll(this.faults.drop)) {
      this.counters.drop += 1;
      return;
    }
    const times = faultable && this.roll(this.faults.duplicate) ? 2 : 1;
    if (times === 2) {
      this.counters.duplicate += 1;
    }
    for (let i = 0; i < times; i += 1) {
      this.processToRoom(clientId, message);
    }
  }

  private processToRoom(clientId: string, message: ClientMessage): void {
    if (message.type === 'join') {
      const { connectionId, outbound } = this.room.handleJoin(message);
      this.connToClient.set(connectionId, clientId);
      this.clientToConn.set(clientId, connectionId);
      this.enqueueOutbound(outbound);
      return;
    }
    const connectionId = this.clientToConn.get(clientId);
    if (connectionId === undefined) {
      return; // join 前
    }
    this.enqueueOutbound(this.room.handleMessage(connectionId, message));
  }

  /** サーバー→クライアントの Outbound を宛先展開しキューへ積む（drop/duplicate 注入）。 */
  private enqueueOutbound(outbound: Outbound[]): void {
    for (const item of outbound) {
      // フォールト対象はデータ経路（operations / operationAck）のみ。制御/ハンドシェイク（welcome /
      // operationRejected / presence* / heartbeatAck）は欠落させない: welcome を落とすと currentRevision を
      // 知れず catch-up 不能、reject を落とすと content-reject 済み op を再送し clientSequence 不整合が残る
      // （D21/D27 の境界）。収束機構（再送/catch-up/冪等）が回復するのはこのデータ経路の欠落。delay（reorder）は
      // キュー順序操作ゆえ全メッセージに及ぶ（welcome/operations の順序入れ替えは受信側が吸収）。
      const faultable = item.message.type === 'operations' || item.message.type === 'operationAck';
      for (const connectionId of this.resolveTargets(item.target)) {
        if (faultable && this.roll(this.faults.drop)) {
          this.counters.drop += 1;
          continue; // 欠落 → 受信側で gap 検知→catch-up（S-I1）
        }
        this.deliveryQueue.push({ connectionId, message: item.message });
        if (faultable && this.roll(this.faults.duplicate)) {
          this.counters.duplicate += 1;
          this.deliveryQueue.push({ connectionId, message: item.message }); // 重複 → 受信側で無視（S-I3）
        }
      }
    }
  }

  private resolveTargets(target: OutboundTarget): string[] {
    switch (target.kind) {
      case 'connection':
        return [target.connectionId];
      case 'others':
        return this.room.activeConnectionIds().filter((id) => id !== target.exceptConnectionId);
      case 'all':
        return [...this.room.activeConnectionIds()];
    }
  }

  private roll(probability: number | undefined): boolean {
    if (probability === undefined || probability <= 0) {
      return false;
    }
    return this.rand() < probability;
  }
}

/** InProcessHub に結線される 1 セッション分のトランスポート。 */
export class InProcessTransport implements ClientTransport {
  private listener: TransportListener | undefined;

  constructor(
    private readonly hub: InProcessHub,
    private readonly clientId: string,
  ) {}

  setListener(listener: TransportListener): void {
    this.listener = listener;
  }

  connect(): void {
    this.requireListener().handleConnected();
  }

  send(message: ClientMessage): void {
    this.hub.routeFromClient(this.clientId, message);
  }

  /** hub がサーバーメッセージを配送する。 */
  deliver(message: ServerMessage): void {
    this.requireListener().handleServerMessage(message);
  }

  /** hub が切断を通知する。 */
  notifyDisconnected(): void {
    this.requireListener().handleDisconnected();
  }

  /** hub が再接続を通知する。 */
  notifyConnected(): void {
    this.requireListener().handleConnected();
  }

  private requireListener(): TransportListener {
    if (this.listener === undefined) {
      throw new Error('InProcessTransport: listener not set');
    }
    return this.listener;
  }
}
