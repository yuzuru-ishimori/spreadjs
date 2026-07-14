// ブラウザー native WebSocket による ClientTransport 実装（DD-005 Phase 2・案A）。
// ClientSession に注入され、join/submit/presence/heartbeat/requestCatchup を JSON でサーバーへ送り、
// サーバーメッセージ（decodeServerMessage で型安全 decode）を ClientSession へ配る。予期しない切断は
// 自動再接続し、同一 clientId で再 join → welcome/operations 差分 → pending 再送（§8.5・ClientSession が担う）。
//
// 【依存境界】このファイルは browser の WebSocket（DOM）を使う実 WS トランスポートで apps/playground に置く。
// ClientSession コアは @nanairo-sheet/collab（Node/DOM 非依存）。collab の本体バレルは
// server-core 非依存ゆえブラウザーバンドルに安全に含められる（DD-005 Phase 1）。
//
// 【テスト容易性】native WebSocket と setTimeout を直接掴まず、SocketFactory / TransportTimer を注入で受ける
// （既定は本ファイル内の DOM 実装）。これにより再接続の状態遷移・outbox flush・decode drop を DOM/WS なしの
// node 環境でユニットテストできる（browser-transport.test.ts）。
import { decodeServerMessage } from '@nanairo-sheet/core';
import type { ClientTransport, TransportListener } from '@nanairo-sheet/collab';
import { nextReconnectDelay } from '@nanairo-sheet/collab';
import type { ClientMessage } from '@nanairo-sheet/core';

// WebSocket.readyState（HTML 仕様の数値定数。DOM 非依存に固定値で持つ）。
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

/** トランスポートが掴むソケットの最小契約（native WebSocket でも fake でも実装できる）。 */
export interface TransportSocket {
  send(data: string): void;
  close(): void;
  /** WebSocket.readyState（0=CONNECTING/1=OPEN/2=CLOSING/3=CLOSED）。 */
  readonly readyState: number;
}

/** ソケットからトランスポートへのイベント配線。 */
export interface SocketEvents {
  onOpen(): void;
  onMessage(data: string): void;
  onClose(): void;
  onError(message: string): void;
}

/** url とイベントハンドラから TransportSocket を作る（既定は native WebSocket・テストは fake）。 */
export type SocketFactory = (url: string, events: SocketEvents) => TransportSocket;

// タイマーハンドルは不透明トークン（transport は中身を見ず clear へ渡すだけ）。実 setTimeout（Timeout）も
// テストの手動タイマー（number）も受けられるよう両方を許す。
export type TimerHandle = ReturnType<typeof setTimeout> | number;

/** 再接続タイマーの注入点（既定は setTimeout/clearTimeout・テストは手動タイマー）。 */
export interface TransportTimer {
  set(callback: () => void, delayMillis: number): TimerHandle;
  clear(handle: TimerHandle): void;
}

const defaultSocketFactory: SocketFactory = (url, events) => {
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => {
    events.onOpen();
  });
  ws.addEventListener('message', (event: MessageEvent) => {
    // PoC サーバーは JSON テキストフレームのみ送る。Blob/ArrayBuffer は想定外ゆえ drop（P08: 記録）。
    if (typeof event.data === 'string') {
      events.onMessage(event.data);
    } else {
      events.onError('non-string frame');
    }
  });
  ws.addEventListener('close', () => {
    events.onClose();
  });
  ws.addEventListener('error', () => {
    events.onError('websocket error');
  });
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    get readyState() {
      return ws.readyState;
    },
  };
};

const defaultTimer: TransportTimer = {
  set: (callback, delayMillis) => setTimeout(callback, delayMillis),
  clear: (handle) => {
    clearTimeout(handle);
  },
};

