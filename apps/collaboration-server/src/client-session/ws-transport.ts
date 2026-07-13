// 実 WebSocket トランスポート（phase3-design §4 の ClientTransport 実装）。ClientSession に注入され、
// join/submit/presence/heartbeat/requestCatchup を JSON でサーバーへ送り、サーバーメッセージを ClientSession へ配る。
//
// 【依存境界】このファイルは Node ws（client）を使う実 WS トランスポートで、collaboration-server 側に残す。
// ClientSession コア（session/deps/inprocess-transport）は @nanairo-sheet/collab へ移設済みで、
// その依存ゼロ（Node/DOM 非参照）は同パッケージの tsconfig（types:[]）で回帰検証する（DD-005 Phase 1）。
// heartbeat はトランスポートの責務にしない（session/デモ/smoke が sendHeartbeat を実タイマーで駆動）＝送受信・接続イベント・
// 再接続のみを担う。時刻依存は再接続 setTimeout のみ（アダプター層ゆえ実タイマー可・後始末は close で解除）。

import { WebSocket } from 'ws';
import type { RawData } from 'ws';

import type { ClientMessage } from '@nanairo-sheet/core';
import { decodeServerMessage } from '@nanairo-sheet/core';
import type { ClientTransport, TransportListener } from '@nanairo-sheet/collab';

import { rawDataToString } from '../ws-frame';

export interface WsClientTransportOptions {
  /** 予期しない切断後の自動再接続を有効にする（既定 true）。close() で無効化。 */
  autoReconnect?: boolean;
  /** 再接続までの待機（ミリ秒・既定 1000）。 */
  reconnectDelayMillis?: number;
}

const DEFAULT_RECONNECT_DELAY = 1_000;

export class WsClientTransport implements ClientTransport {
  private readonly url: string;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelayMillis: number;

  private listener: TransportListener | undefined;
  private ws: WebSocket | undefined;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly outbox: ClientMessage[] = []; // CONNECTING 中に送られたメッセージのバッファ（open で flush）

  constructor(url: string, options: WsClientTransportOptions = {}) {
    this.url = url;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelayMillis = options.reconnectDelayMillis ?? DEFAULT_RECONNECT_DELAY;
  }

  setListener(listener: TransportListener): void {
    this.listener = listener;
  }

  /** 接続を確立する（open で handleConnected → session が join 送信）。 */
  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  /** ClientMessage を送信する（OPEN は即送信・CONNECTING はバッファ・その他は drop＝session の再送に委ねる）。 */
  send(message: ClientMessage): void {
    const ws = this.ws;
    if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return;
    }
    if (ws !== undefined && ws.readyState === WebSocket.CONNECTING) {
      this.outbox.push(message);
    }
    // CLOSING/CLOSED は drop（未 ACK pending は ClientSession が再接続後に再送＝§8.5・phase3-design §6）。
  }

  /** 明示 close（再接続を止め、ソケットとタイマーを解放する＝テスト後始末・graceful shutdown）。 */
  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.outbox.length = 0;
    const ws = this.ws;
    this.ws = undefined;
    if (ws !== undefined) {
      ws.removeAllListeners();
      ws.close();
    }
  }

  private openSocket(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on('open', () => {
      this.flushOutbox();
      this.requireListener().handleConnected();
    });
    ws.on('message', (data: RawData) => {
      this.receive(data);
    });
    ws.on('close', () => {
      this.handleSocketDown();
    });
    ws.on('error', (error: Error) => {
      // 予期しないエラーは記録する（P08: 握りつぶさない）。close() 後の teardown 由来は抑止（AbortError 相当の意図的無視）。
      if (!this.closedByUser) {
        console.error(`WsClientTransport: socket error (${this.url}): ${error.message}`);
      }
      // 'close' が続いて発火し handleSocketDown で切断通知＋再接続する（error 単独では二重処理しない）。
    });
  }

  private receive(data: RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawDataToString(data));
    } catch {
      console.error(`WsClientTransport: dropped non-JSON frame from ${this.url}`);
      return;
    }
    const message = decodeServerMessage(parsed);
    if (message === undefined) {
      console.error(`WsClientTransport: dropped unrecognized server message from ${this.url}`);
      return;
    }
    this.requireListener().handleServerMessage(message);
  }

  private handleSocketDown(): void {
    this.ws = undefined;
    this.requireListener().handleDisconnected();
    if (!this.closedByUser && this.autoReconnect) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        if (!this.closedByUser) {
          this.openSocket(); // 再 open → handleConnected → 同一 clientId で再 join（§8.5・phase3-design §7）
        }
      }, this.reconnectDelayMillis);
    }
  }

  private flushOutbox(): void {
    const ws = this.ws;
    if (ws === undefined || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    for (const message of this.outbox) {
      ws.send(JSON.stringify(message));
    }
    this.outbox.length = 0;
  }

  private requireListener(): TransportListener {
    if (this.listener === undefined) {
      throw new Error('WsClientTransport: listener not set (call setListener before connect)');
    }
    return this.listener;
  }
}
