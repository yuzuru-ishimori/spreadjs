// プロトコルメッセージ型（DD-003 Phase 2・主セッション指示 2・型のみ / ランタイムコードなし）。
// protocol-subset.md §1（採用メッセージ）・§3（reject コード）・§6（Presence）を型で確定する。
// server-core と Phase 3 クライアントの両方がここを import する（クライアントが server-core に依存しない構成を保つ）。
//
// 配置判断（DDログ記録）: Operation Envelope（Client/Server）は Phase 1 で operations.ts に定義済みのため
// ここで二重定義せず type import して message でラップする。message union / reject コード / Presence 型のみ本ファイルに追加する。

import type { DocumentSnapshot } from './document-snapshot';
import type { ClientOperationEnvelope, ServerOperationEnvelope } from './operations';
import type { OperationViolation } from './validate';

import type { ColumnId, DocumentId, OperationId, RowId } from '@nanairo-sheet/types';

// ---- reject コード（protocol-subset §3。duplicate-row は指示 3 で新設）----

export type RejectCode =
  | 'stale-cell-revision'
  | 'target-row-deleted'
  | 'unknown-anchor'
  | 'unknown-row'
  | 'unknown-column'
  | 'invalid-base-revision'
  | 'client-sequence-violation'
  | 'duplicate-row';

/** reject の details。code ごとに使うフィールドが異なる最小構造（any 不使用）。 */
export interface RejectDetails {
  violations?: OperationViolation[]; // 検証 reject。SetCells 原子性で全違反を列挙する（§3）
  currentRevision?: number; // invalid-base-revision
  expectedSequence?: number; // client-sequence-violation
  receivedSequence?: number; // client-sequence-violation
}

// ---- Presence（protocol-subset §6・connection 単位）----

export interface CellAddressById {
  rowId: RowId;
  columnId: ColumnId;
}

/** 矩形選択範囲（RowId/ColumnId 参照。§9.2）。 */
export interface SelectionById {
  startRowId: RowId;
  startColumnId: ColumnId;
  endRowId: RowId;
  endColumnId: ColumnId;
}

/** クライアントが送る Presence ペイロード（3 種フィールド＋識別）。colorKey/connectionId はサーバー付与ゆえ含まない。 */
export interface PresencePayload {
  userId: string;
  displayName: string;
  activeCell?: CellAddressById;
  selectionRanges: SelectionById[];
  editingCell?: CellAddressById;
}

/** サーバーが配信する Presence（connectionId/colorKey/sequence をサーバー付与）。 */
export interface UserPresence extends PresencePayload {
  connectionId: string;
  colorKey: string;
  sequence: number;
}

// ---- Client → Server（§1）----

export interface JoinMessage {
  type: 'join';
  protocolVersion: number;
  documentId: DocumentId;
  lastAppliedRevision: number;
  clientId: string;
}

export interface SubmitOperationMessage {
  type: 'submitOperation';
  envelope: ClientOperationEnvelope;
}

export interface PresenceClientMessage {
  type: 'presence';
  sequence: number; // connection 単位で単調増加
  payload: PresencePayload;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  sentAt: number;
}

export interface RequestCatchupMessage {
  type: 'requestCatchup';
  afterRevision: number;
}

export type ClientMessage =
  | JoinMessage
  | SubmitOperationMessage
  | PresenceClientMessage
  | HeartbeatMessage
  | RequestCatchupMessage;

/** join を除くクライアントメッセージ（確立済み接続からのメッセージ）。Room.handleMessage の入力。 */
export type ClientMessageExceptJoin = Exclude<ClientMessage, JoinMessage>;

// ---- Server → Client（§1）----

export interface Capabilities {
  protocolVersion: number;
}

export interface WelcomeMessage {
  type: 'welcome';
  sessionId: string; // = connectionId（Presence 管理単位）
  colorKey: string; // 自接続の割当色（Phase 3 指示 3・自分の colorKey を join 時に知る＝welcome 拡張）
  currentRevision: number;
  capabilities: Capabilities;
}

export interface OperationsMessage {
  type: 'operations';
  fromRevision: number;
  toRevision: number;
  operations: ServerOperationEnvelope[];
}

/**
 * snapshot bootstrap（DD-014-1・CG-3）: fresh join（lastAppliedRevision=0）に対しサーバーが返す。
 * クライアントは全 operationLog を replay せず、この document@revision から committed を確立し tail のみ適用する
 * （§8 既知制約「snapshotベース初期化」回収・P1-6/P1-7）。document は durable frontier 以下（未 durable を配らない）。
 */
export interface BootstrapMessage {
  type: 'bootstrap';
  document: DocumentSnapshot; // document@revision（durable frontier 以下の権威文書）
  revision: number; // = document.revision（committed の確定 revision）
}

export interface OperationAckMessage {
  type: 'operationAck';
  operationId: OperationId;
  revision: number;
}

export interface OperationRejectedMessage {
  type: 'operationRejected';
  operationId: OperationId;
  code: RejectCode;
  details?: RejectDetails;
}

export interface PresenceSnapshotMessage {
  type: 'presenceSnapshot';
  users: UserPresence[];
}

export interface PresenceDeltaMessage {
  type: 'presenceDelta';
  presence: UserPresence;
}

export interface PresenceRemovedMessage {
  type: 'presenceRemoved';
  sessionId: string; // = connectionId
}

export interface HeartbeatAckMessage {
  type: 'heartbeatAck';
  serverTime: number;
}

export type ServerMessage =
  | WelcomeMessage
  | OperationsMessage
  | BootstrapMessage
  | OperationAckMessage
  | OperationRejectedMessage
  | PresenceSnapshotMessage
  | PresenceDeltaMessage
  | PresenceRemovedMessage
  | HeartbeatAckMessage;
