// ヘッドレスクライアントセッション（楽観適用＋§7.7 rollback/replay）。committed（サーバー確定・権威）と
// pending（未 ACK のローカル楽観 Operation）の二層を持ち、server op 到着で rollback/replay により収束させる。
//
// 依存ゼロ・トランスポート注入: 非相対 import は @nanairo-sheet/sheet-core / @nanairo-sheet/sheet-types のみ
// （Phase 1 で sheet-collaboration へ昇格しやすく）。時刻・ID・トランスポートは全注入（Date.now/Math.random/
// crypto/DOM/Node 非参照）。判定は sheet-core の validateOperation を共有（サーバーとの乖離を構造的に防ぐ・指示 1）。

import {
  applyOperation,
  cloneCellScalar,
  cloneDocument,
  createDocument,
  deleteCell,
  deleteRowCells,
  documentHash,
  setCell,
  validateOperation,
} from '@nanairo-sheet/sheet-core';
import type {
  CellAddressById,
  ChangeSet,
  ClientMessage,
  ClientOperationEnvelope,
  DocumentOperation,
  InverseSeed,
  OperationAckMessage,
  OperationRejectedMessage,
  OperationViolation,
  OperationsMessage,
  PresenceDeltaMessage,
  PresencePayload,
  PresenceRemovedMessage,
  PresenceSnapshotMessage,
  RejectCode,
  RejectDetails,
  SelectionById,
  ServerMessage,
  ServerOperationEnvelope,
  SetCellsOperation,
  SheetDocument,
  UserPresence,
  WelcomeMessage,
} from '@nanairo-sheet/sheet-core';
import { createOperationId, createTransactionId } from '@nanairo-sheet/sheet-types';
import type { ColumnId, DocumentId, OperationId, RowId } from '@nanairo-sheet/sheet-types';

import type { Clock, IdGenerator } from './deps';

// ---- トランスポート IF（送受信・接続イベント）----

/** ClientSession が実装するトランスポートリスナー。トランスポートがサーバーメッセージ・接続イベントを push する。 */
export interface TransportListener {
  handleServerMessage(message: ServerMessage): void;
  handleConnected(): void; // 初回接続・再接続で発火 → join 送信
  handleDisconnected(): void; // 切断 → offline へ
}

/** クライアントトランスポート（in-process / 実 WS が実装）。session が注入で受け取る。 */
export interface ClientTransport {
  setListener(listener: TransportListener): void;
  connect(): void; // 接続確立 → listener.handleConnected()
  send(message: ClientMessage): void; // 送信（フォールトで drop/duplicate/delay され得る）
}

// ---- Conflict Queue（コピー可能・§10.1・I-2）----

export type ConflictReason = 'rejected' | 'revalidation-failed' | 'dependency';

export interface ConflictQueueEntry {
  operationId: OperationId;
  operation: DocumentOperation; // 元のローカル Operation（深いコピー＝「自分の値」を保全）
  clientSequence: number;
  baseRevision: number;
  reason: ConflictReason;
  code?: RejectCode; // reason==='rejected'（server 判定）
  violations?: OperationViolation[]; // reason==='revalidation-failed' or server details.violations
  details?: RejectDetails; // server reject の現在値/現在revision（解決 UI 材料・PoC-A/Phase 4）
}

// ---- pending エントリー ----

interface PendingEntry {
  envelope: ClientOperationEnvelope; // operationId/clientSequence/baseRevision 不変（再送キー）
  inverseSeed: InverseSeed; // 楽観適用時の逆操作データ（rebuildView で毎回再計算）
  acknowledged: boolean; // operationAck 受信済み（再送対象から外す）
  localNoop: boolean; // 楽観適用が空 changeSet（operations エコー無し → ACK で除去）
}

/** sendPresence が受け取る 3 種フィールド（userId/displayName は session が充填）。 */
export interface PresenceUpdate {
  activeCell?: CellAddressById;
  selectionRanges: SelectionById[];
  editingCell?: CellAddressById;
}

