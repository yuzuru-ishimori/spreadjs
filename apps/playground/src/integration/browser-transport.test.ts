import { describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from '@nanairo-sheet/sheet-core';
import type { TransportListener } from '@nanairo-sheet/sheet-collaboration';

import {
  BrowserWebSocketTransport,
  type SocketEvents,
  type SocketFactory,
  type TimerHandle,
  type TransportSocket,
  type TransportTimer,
} from './browser-transport';

/** テスト用の擬似ソケット（open/message/close/error を手動で発火し、送信を記録する）。 */
class FakeSocket implements TransportSocket {
  readonly sent: string[] = [];
  readyState = 0; // CONNECTING
  closedByTransport = false;
  constructor(readonly events: SocketEvents) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closedByTransport = true;
    this.readyState = 3; // CLOSED
  }
  open(): void {
    this.readyState = 1; // OPEN
    this.events.onOpen();
  }
  emit(data: string): void {
    this.events.onMessage(data);
  }
  fireClose(): void {
    this.readyState = 3;
    this.events.onClose();
  }
  fireError(message: string): void {
    this.events.onError(message);
  }
}

/** 手動発火の擬似タイマー（TimerHandle は number を用いる不透明トークン）。 */
class FakeTimer {
  private readonly callbacks = new Map<TimerHandle, () => void>();
  private nextId = 1;
  readonly cleared: TimerHandle[] = [];
  readonly timer: TransportTimer = {
    set: (callback: () => void): TimerHandle => {
      const id = this.nextId;
      this.nextId += 1;
      this.callbacks.set(id, callback);
      return id;
    },
    clear: (handle: TimerHandle): void => {
      this.cleared.push(handle);
      this.callbacks.delete(handle);
    },
  };
  fireAll(): void {
    const pending = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const cb of pending) {
      cb();
    }
  }
  pending(): number {
    return this.callbacks.size;
  }
}

function setup(options?: { autoReconnect?: boolean }): {
  transport: BrowserWebSocketTransport;
  sockets: FakeSocket[];
  timer: FakeTimer;
  listener: { connected: number; disconnected: number; messages: ServerMessage[] } & TransportListener;
  logs: string[];
} {
  const sockets: FakeSocket[] = [];
  const factory: SocketFactory = (_url, events) => {
    const socket = new FakeSocket(events);
    sockets.push(socket);
    return socket;
  };
  const timer = new FakeTimer();
  const logs: string[] = [];
  const listener = {
    connected: 0,
    disconnected: 0,
    messages: [] as ServerMessage[],
    handleServerMessage(message: ServerMessage): void {
      this.messages.push(message);
    },
    handleConnected(): void {
      this.connected += 1;
    },
    handleDisconnected(): void {
      this.disconnected += 1;
    },
  };
  const transport = new BrowserWebSocketTransport('ws://x/ws', {
    autoReconnect: options?.autoReconnect ?? true,
    reconnectDelayMillis: 10,
    socketFactory: factory,
    timer: timer.timer,
    logger: (m) => logs.push(m),
  });
  transport.setListener(listener);
  return { transport, sockets, timer, listener, logs };
}

const welcome: ServerMessage = {
  type: 'welcome',
  sessionId: 's',
  colorKey: '0',
  currentRevision: 0,
  capabilities: { protocolVersion: 1 },
};

describe('BrowserWebSocketTransport（native WS ClientTransport・再接続）', () => {
  it('open で handleConnected を呼ぶ', () => {
    const { transport, sockets, listener } = setup();
    transport.connect();
    expect(listener.connected).toBe(0); // まだ CONNECTING
    sockets[0].open();
    expect(listener.connected).toBe(1);
  });

  it('CONNECTING 中の send はバッファし open で flush する', () => {
    const { transport, sockets } = setup();
    transport.connect();
    transport.send({ type: 'heartbeat', sentAt: 1 });
    expect(sockets[0].sent).toHaveLength(0); // CONNECTING はバッファ
    sockets[0].open();
    expect(sockets[0].sent).toHaveLength(1);
  });

  it('OPEN の send は即送信する', () => {
    const { transport, sockets } = setup();
    transport.connect();
    sockets[0].open();
    transport.send({ type: 'heartbeat', sentAt: 2 });
    expect(sockets[0].sent).toHaveLength(1);
  });

  it('受信メッセージを decode して listener へ渡す', () => {
    const { transport, sockets, listener } = setup();
    transport.connect();
    sockets[0].open();
    sockets[0].emit(JSON.stringify(welcome));
    expect(listener.messages).toEqual([welcome]);
  });

  it('不正 JSON / 未知メッセージは drop（listener 非通知・記録）', () => {
    const { transport, sockets, listener, logs } = setup();
    transport.connect();
    sockets[0].open();
    sockets[0].emit('{not json');
    sockets[0].emit(JSON.stringify({ type: 'bogus' }));
    expect(listener.messages).toHaveLength(0);
    expect(logs).toHaveLength(2);
  });

  it('予期しない close で handleDisconnected → 再接続をスケジュール → 再 open で再接続', () => {
    const { transport, sockets, timer, listener } = setup();
    transport.connect();
    sockets[0].open();
    sockets[0].fireClose();
    expect(listener.disconnected).toBe(1);
    expect(timer.pending()).toBe(1); // 再接続待機
    timer.fireAll();
    expect(sockets).toHaveLength(2); // 新ソケット生成
    sockets[1].open();
    expect(listener.connected).toBe(2); // 再接続で再び handleConnected
  });

  it('明示 close は再接続しない（タイマー解除・以後の close も無反応）', () => {
    const { transport, sockets, timer } = setup();
    transport.connect();
    sockets[0].open();
    transport.close();
    expect(sockets[0].closedByTransport).toBe(true);
    sockets[0].fireClose();
    expect(timer.pending()).toBe(0); // 再接続はスケジュールされない
  });

  it('autoReconnect=false は close 後に再接続しない', () => {
    const { transport, sockets, timer } = setup({ autoReconnect: false });
    transport.connect();
    sockets[0].open();
    sockets[0].fireClose();
    expect(timer.pending()).toBe(0);
  });

  it('onServerFrame フックに受信文字数・parse 時間を通知する（#6 計測）', () => {
    const sockets: FakeSocket[] = [];
    const factory: SocketFactory = (_url, events) => {
      const s = new FakeSocket(events);
      sockets.push(s);
      return s;
    };
    const onServerFrame = vi.fn();
    const transport = new BrowserWebSocketTransport('ws://x/ws', { socketFactory: factory, onServerFrame });
    transport.setListener({ handleServerMessage: () => {}, handleConnected: () => {}, handleDisconnected: () => {} });
    transport.connect();
    sockets[0].open();
    const frame = JSON.stringify(welcome);
    sockets[0].emit(frame);
    expect(onServerFrame).toHaveBeenCalledTimes(1);
    const arg = onServerFrame.mock.calls[0][0] as { chars: number; parseMillis: number };
    expect(arg.chars).toBe(frame.length);
    expect(arg.parseMillis).toBeGreaterThanOrEqual(0);
  });
});
