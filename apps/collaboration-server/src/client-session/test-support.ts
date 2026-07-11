// テスト補助（.test.ts から import。vitest の include（*.test.ts）対象外ゆえテストとしては実行されない）。
// 決定的な手動クロック・記録用トランスポート（RecordingTransport）・Operation/Envelope ビルダーを提供する。
// client-session 本体（session.ts）はここを import しない（本体は sheet-core/sheet-types のみ）。

import type {
  CellScalar,
  ClientMessage,
  DeleteRowsOperation,
  DocumentOperation,
  InsertRowsOperation,
  ServerMessage,
  ServerOperationEnvelope,
  SetCellsOperation,
} from '@nanairo-sheet/sheet-core';
import {
  createColumnId,
  createDocumentId,
  createOperationId,
  createRowId,
  createTransactionId,
} from '@nanairo-sheet/sheet-types';
import type { ColumnId, RowId } from '@nanairo-sheet/sheet-types';

import type { Clock } from './deps';
import type { ClientTransport, TransportListener } from './session';

/** 手動で進められる決定的クロック（再送タイマー/offline 上限をテストで制御する）。 */
export interface ManualClock extends Clock {
  set(time: number): void;
  advance(delta: number): void;
}

export function createManualClock(start = 0): ManualClock {
  let time = start;
  return {
    now: () => time,
    set: (value: number) => {
      time = value;
    },
    advance: (delta: number) => {
      time += delta;
    },
  };
}

export const col = (value: string): ColumnId => createColumnId(value);
export const row = (value: string): RowId => createRowId(value);
export const str = (value: string): CellScalar => ({ kind: 'string', value });
export const num = (value: number): CellScalar => ({ kind: 'number', value });

export const COLUMNS: ColumnId[] = [col('col-a'), col('col-b'), col('col-c')];

export const setCells = (changes: SetCellsOperation['changes']): SetCellsOperation => ({
  type: 'setCells',
  changes,
  conflictPolicy: 'reject-overlap',
});
export const insertRows = (afterRowId: RowId | null, rowIds: string[]): InsertRowsOperation => ({
  type: 'insertRows',
  afterRowId,
  rows: rowIds.map((r) => ({ rowId: createRowId(r) })),
});
export const deleteRows = (rowIds: RowId[]): DeleteRowsOperation => ({
  type: 'deleteRows',
  rowIds,
});

/** 別クライアント（または自分のエコー）の ServerOperationEnvelope を作る。revision はサーバー付与。 */
export function serverEnvelope(o: {
  revision: number;
  operationId: string;
  operation: DocumentOperation;
  clientId?: string;
  clientSequence?: number;
  baseRevision?: number;
  actorId?: string;
}): ServerOperationEnvelope {
  const operationId = o.operationId;
  return {
    protocolVersion: 1,
    documentId: createDocumentId('doc-1'),
    operationId: createOperationId(operationId),
    transactionId: createTransactionId(`tx-${operationId}`),
    actorId: o.actorId ?? 'user-other',
    clientId: o.clientId ?? 'client-other',
    clientSequence: o.clientSequence ?? 1,
    baseRevision: o.baseRevision ?? o.revision - 1,
    operation: o.operation,
    revision: o.revision,
    acceptedAt: '2026-07-11T00:00:00.000Z',
    canonicalOperation: o.operation,
  };
}

/** 連続する ServerOperationEnvelope から operations メッセージを作る。 */
export function operationsMessage(operations: ServerOperationEnvelope[]): ServerMessage {
  return {
    type: 'operations',
    fromRevision: operations[0].revision,
    toRevision: operations[operations.length - 1].revision,
    operations,
  };
}

// ユーザー定義型ガード（P02 許容）: 総称 T の判別ユニオン絞り込みを表現する。
function isClientMessageOfType<T extends ClientMessage['type']>(
  message: ClientMessage,
  type: T,
): message is Extract<ClientMessage, { type: T }> {
  return message.type === type;
}

/**
 * 記録用トランスポート（ユニットテスト用）。session が送ったメッセージを sent に記録し、
 * receive/drop/reconnect でサーバーメッセージ・接続イベントを session へ手動注入する。
 */
export class RecordingTransport implements ClientTransport {
  readonly sent: ClientMessage[] = [];
  private listener: TransportListener | undefined;

  setListener(listener: TransportListener): void {
    this.listener = listener;
  }

  connect(): void {
    this.requireListener().handleConnected();
  }

  send(message: ClientMessage): void {
    this.sent.push(message);
  }

  /** サーバーメッセージを session へ配送する。 */
  receive(message: ServerMessage): void {
    this.requireListener().handleServerMessage(message);
  }

  /** 切断イベントを session へ通知する。 */
  drop(): void {
    this.requireListener().handleDisconnected();
  }

  /** 再接続イベント（handleConnected）を session へ通知する。 */
  reconnect(): void {
    this.requireListener().handleConnected();
  }

  sentOfType<T extends ClientMessage['type']>(type: T): Array<Extract<ClientMessage, { type: T }>> {
    const result: Array<Extract<ClientMessage, { type: T }>> = [];
    for (const message of this.sent) {
      if (isClientMessageOfType(message, type)) {
        result.push(message);
      }
    }
    return result;
  }

  clear(): void {
    this.sent.length = 0;
  }

  private requireListener(): TransportListener {
    if (this.listener === undefined) {
      throw new Error('RecordingTransport: listener not set');
    }
    return this.listener;
  }
}