export interface SessionConfig {
  clientId: string;
  userId: string;
  displayName: string;
  documentId: DocumentId;
  columnOrder: ColumnId[];
  transport: ClientTransport;
  clock: Clock;
  idGenerator: IdGenerator;
  protocolVersion?: number; // 既定 1
  resendTimeoutMillis?: number; // 既定 5000（再送タイマー）
  catchupPollMillis?: number; // 既定 resendTimeoutMillis（周期 catch-up ポーリング間隔・tail 欠落回復）
  maxOfflineMillis?: number; // 既定 30000（§8.5・Q-4）
  maxOfflinePending?: number; // 既定 100（§8.5・Q-4）
}

const DEFAULT_PROTOCOL_VERSION = 1;
const DEFAULT_RESEND_TIMEOUT = 5_000;
const DEFAULT_MAX_OFFLINE_MILLIS = 30_000; // §8.5 暫定
const DEFAULT_MAX_OFFLINE_PENDING = 100; // §8.5 暫定

export class ClientSession implements TransportListener {
  private readonly clientId: string;
  private readonly userId: string;
  private readonly displayName: string;
  private readonly documentId: DocumentId;
  private readonly protocolVersion: number;
  private readonly resendTimeoutMillis: number;
  private readonly catchupPollMillis: number;
  private readonly maxOfflineMillis: number;
  private readonly maxOfflinePending: number;
  private readonly transport: ClientTransport;
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;

  private committed: SheetDocument;
  private view: SheetDocument;
  private pending: PendingEntry[] = [];
  private readonly conflicts: ConflictQueueEntry[] = [];
  private expectedRevision: number; // = committed.revision + 1
  private readonly revisionBuffer = new Map<number, ServerOperationEnvelope>();
  private lastCatchupRequestedRevision: number | undefined = undefined;
  private readonly knownPresence = new Map<string, UserPresence>();

  private _connectionId: string | undefined = undefined;
  private _colorKey: string | undefined = undefined;
  private online = false;
  private offlineSince = 0;
  private stopped = false;
  private lastClientSequence = 0;
  private presenceSequence = 0;
  private lastPresence: PresenceUpdate | undefined = undefined;
  private lastSendAt = 0;
  private lastPollAt = 0;
  private awaitingSync = false;
  private knownServerRevision: number | undefined = undefined;

  constructor(config: SessionConfig) {
    this.clientId = config.clientId;
    this.userId = config.userId;
    this.displayName = config.displayName;
    this.documentId = config.documentId;
    this.protocolVersion = config.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    this.resendTimeoutMillis = config.resendTimeoutMillis ?? DEFAULT_RESEND_TIMEOUT;
    this.catchupPollMillis = config.catchupPollMillis ?? this.resendTimeoutMillis;
    this.maxOfflineMillis = config.maxOfflineMillis ?? DEFAULT_MAX_OFFLINE_MILLIS;
    this.maxOfflinePending = config.maxOfflinePending ?? DEFAULT_MAX_OFFLINE_PENDING;
    this.transport = config.transport;
    this.clock = config.clock;
    this.idGenerator = config.idGenerator;
    this.committed = createDocument(config.columnOrder);
    this.view = this.committed;
    this.expectedRevision = this.committed.revision + 1;
    this.transport.setListener(this);
  }

  /** 接続を開始する（transport.connect → handleConnected → join 送信）。 */
  start(): void {
    this.transport.connect();
  }

  // ---- ローカル操作 ----

