// SessionSync（DD-005 Phase 2）: browser-transport ↔ ClientSession ↔ DocumentView の結線。
//
// ClientSession を Document State の唯一の正本に保つため、サーバーメッセージは **必ず session が適用してから**
// DocumentView（Render State）へ反映する。そのため inner transport を「観測 decorator」でラップし、
// handleServerMessage の順序を session → observer に固定する（observer は適用後の文書だけを読む）。
//
// DocumentView は文書を複製しない（#2）。observer は operations の Operation 種別だけを見て dirty を立て、
// 次フレームの flush が可視範囲を読み直す。再接続時は catch-up で Document State が再収束するのに合わせ、
// Render State を全再構築する（#10 再接続経路）。

import { ClientSession } from '@nanairo-sheet/sheet-collaboration';
import type { ClientTransport, SessionConfig, TransportListener } from '@nanairo-sheet/sheet-collaboration';
import type { ServerMessage } from '@nanairo-sheet/sheet-core';

import { DocumentView } from './document-view';

/** session 適用後にサーバーメッセージ・接続イベントを観測するコールバック。 */
export interface SessionObserver {
  onServerMessage(message: ServerMessage): void;
  onConnected(): void;
  onDisconnected(): void;
}

/** 観測 decorator を含む ClientTransport（observer は後付けできる）。 */
export interface ObservingTransport extends ClientTransport {
  setObserver(observer: SessionObserver): void;
}

/**
 * inner transport をラップし、handleServerMessage/handleConnected/handleDisconnected を
 * 「session（唯一の正本）→ observer（Render 追従）」の順で配る decorator。
 */
export function createObservingTransport(inner: ClientTransport): ObservingTransport {
  let session: TransportListener | undefined;
  let observer: SessionObserver | undefined;

  const tap: TransportListener = {
    handleServerMessage(message) {
      session?.handleServerMessage(message); // 1) 唯一の正本を更新
      observer?.onServerMessage(message); // 2) 適用後の文書を Render State が読む
    },
    handleConnected() {
      session?.handleConnected();
      observer?.onConnected();
    },
    handleDisconnected() {
      session?.handleDisconnected();
      observer?.onDisconnected();
    },
  };

  return {
    setListener(listener) {
      session = listener; // = ClientSession
      inner.setListener(tap);
    },
    connect() {
      inner.connect();
    },
    send(message) {
      inner.send(message);
    },
    setObserver(next) {
      observer = next;
    },
  };
}

export interface SessionSyncConfig {
  /** 実トランスポート（browser-transport）またはテスト用（RecordingTransport）。 */
  innerTransport: ClientTransport;
  /** transport を除いた ClientSession 設定（clientId/userId/documentId/columnOrder/clock/idGenerator 等）。 */
  sessionConfig: Omit<SessionConfig, 'transport'>;
  rowHeight: number;
  colWidth: number;
  /** 接続確立時（#6 計測 wsConnected）。 */
  onConnected?: () => void;
  /** operations 受信時（#6 計測 firstSync＝Document State 初回反映）。 */
  onOperations?: () => void;
}

export interface SessionSync {
  readonly session: ClientSession;
  readonly view: DocumentView;
  /** 接続を開始する（transport.connect → join）。 */
  start(): void;
}

/**
 * ClientSession と DocumentView を結線して返す。observer は operations の種別で dirty を立て、
 * 再接続時は Render State を全再構築する。文書の正本は常に session（view は派生）。
 */
export function createSessionSync(config: SessionSyncConfig): SessionSync {
  const observing = createObservingTransport(config.innerTransport);
  const session = new ClientSession({ ...config.sessionConfig, transport: observing });
  const view = new DocumentView({
    getDocument: () => session.viewDocument, // 唯一の正本を読む派生 Adapter
    rowHeight: config.rowHeight,
    colWidth: config.colWidth,
  });

  let sawDisconnect = false;
  observing.setObserver({
    onServerMessage(message) {
      if (message.type === 'operations') {
        // session は適用済み。種別だけ見て dirty を立てる（cell/row-structure）。
        for (const envelope of message.operations) {
          view.noteOperation(envelope.operation);
        }
        config.onOperations?.();
      }
      // welcome/ack/reject/presence は Render 更新契機ではない（reject は Conflict Queue＝Phase 3 で扱う）。
    },
    onConnected() {
      config.onConnected?.();
      if (sawDisconnect) {
        // 再接続: catch-up で Document State が再収束する。Render State は全再構築で追従する（#10）。
        view.markFullRebuild();
        sawDisconnect = false;
      }
    },
    onDisconnected() {
      sawDisconnect = true;
    },
  });

  return {
    session,
    view,
    start: () => {
      session.start();
    },
  };
}
