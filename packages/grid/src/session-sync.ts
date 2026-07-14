// SessionSync（DD-005 Phase 2）: browser-transport ↔ ClientSession ↔ DocumentView の結線。
//
// ClientSession を Document State の唯一の正本に保つため、サーバーメッセージは **必ず session が適用してから**
// DocumentView（Render State）へ反映する。そのため inner transport を「観測 decorator」でラップし、
// handleServerMessage の順序を session → observer に固定する（observer は適用後の文書だけを読む）。
//
// DocumentView は文書を複製しない（#2）。observer は operations の Operation 種別だけを見て dirty を立て、
// 次フレームの flush が可視範囲を読み直す。再接続時は catch-up で Document State が再収束するのに合わせ、
// Render State を全再構築する（#10 再接続経路）。

import { ClientSession } from '@nanairo-sheet/collab';
import type { ClientTransport, SessionConfig, TransportListener } from '@nanairo-sheet/collab';
import type { ServerMessage } from '@nanairo-sheet/core';

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
      // session は適用済み。種別ごとに Render State の dirty を立てる（Render は常に Document State を追う・#1/#2）。
      switch (message.type) {
        case 'bootstrap':
          // snapshot bootstrap（DD-014-1）: committed が document@R へ丸ごと差し替わる。Render State は全再構築で追従
          // （全 operationLog を replay せず初期ロードを確立・§8 既知制約回収）。firstSync 計測も初回同期として点火する。
          view.markFullRebuild();
          config.onOperations?.();
          break;
        case 'operations':
          for (const envelope of message.operations) {
            view.noteOperation(envelope.operation);
          }
          config.onOperations?.();
          break;
        case 'operationRejected':
          // reject で楽観 pending がロールバックされ viewDocument が committed へ戻る（描画値が変わりうる）。
          // セル dirty を立てて可視範囲を描き直す。さもないと自分の rejected draft が Canvas に残る（Codex P1）。
          view.markCellDirty();
          break;
        case 'presenceSnapshot':
        case 'presenceDelta':
        case 'presenceRemoved':
          // 他者 Presence の出現/移動/消滅は overlay-layer の再描画契機。dirty を立てないと、受信側がアイドルの間
          // 他者カーソル/名前タグが次の viewport/文書更新まで反映されない（シナリオ10・Codex P1）。
          view.markViewportDirty();
          break;
        // welcome/operationAck/heartbeatAck は Render 更新契機ではない（ack は値不変で pending→committed の昇格のみ）。
      }
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