  /** ローカル Operation を楽観適用し送信する（未 ACK は pending に保持）。stopped 時は throw。 */
  submitLocalOperation(operation: DocumentOperation): OperationId {
    if (this.stopped) {
      throw new Error('ClientSession: stopped (reconnect window exceeded); editing disabled');
    }
    const operationId = createOperationId(this.idGenerator.next());
    this.lastClientSequence += 1;
    const envelope: ClientOperationEnvelope = {
      protocolVersion: this.protocolVersion,
      documentId: this.documentId,
      operationId,
      transactionId: createTransactionId(`tx-${operationId}`),
      actorId: this.userId,
      clientId: this.clientId,
      clientSequence: this.lastClientSequence,
      baseRevision: this.committed.revision,
      operation,
    };
    this.pending.push({ envelope, inverseSeed: emptyInverseSeed(), acknowledged: false, localNoop: false });
    this.rebuildView(); // 楽観適用（無効なら Conflict Queue へ）
    if (this.online && !this.stopped) {
      this.sendSubmit(envelope);
    }
    this.checkOfflineLimits();
    return operationId;
  }

  /** Presence を送る（connection 単位・単調 sequence。userId/displayName を充填）。 */
  sendPresence(presence: PresenceUpdate): void {
    this.lastPresence = presence;
    this.presenceSequence += 1;
    const payload: PresencePayload = {
      userId: this.userId,
      displayName: this.displayName,
      activeCell: presence.activeCell,
      selectionRanges: presence.selectionRanges,
      editingCell: presence.editingCell,
    };
    this.transport.send({ type: 'presence', sequence: this.presenceSequence, payload });
  }

  /** heartbeat を送る（生存通知・注入クロックの sentAt）。 */
  sendHeartbeat(): void {
    this.transport.send({ type: 'heartbeat', sentAt: this.clock.now() });
  }

  /** 注入クロック駆動のタイマー処理（再送タイマー満了・offline 上限・欠落 catch-up の再要求）。app 層が周期呼び出しする。 */
  tick(): void {
    this.checkOfflineLimits();
    if (!this.online || this.stopped) {
      return;
    }
    const now = this.clock.now();
    if (this.hasUnackedPending() && now - this.lastSendAt >= this.resendTimeoutMillis) {
      this.resendAllPending();
    }
    // 周期的 catch-up ポーリング（DA D26: 検知できない tail 欠落・未知のサーバー前進を回復する）。
    // 受信済み revision より先を1件も受け取れず（buffer 空・後続 op も欠落）gap 検知が起きない静止系でも、
    // requestCatchup{afterRevision: expectedRevision-1} を周期送信すればサーバーが差分を返し収束する
    // （requestCatchup は既存プロトコル・afterRevision=expectedRevision-1 で全 catch-up ケースを包含）。
    if (now - this.lastPollAt >= this.catchupPollMillis) {
      this.lastPollAt = now;
      this.requestCatchup();
    }
  }

  // ---- TransportListener ----

  handleConnected(): void {
    this.online = true;
    this.awaitingSync = true;
    this.knownServerRevision = undefined;
    this.sendJoin();
  }

  handleDisconnected(): void {
    this.online = false;
    this.offlineSince = this.clock.now();
  }

  handleServerMessage(message: ServerMessage): void {
    // 同期処理単位＝1 ServerMessage（rollback/replay 中に別受信が割り込まない・DA）。
    switch (message.type) {
      case 'welcome':
        this.handleWelcome(message);
        break;
      case 'operations':
        this.handleOperations(message);
        break;
      case 'operationAck':
        this.handleAck(message);
        break;
      case 'operationRejected':
        this.handleRejected(message);
        break;
      case 'presenceSnapshot':
        this.handlePresenceSnapshot(message);
        break;
      case 'presenceDelta':
        this.handlePresenceDelta(message);
        break;
      case 'presenceRemoved':
        this.handlePresenceRemoved(message);
        break;
      case 'heartbeatAck':
        break; // PoC: 記録なし
    }
  }

  // ---- 受信処理 ----

  private handleWelcome(message: WelcomeMessage): void {
    this._connectionId = message.sessionId;
    this._colorKey = message.colorKey; // 自色（welcome 拡張・指示 3）
    this.knownServerRevision = message.currentRevision;
    // 既知サーバー revision（currentRevision）に committed が未達なら差分を要求する
    // （初期/再接続の operations 配信が欠落しても welcome が到達すれば回復できる）。
    if (this.needsCatchup()) {
      this.requestCatchup();
    }
    this.maybeFinalizeSync();
  }