export interface BrowserTransportOptions {
  /** 予期しない切断後の自動再接続を有効にする（既定 true）。close() で無効化。 */
  autoReconnect?: boolean;
  /** 指数バックオフの初回待機（ミリ秒・既定 1000）。attempt=0 の基準値（DD-015 要確認①）。 */
  reconnectDelayMillis?: number;
  /** 指数バックオフの上限待機（ミリ秒・既定 30000＝要確認①「上限 30s」）。 */
  maxReconnectDelayMillis?: number;
  /** ジッタ源（0..1・既定 Math.random）。注入で決定論テスト可。 */
  random?: () => number;
  /** ソケット生成の注入（既定 native WebSocket）。テストは fake を渡す。 */
  socketFactory?: SocketFactory;
  /** 再接続タイマーの注入（既定 setTimeout）。テストは手動タイマーを渡す。 */
  timer?: TransportTimer;
  /** drop/error のログ出力（既定 console.error）。 */
  logger?: (message: string) => void;
  /** 受信フレームの計測フック（#6 初期 snapshot 経路: 受信文字数・JSON parse 時間）。 */
  onServerFrame?: (info: { chars: number; parseMillis: number }) => void;
}

const DEFAULT_RECONNECT_DELAY = 1_000; // 初回 1s（要確認①）
const DEFAULT_MAX_RECONNECT_DELAY = 30_000; // 上限 30s（要確認①）

export class BrowserWebSocketTransport implements ClientTransport {
  private readonly url: string;
  private readonly autoReconnect: boolean;
  private readonly baseReconnectDelayMillis: number;
  private readonly maxReconnectDelayMillis: number;
  private readonly random: () => number;
  private readonly socketFactory: SocketFactory;
  private readonly timer: TransportTimer;
  private readonly logger: (message: string) => void;
  private readonly onServerFrame: ((info: { chars: number; parseMillis: number }) => void) | undefined;

  private listener: TransportListener | undefined;
  private socket: TransportSocket | undefined;
  private closedByUser = false;
  private autoReconnectSuppressed = false; // dropForTest 中は自動再接続を抑止（offline ウィンドウを決定論的に作る・テスト専用）
  private reconnectHandle: TimerHandle | undefined;
  private reconnectAttempt = 0; // 連続再接続失敗回数（open 成功で 0 リセット＝指数バックオフの指数・DD-015 要確認①）
  private readonly outbox: ClientMessage[] = []; // CONNECTING 中に送られたメッセージ（open で flush）

  constructor(url: string, options: BrowserTransportOptions = {}) {
    this.url = url;
    this.autoReconnect = options.autoReconnect ?? true;
    this.baseReconnectDelayMillis = options.reconnectDelayMillis ?? DEFAULT_RECONNECT_DELAY;
    this.maxReconnectDelayMillis = options.maxReconnectDelayMillis ?? DEFAULT_MAX_RECONNECT_DELAY;
    this.random = options.random ?? Math.random;
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.timer = options.timer ?? defaultTimer;
    this.logger =
      options.logger ??
      ((message) => {
        console.error(message);
      });
    this.onServerFrame = options.onServerFrame;
  }

  setListener(listener: TransportListener): void {
    this.listener = listener;
  }