  private handleOperations(message: OperationsMessage): void {
    for (const envelope of message.operations) {
      if (envelope.revision < this.expectedRevision) {
        continue; // 期待より小さい revision は重複無視（I-3・S-I3）
      }
      this.revisionBuffer.set(envelope.revision, envelope);
    }
    this.drainBuffer();
  }

  private drainBuffer(): void {
    // バッファから nextExpectedRevision を連続適用（欠落で停止・順序を飛ばさない・S-I4）。
    for (;;) {
      const envelope = this.revisionBuffer.get(this.expectedRevision);
      if (envelope === undefined) {
        break;
      }
      this.revisionBuffer.delete(this.expectedRevision);
      this.reconcileServerOperation(envelope);
    }
    if (this.revisionBuffer.size > 0) {
      // gap 残存 → catch-up（gap 位置が変わったときだけ再要求＝重複抑止・S-I4/S-I5）
      if (this.lastCatchupRequestedRevision !== this.expectedRevision) {
        this.lastCatchupRequestedRevision = this.expectedRevision;
        if (this.online) {
          this.transport.send({ type: 'requestCatchup', afterRevision: this.expectedRevision - 1 });
          this.lastSendAt = this.clock.now();
        }
      }
    } else {
      this.lastCatchupRequestedRevision = undefined;
    }
    this.maybeFinalizeSync();
  }

  /** §7.7 rollback/replay: server op を committed へ適用 → own 除去 → 残 pending 再検証・再適用。 */
  private reconcileServerOperation(serverEnv: ServerOperationEnvelope): void {
    // committed は権威（rollback から導出しない・DA D22）。server op は Room 検証済ゆえ throw しない。
    this.committed = applyOperation(this.committed, serverEnv.operation, {
      revision: serverEnv.revision,
    }).document;
    this.expectedRevision = serverEnv.revision + 1;
    this.removeFromPending(serverEnv.operationId); // own 除去（冪等・operationId 一致・S-H2/H4）
    this.rebuildView(); // 残 pending 再検証＋再適用＋不成立は Conflict Queue（手順4-6）
  }

  private handleAck(message: OperationAckMessage): void {
    // ACK は「この op が revision まで確定した」を示す。committed が未達（operations エコー欠落）でも
    // 既知サーバー revision の下限にして catch-up で回復できるようにする（静止系で echo 欠落しても収束・DA D25）。
    if (this.knownServerRevision === undefined || message.revision > this.knownServerRevision) {
      this.knownServerRevision = message.revision;
    }
    const entry = this.pending.find((e) => e.envelope.operationId === message.operationId);
    if (entry === undefined) {
      return; // echo 先着で除去済み or duplicate ACK → no-op（S-H4）
    }
    entry.acknowledged = true; // 再送抑止
    if (entry.localNoop) {
      // noop は operations エコーが来ない → ACK で pending 除去（S-E3・Q-1）
      this.removeFromPending(message.operationId);
      this.rebuildView();
    }
  }

  private handleRejected(message: OperationRejectedMessage): void {
    if (message.code === 'client-sequence-violation') {
      // 欠落回復: 先頭から再送（pending 除去しない・指示 2）
      this.resendAllPending();
      return;
    }
    const index = this.pending.findIndex((e) => e.envelope.operationId === message.operationId);
    if (index === -1) {
      return; // 既に除去済み（reject は二重適用を起こさない）
    }
    const entry = this.pending[index];
    this.pending.splice(index, 1);
    this.conflicts.push(
      this.makeConflictEntry(entry, 'rejected', message.details?.violations, message.code, message.details),
    );
    this.rebuildView(); // reject 済み op は再送しない（pending から除去済み・指示 2）
  }

  private handlePresenceSnapshot(message: PresenceSnapshotMessage): void {
    this.knownPresence.clear();
    for (const user of message.users) {
      if (user.connectionId === this._connectionId) {
        continue; // 自分は除外
      }
      this.knownPresence.set(user.connectionId, user);
    }
  }

  private handlePresenceDelta(message: PresenceDeltaMessage): void {
    if (message.presence.connectionId === this._connectionId) {
      return;
    }
    this.knownPresence.set(message.presence.connectionId, message.presence);
  }

  private handlePresenceRemoved(message: PresenceRemovedMessage): void {
    this.knownPresence.delete(message.sessionId);
  }

  // ---- rollback/replay 本体 ----

  /**
   * committed に pending を順に再適用して view を再構築する（§7.7 手順4-6）。
   * validateOperation（sheet-core 共有・指示 1）で違反する pending は Conflict Queue へ。
   * 先行 pending が失効した行に触れる後続 pending は依存失効（連鎖・S-H3）。
   */
  private rebuildView(): void {
    let doc = this.committed;
    let provisional = this.committed.revision;
    const survived: PendingEntry[] = [];
    const invalidatedRows = new Set<RowId>();
    for (const entry of this.pending) {
      const op = entry.envelope.operation;
      const touched = touchedRows(op);
      const dependsOnInvalidated = touched.some((r) => invalidatedRows.has(r));
      const violations = dependsOnInvalidated ? [] : validateOperation(doc, op);
      if (!dependsOnInvalidated && violations.length === 0) {
        provisional += 1;
        const result = applyOperation(doc, op, { revision: provisional });
        const localNoop = isEmptyChangeSet(result.changeSet);
        if (localNoop && entry.acknowledged) {
          // ACK 済みかつ再適用が空 changeSet ＝ サーバーも noop 確定（競合 DeleteRows の敗者＝既に
          // tombstone 済み行への再 Delete・S-E4）。noop は operations エコーが来ないため echo 経由では
          // pending から除去されず、noop ACK が「並行 delete の echo」より先着したケースでは localNoop=false
          // のまま残り続けて収束が止まる（Codex [P1]・DA D33）。committed が並行 delete を取り込んで空
          // changeSet 化した本時点で除去する。seq は消費済み（ACK 済み）ゆえ除去しても再送順序は不変・二重適用0。
          continue; // survived に積まない＝除去。doc は空 changeSet ゆえ据え置きで view 不変。
        }
        doc = result.document;
        survived.push({
          envelope: entry.envelope,
          inverseSeed: result.inverseSeed,
          acknowledged: entry.acknowledged,
          localNoop,
        });
      } else {
        for (const r of touched) {
          invalidatedRows.add(r);
        }
        this.conflicts.push(
          this.makeConflictEntry(
            entry,
            dependsOnInvalidated ? 'dependency' : 'revalidation-failed',
            violations,
          ),
        );
      }
    }
    this.pending = survived;
    this.view = doc;
  }

  // ---- 再送・再接続 ----

  private sendJoin(): void {
    this.transport.send({
      type: 'join',
      protocolVersion: this.protocolVersion,
      documentId: this.documentId,
      lastAppliedRevision: this.committed.revision, // 先にサーバー差分を要求（§8.5）
      clientId: this.clientId, // 再接続で不変（S-J4）
    });
    this.lastSendAt = this.clock.now();
  }

  private sendSubmit(envelope: ClientOperationEnvelope): void {
    this.transport.send({ type: 'submitOperation', envelope });
    this.lastSendAt = this.clock.now();
  }

  /** un-ACK の pending を先頭から同一 operationId・同一 clientSequence で再送（指示 2）。 */
  private resendAllPending(): void {
    if (!this.online || this.stopped) {
      return;
    }
    for (const entry of this.pending) {
      if (!entry.acknowledged) {
        this.transport.send({ type: 'submitOperation', envelope: entry.envelope });
      }
    }
    this.lastSendAt = this.clock.now();
  }