  /** 接続を確立する（open で handleConnected → session が join 送信）。 */
  connect(): void {
    this.closedByUser = false;
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  /** ClientMessage を送信する（OPEN は即送信・CONNECTING はバッファ・その他は drop＝session の再送に委ねる）。 */
  send(message: ClientMessage): void {
    const socket = this.socket;
    if (socket !== undefined && socket.readyState === SOCKET_OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }
    if (socket !== undefined && socket.readyState === SOCKET_CONNECTING) {
      this.outbox.push(message);
    }
    // CLOSING/CLOSED/未接続は drop（未 ACK pending は ClientSession が再接続後に再送＝§8.5）。
  }

  /** 明示 close（再接続を止め、ソケットとタイマーを解放する＝ページ離脱・テスト後始末）。 */
  close(): void {
    this.closedByUser = true;
    if (this.reconnectHandle !== undefined) {
      this.timer.clear(this.reconnectHandle);
      this.reconnectHandle = undefined;
    }
    this.outbox.length = 0;
    const socket = this.socket;
    this.socket = undefined;
    if (socket !== undefined) {
      socket.close();
    }
  }

  /**
   * 【テスト専用フォールト注入・DD-015 Manual Gate】現在のソケットを閉じ（実ブラウザーの close イベントを発火）、
   * 自動再接続を抑止して offline のまま留める（タブ生存・session の pending 保持）。resumeReconnectForTest で実再接続を明示駆動する。
   * setOffline/CDP offline は Chromium の localhost WebSocket を切らないため、実 WS の close→再接続経路を実機で駆動する手段として用いる。
   */
  dropForTest(): void {
    this.autoReconnectSuppressed = true;
    if (this.reconnectHandle !== undefined) {
      this.timer.clear(this.reconnectHandle);
      this.reconnectHandle = undefined;
    }
    const socket = this.socket;
    if (socket !== undefined) {
      socket.close(); // → 実 'close' イベント → handleClose → handleDisconnected（session offline・pending 保持）。suppressed ゆえ再接続しない
    }
  }

  /** 【テスト専用】dropForTest 後に実再接続を明示駆動する（実ブラウザーの WebSocket を再 open → 同一 clientId で再 join）。 */
  resumeReconnectForTest(): void {
    this.autoReconnectSuppressed = false;
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  private openSocket(): void {
    this.socket = this.socketFactory(this.url, {
      onOpen: () => {
        this.handleOpen();
      },
      onMessage: (data) => {
        this.handleMessage(data);
      },
      onClose: () => {
        this.handleClose();
      },
      onError: (message) => {
        this.handleError(message);
      },
    });
  }

  private handleOpen(): void {
    this.reconnectAttempt = 0; // 接続確立 → バックオフをリセット（次の切断は初回待機から）
    this.flushOutbox();
    this.requireListener().handleConnected(); // → session が同一 clientId で join 送信
  }

  private handleMessage(data: string): void {
    let parsed: unknown;
    const parseStart = performance.now();
    try {
      parsed = JSON.parse(data);
    } catch {
      this.logger(`BrowserWebSocketTransport: dropped non-JSON frame from ${this.url}`);
      return;
    }
    this.onServerFrame?.({ chars: data.length, parseMillis: performance.now() - parseStart });
    const message = decodeServerMessage(parsed);
    if (message === undefined) {
      this.logger(`BrowserWebSocketTransport: dropped unrecognized server message from ${this.url}`);
      return;
    }
    this.requireListener().handleServerMessage(message);
  }

  private handleClose(): void {
    this.socket = undefined;
    this.requireListener().handleDisconnected(); // → session が offline へ
    if (!this.closedByUser && this.autoReconnect && !this.autoReconnectSuppressed) {
      // 指数バックオフ＋ジッタで再接続を予約する（タブ生存中は無期限リトライ＝回数上限なし・DD-015 要確認①）。
      const delay = nextReconnectDelay(
        this.reconnectAttempt,
        { baseMillis: this.baseReconnectDelayMillis, maxMillis: this.maxReconnectDelayMillis },
        this.random,
      );
      this.reconnectAttempt += 1;
      this.reconnectHandle = this.timer.set(() => {
        this.reconnectHandle = undefined;
        if (!this.closedByUser) {
          this.openSocket(); // 再 open → handleConnected → 同一 clientId で再 join（§8.5）
        }
      }, delay);
    }
  }

  private handleError(message: string): void {
    // 予期しないエラーは記録する（P08: 握りつぶさない）。close() 後は抑止。
    // 'close' が続いて発火し handleClose で切断通知＋再接続する（error 単独では二重処理しない）。
    if (!this.closedByUser) {
      this.logger(`BrowserWebSocketTransport: socket error (${this.url}): ${message}`);
    }
  }

  private flushOutbox(): void {
    const socket = this.socket;
    if (socket === undefined || socket.readyState !== SOCKET_OPEN) {
      return;
    }
    for (const message of this.outbox) {
      socket.send(JSON.stringify(message));
    }
    this.outbox.length = 0;
  }

  private requireListener(): TransportListener {
    if (this.listener === undefined) {
      throw new Error('BrowserWebSocketTransport: listener not set (call setListener before connect)');
    }
    return this.listener;
  }
}