  /** サーバー差分が target まで届いたら pending 再送・Presence 再登録（§8.5・先に差分→後に再送）。 */
  private maybeFinalizeSync(): void {
    if (!this.awaitingSync || this.knownServerRevision === undefined) {
      return;
    }
    if (this.revisionBuffer.size > 0) {
      return; // まだ catch-up 中
    }
    if (this.expectedRevision <= this.knownServerRevision) {
      return; // committed が target 未達
    }
    this.awaitingSync = false;
    this.resendAllPending(); // 生存 pending を再送（stale は既に Conflict Queue へ・S-J2/J3）
    if (this.lastPresence !== undefined) {
      this.sendPresence(this.lastPresence); // 新 connectionId で Presence 再登録（デモ再表示）
    }
  }

  private checkOfflineLimits(): void {
    if (this.stopped || this.online) {
      return;
    }
    if (this.clock.now() - this.offlineSince > this.maxOfflineMillis) {
      this.stopped = true; // 切断時間上限（S-J5・Q-4）
    }
    if (this.pending.length > this.maxOfflinePending) {
      this.stopped = true; // 切断中 pending 件数上限（S-J5・Q-4）
    }
  }

  private needsCatchup(): boolean {
    if (this.revisionBuffer.size > 0) {
      return true; // gap がバッファに残る（先着 revision が未適用）
    }
    // 既知サーバー revision（welcome.currentRevision）に committed が未達（進めるバッファも無い）
    return this.knownServerRevision !== undefined && this.expectedRevision <= this.knownServerRevision;
  }

  private requestCatchup(): void {
    if (!this.online) {
      return;
    }
    this.transport.send({ type: 'requestCatchup', afterRevision: this.expectedRevision - 1 });
    this.lastSendAt = this.clock.now();
  }

  private removeFromPending(operationId: OperationId): boolean {
    const index = this.pending.findIndex((e) => e.envelope.operationId === operationId);
    if (index === -1) {
      return false;
    }
    this.pending.splice(index, 1);
    return true;
  }

  private hasUnackedPending(): boolean {
    return this.pending.some((e) => !e.acknowledged);
  }

  private makeConflictEntry(
    entry: PendingEntry,
    reason: ConflictReason,
    violations?: OperationViolation[],
    code?: RejectCode,
    details?: RejectDetails,
  ): ConflictQueueEntry {
    return {
      operationId: entry.envelope.operationId,
      operation: cloneOperation(entry.envelope.operation), // 深いコピー（コピー可能に保全）
      clientSequence: entry.envelope.clientSequence,
      baseRevision: entry.envelope.baseRevision,
      reason,
      code,
      violations: violations !== undefined && violations.length > 0 ? violations : undefined,
      details,
    };
  }

  // ---- 検査用（テスト・Phase 4 デモ）----

  get committedDocument(): SheetDocument {
    return this.committed;
  }

  get viewDocument(): SheetDocument {
    return this.view;
  }

  committedHash(): string {
    return documentHash(this.committed);
  }

  viewHash(): string {
    return documentHash(this.view);
  }

  get nextExpectedRevision(): number {
    return this.expectedRevision;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  pendingOperationIds(): OperationId[] {
    return this.pending.map((e) => e.envelope.operationId);
  }

  get conflictQueue(): readonly ConflictQueueEntry[] {
    return this.conflicts;
  }

  get connectionId(): string | undefined {
    return this._connectionId;
  }

  get colorKey(): string | undefined {
    return this._colorKey;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  get isOnline(): boolean {
    return this.online;
  }

  /** 他接続の Presence（Phase 4 デモの名前・色表示用。自分は含まない）。 */
  knownPresences(): UserPresence[] {
    return [...this.knownPresence.values()];
  }

  /**
   * view を pending の inverseSeed で逆順 rollback した baseline の hash（DA 逆操作復元の検証用）。
   * 行構造・空セル前値では committed と厳密一致。既存セル上書きは InverseSeed に before-revision が無く
   * 非厳密（D22）。ゆえに committed は本メソッドから導出せず権威管理する（収束担保）。
   */
  rollbackBaselineHash(): string {
    let doc = this.view;
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      doc = applyInverseSeed(doc, this.pending[i].inverseSeed);
    }
    return documentHash(doc);
  }
}

// ---- 純粋ヘルパー ----

/**
 * InverseSeed を逆適用して doc を 1 Operation 分だけ rollback する（§7.7 手順1・Phase 3 消費者契約）。
 * - insertedRowIds を除去（rowOrder/rowMeta/cells）。
 * - deletedRows を un-tombstone in place（index で splice しない・DA D10）。
 * - cells を前値へ復元（後ろから＝forward の逆順・DA D15）。前値=blank は不在へ（行/空セルは厳密復元）。
 *   前値=非空は値のみ復元（InverseSeed は before-revision を持たない＝非厳密・D22）。
 */
export function applyInverseSeed(doc: SheetDocument, seed: InverseSeed): SheetDocument {
  const next = cloneDocument(doc);
  for (const rowId of seed.insertedRowIds) {
    const index = next.rowOrder.indexOf(rowId);
    if (index !== -1) {
      next.rowOrder.splice(index, 1);
    }
    deleteRowCells(next, rowId); // slot 解決に rowMeta を使うため rowMeta.delete より前に消す
    next.rowMeta.delete(rowId);
  }
  for (const deleted of seed.deletedRows) {
    const meta = next.rowMeta.get(deleted.rowId);
    if (meta !== undefined) {
      meta.tombstone = deleted.meta.tombstone; // 削除前（false）へ un-tombstone
      meta.lastChangedRevision = deleted.meta.lastChangedRevision;
    }
  }
  for (let i = seed.cells.length - 1; i >= 0; i -= 1) {
    const change = seed.cells[i];
    const before = change.value;
    if (before === undefined || before.kind === 'blank') {
      deleteCell(next, change.rowId, change.columnId); // 前値=空 → 不在へ（hash 上等価・S-B3）
      continue;
    }
    // before-revision 不明（D22）。値のみ復元し revision は 0（既存セル上書きの rollback は非厳密）。
    setCell(next, change.rowId, change.columnId, { value: cloneCellScalar(before), lastChangedRevision: 0 });
  }
  return next;
}

/** Operation が触れる RowId（依存失効の判定用）。 */
function touchedRows(op: DocumentOperation): RowId[] {
  switch (op.type) {
    case 'setCells':
      return op.changes.map((c) => c.rowId);
    case 'insertRows':
      return op.rows.map((r) => r.rowId);
    case 'deleteRows':
      return op.rowIds;
  }
}

/** Operation を深くコピーする（Conflict Queue の「自分の値」保全用・as 不使用）。 */
function cloneOperation(op: DocumentOperation): DocumentOperation {
  switch (op.type) {
    case 'setCells': {
      const changes: SetCellsOperation['changes'] = op.changes.map((c) =>
        c.beforeRevision === undefined
          ? { rowId: c.rowId, columnId: c.columnId, value: cloneCellScalar(c.value) }
          : {
              rowId: c.rowId,
              columnId: c.columnId,
              beforeRevision: c.beforeRevision,
              value: cloneCellScalar(c.value),
            },
      );
      return { type: 'setCells', conflictPolicy: op.conflictPolicy, changes };
    }
    case 'insertRows':
      return {
        type: 'insertRows',
        afterRowId: op.afterRowId,
        rows: op.rows.map((r) => (r.height === undefined ? { rowId: r.rowId } : { rowId: r.rowId, height: r.height })),
      };
    case 'deleteRows':
      return { type: 'deleteRows', rowIds: [...op.rowIds] };
  }
}

function isEmptyChangeSet(changeSet: ChangeSet): boolean {
  return (
    changeSet.cells.length === 0 &&
    changeSet.rowsInserted.length === 0 &&
    changeSet.rowsDeleted.length === 0
  );
}

function emptyInverseSeed(): InverseSeed {
  return { cells: [], insertedRowIds: [], deletedRows: [] };
}
