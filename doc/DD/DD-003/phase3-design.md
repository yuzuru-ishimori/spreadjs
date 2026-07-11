# DD-003 Phase 3 詳細設計: ヘッドレスクライアント（楽観適用＋rollback/replay）

> Phase 3（`apps/collaboration-server/src/client-session/`）の 📐 実装前詳細化。committed/pending 二層・
> §7.7 rollback/replay・Conflict Queue・トランスポート IF・再送ポリシー・再接続手順・Presence 送信・
> catch-up バッファ・フォールト注入カウンターを確定する。`scenarios.md`（H/I/J/G）・`protocol-subset.md`
> （§2 識別子・§5 処理順・§6 Presence・§7 catch-up/再接続）・`phase1-design.md`（InverseSeed 契約）・
> `phase2-design.md`（Room/Sequencer/Presence の in/out）と型・用語・境界仕様を一致させる。
> **client-session 本体（`session.ts`）の非相対 import は `@nanairo-sheet/sheet-core` / `@nanairo-sheet/sheet-types` のみ**
> （依存ゼロ原則・Phase 1 で `sheet-collaboration` へ昇格しやすく）。`inprocess-transport.ts` は試験ハーネスゆえ
> Room（server-core）に依存してよい。ランタイム依存なし・DOM/Node 非参照（クロック・ID・トランスポート全注入）。

## 0. モジュール構成（依存 DAG・循環なし）

```
@nanairo-sheet/sheet-types  ← @nanairo-sheet/sheet-core（apply/validate/hash/protocol）
        ↑                                   ↑
   deps.ts（Clock/IdGenerator）        session.ts（ClientSession・本体）
        ↑                                   ↑（型のみ）
        └──────────── inprocess-transport.ts（Room 直結・フォールト注入）→ @nanairo-sheet/sheet-server-core
```

- **`deps.ts`**: `Clock`/`IdGenerator` インターフェースと決定的 `createCounterIdGenerator`（server-core deps の
  ミラーだが **import しない**＝session を server-core 非依存に保つ）。純粋・import なし。
- **`session.ts`**: `ClientSession` 本体＋`ClientTransport`/`TransportListener` インターフェース＋
  `applyInverseSeed`（rollback ヘルパー・export してテスト）。sheet-core / sheet-types / `./deps` のみ参照。
- **`inprocess-transport.ts`**: `InProcessHub`（Room を束ね複数セッションを結線）＋`InProcessTransport`
  （`ClientTransport` 実装）＋シード付き PRNG フォールト注入＋発火カウンター。Room を import（試験ハーネス）。

## 1. committed / pending 二層＋楽観ビュー

`ClientSession` の状態（すべて注入依存・DOM/Node 非参照）:

| 状態 | 型 | 意味 |
|------|-----|------|
| `committed` | `SheetDocument` | **サーバー確定状態（権威）**。server op を revision 順に適用して前進。**rollback から導出しない**（DA D22）。 |
| `pending` | `PendingEntry[]` | 未 ACK/未 reject のローカル楽観 Operation（envelope＋inverseSeed＋acknowledged/localNoop）。clientSequence 昇順。 |
| `view` | `SheetDocument` | 楽観ビュー ＝ committed に pending を順に適用。UI 表示相当（PoC はヘッドレス）。 |
| `nextExpectedRevision` | `number` | 次に適用すべき server revision（`= committed.revision + 1`）。欠落検知に使う。 |
| `revisionBuffer` | `Map<number, ServerOperationEnvelope>` | 期待より先の revision を保持（S-I4 バッファ方式）。 |
| `conflictQueue` | `ConflictQueueEntry[]` | reject/再検証失敗/依存失効したローカル入力を**コピー可能な形**で保持（I-2・消失0）。 |
| `knownPresence` | `Map<connectionId, UserPresence>` | 他接続の Presence（Phase 4 デモの名前/色表示用）。 |

```ts
interface PendingEntry {
  envelope: ClientOperationEnvelope;   // operationId/clientSequence/baseRevision 不変（再送キー）
  inverseSeed: InverseSeed;            // 楽観適用時の逆操作データ（rebuildView で毎回再計算）
  acknowledged: boolean;               // operationAck 受信済み（再送対象から外す）
  localNoop: boolean;                  // 楽観適用が空 changeSet（server も noop＝operations エコー無し→ACK で除去）
}
```

**不変条件**: `view == fold(committed, pending)`。`I-4`: hash 一致主張は **committed 静止点**（pending 空・全 ACK 済み）でのみ。

## 2. §7.7 rollback/replay の 6 手順（server op 到着時のデータフロー）

`reconcileServerOperation(serverEnv)`（**in-order** で呼ぶ＝`serverEnv.revision === nextExpectedRevision`）:

1. **rollback（InverseSeed 逆順）**: 概念的に楽観ビューを committed 基準へ戻す。本設計は **committed を権威として別管理**
   するため基準は既知。`applyInverseSeed` による view→baseline の逆順 rollback は**行構造・空セル前値では厳密**で、
   検証用に `rollbackBaselineHash()`（view から inverseSeed を逆順適用）を公開しテストで `== committedHash` を確認する
   （DA D22: InverseSeed は before-revision を持たないため**既存セル上書きの rollback は revision 非厳密**。ゆえに committed は
   rollback から導出せず権威管理する＝収束担保）。
2. **server op 適用**: `committed = applyOperation(committed, serverEnv.operation, { revision: serverEnv.revision }).document`。
   `nextExpectedRevision = serverEnv.revision + 1`。server op は Room が検証済みゆえ throw しない。
3. **own 除去（冪等）**: `serverEnv.operationId` が pending にあれば除去（S-H2/H4。ACK 先着・echo 先着の両順序で冪等）。
4. **残 pending 再検証**: `rebuildView()` が committed に対し pending を順に `validateOperation`（**sheet-core 共有・指示 1**）。
5. **再適用**: 違反 0 の pending を `applyOperation` で view へ再適用（inverseSeed を再取得）。
6. **不成立は Conflict Queue**: `validateOperation` 違反（stale/target-deleted/…）→ `revalidation-failed` で Conflict Queue。
   さらに**依存失効**（先行 pending が失効した行に触れる後続 pending）→ `dependency` で Conflict Queue（S-H3 連鎖）。

```ts
rebuildView():
  doc = committed; provisional = committed.revision; survived = []; invalidatedRows = Set()
  for entry in pending:                                  // clientSequence 昇順
    touched = touchedRows(entry.op)
    dependsOnInvalidated = touched ∩ invalidatedRows ≠ ∅
    violations = dependsOnInvalidated ? [] : validateOperation(doc, entry.op)
    if !dependsOnInvalidated and violations == []:
      res = applyOperation(doc, entry.op, { revision: ++provisional })
      doc = res.document; survived.push({ ...entry, inverseSeed: res.inverseSeed })
    else:
      invalidatedRows.add(...touched)
      conflictQueue.push(conflictEntry(entry, dependsOnInvalidated ? 'dependency' : 'revalidation-failed', violations))
  pending = survived; view = doc
```

- **同期処理単位＝1 ServerMessage**（DA: 割り込み不変条件）: `handleServerMessage` は同期完結し再入しない
  （JS 単一スレッド・reconcile/rebuildView 中に別受信が挟まらない）。`touchedRows`: SetCells=changes.rowId、
  InsertRows=挿入 rowId、DeleteRows=rowIds。

## 3. Conflict Queue エントリー（コピー可能・§10.1・I-2）

```ts
type ConflictReason = 'rejected' | 'revalidation-failed' | 'dependency';
interface ConflictQueueEntry {
  operationId: OperationId;
  operation: DocumentOperation;      // 元のローカル Operation（深いコピー＝「自分の値」を保全）
  clientSequence: number;
  baseRevision: number;
  reason: ConflictReason;
  code?: RejectCode;                 // reason==='rejected'（server 判定）
  violations?: OperationViolation[]; // reason==='revalidation-failed'（client 判定）or server details.violations
  details?: RejectDetails;           // server reject の現在値/現在revision（stale の解決 UI 材料・PoC-A/Phase 4）
}
```

- **PoC は保持のみ・自動再送しない**（Q-3）。`operation` を深いコピーで持ち、UI 化（自分の値で再送/現在値採用/コピー）は後続。
- Conflict Queue 入り＝**pending から除去**＝**再送対象外**（reject された op が再送タイマーで蘇らない・DA 重点）。

## 4. トランスポート IF（送受信・接続イベント・注入）

```ts
interface TransportListener {                       // ClientSession が実装
  handleServerMessage(message: ServerMessage): void;
  handleConnected(): void;                          // 初回接続・再接続で発火 → join 送信
  handleDisconnected(): void;                        // 切断 → offline へ
}
interface ClientTransport {
  setListener(listener: TransportListener): void;
  connect(): void;                                  // 接続確立 → listener.handleConnected()
  send(message: ClientMessage): void;               // 送信（フォールトで drop/duplicate/delay され得る）
}
```

- `ClientSession` は構築時に `transport.setListener(this)`。`start()`＝`transport.connect()`。
- **注入クロック**（`Clock`）: 再送タイマー・heartbeat の `sentAt`・offline 上限判定・`acceptedAt` 相当。`Date.now()` 非参照。
- **注入 IdGenerator**（`IdGenerator`）: `operationId`/`transactionId` 採番（本番=`crypto.randomUUID`、テスト=決定的連番）。

## 5. 受信メッセージ処理（§8.4 catch-up・S-I）

`handleServerMessage`:

- **welcome**: `connectionId = sessionId`・`colorKey`（**welcome 拡張・§8 参照**）・`awaitingSync` の目標 `reconnectTarget = currentRevision` を記録。`maybeFinalizeSync()`。
- **operations**: 各 envelope を **revision 順ソートせず** `ingest`:
  - `revision < nextExpectedRevision` → **重複無視**（I-3・S-I3）。
  - `revision >= nextExpectedRevision` → `revisionBuffer` へ。
  - 後段 `drainBuffer()`: `revisionBuffer` に `nextExpectedRevision` があれば取り出し `reconcileServerOperation`（`nextExpectedRevision++`）を連続適用。
    - 途切れたら（バッファ非空で欠落）→ `awaitingCatchup=true`・`requestCatchup{afterRevision: nextExpectedRevision - 1}` 送信（S-I1・off-by-one）。
    - バッファ空になれば `awaitingCatchup=false`。**catch-up 応答待ち中の新着はバッファに積むだけ**で順序を飛ばさない（S-I4）。
    - `maybeFinalizeSync()`。
- **operationAck**: pending の該当 `operationId` を `acknowledged=true`（再送抑止）。`localNoop` の op は **echo が来ない**ため ACK で pending 除去→`rebuildView()`（noop は view 不変）。既に除去済み（echo 先着 or duplicate ACK）は no-op（S-H4）。
- **operationRejected**:
  - `code==='client-sequence-violation'` → **pending を除去せず** `resendAllPending()`（先頭から同一 operationId・同一 clientSequence 再送＝欠落回復・指示 2）。
  - それ以外 → 該当 op を pending から除去し Conflict Queue（`reason:'rejected'`・`code`・`details`）→ `rebuildView()`（**再送しない**・指示 2）。
- **presenceSnapshot/presenceDelta/presenceRemoved**: `knownPresence` を更新（自 connectionId は除外可）。Phase 4 デモの他タブ表示経路。
- **heartbeatAck**: 記録のみ（PoC）。

## 6. 再送ポリシー（Q-2 裁定の実装・指示 2）

- **対象**: un-ACK かつ Conflict Queue 未送りの pending（`!acknowledged`）。**先頭から同一 operationId・同一 clientSequence** で再送。
- **契機**（3 種）: (a) `tick()` で **注入クロックの resend タイマー満了**（`now - lastSendAt >= resendTimeoutMillis`）、
  (b) **再接続時**（サーバー差分適用後・§8.5）、(c) **`client-sequence-violation` 受信時**。
- **二重適用しない根拠**: サーバーは `operationId` 冪等（ACK 済みは同一 ACK 再返却＝S-F2）・決定論 reject（未適用）。
  ゆえに再送してもサーバー側で二重適用は起きない。
- **無限再送しない根拠**: reject された op は pending から除去（Conflict Queue 行き）＝再送集合から外れる。ACK 済みは
  `acknowledged` で外れる。よって pending は単調に空へ向かう。

## 7. 再接続手順（§8.5・先にサーバー差分→後に未送信再検証・S-J）

1. `handleDisconnected()`: `online=false`・`offlineSince=clock.now()`。pending/committed/nextExpectedRevision を保持（S-J1）。
   ローカル未確定値（Conflict Queue・pending の operation）はコピー可能な形で保持済み。
2. `handleConnected()`: `online=true`・**同一 clientId** で `join{lastAppliedRevision: committed.revision}`（S-J4：clientId 不変・
   connectionId は新規）。`awaitingSync=true`。
3. **先にサーバー差分**: welcome＋operations で committed を最新化（reconcile が pending を**再検証**＝競合は Conflict Queue へ・S-J3）。
4. **後に未送信再検証・再送**: `maybeFinalizeSync()`（committed が `reconnectTarget` まで前進＋バッファ空）で `resendAllPending()`
   （生存 pending を先頭から再送）。直近 Presence があれば新 connectionId で再送（デモ再表示）。
5. **上限超過**（S-J5・Q-4）: `tick()` で `offline` 中に `now - offlineSince > maxOfflineMillis`（暫定 30 秒）または
   `pendingCount > maxOfflinePending`（暫定 100）→ `stopped=true`（編集停止・読み取り状態）。`submitLocalOperation` は throw。

## 8. Presence 送信＋識別情報の伝搬経路（指示 3 の確定）

**確定した経路（phase2-design §2/§4・protocol.ts・room.ts で既に定義済みを確認）**:

- クライアントは `presence{sequence, payload}` を送る。`payload: PresencePayload = { userId, displayName, activeCell?, selectionRanges, editingCell? }`。
  **userId/displayName はクライアントの `presence` payload が運ぶ**（`SessionConfig` の userId/displayName を session が充填）。
- サーバー（Room.handlePresence→PresenceRegistry.update）が **connectionId/colorKey を付与**し `UserPresence` を確定、
  `presenceDelta`（他接続へ）/`presenceSnapshot`（新接続へ）で中継する（既実装・変更不要）。
- 各クライアントは受信 `presenceDelta`/`presenceSnapshot` の `UserPresence`（名前＋色）で**他タブを表示**（Phase 4 デモ経路・成立）。

**自分の colorKey の知り方（1 方式に確定）＝ welcome 拡張**:

- `WelcomeMessage` に `colorKey: string` を追加し、join 応答で**自接続の colorKey を返す**（connectionId と対称）。
- 最小変更: `sheet-core/protocol.ts` の `WelcomeMessage` に `colorKey` 追加、`sheet-server-core/room.ts` の `handleJoin` が
  `presence.register(connectionId)` の戻り（colorKey）を welcome に載せる（既存 server-core テストは welcome の個別
  フィールド検査ゆえ**維持**）。他方式（自 presence echo／snapshot に自分含む）は presence 送信前に色が判らない/
  配信対象の非対称化が要るため不採用。
- `sendPresence({ activeCell?, selectionRanges, editingCell? })`: session が userId/displayName を充填し `++presenceSequence`
  （**connection 単位・単調**）で送信。直近 payload を保持し再接続時に再送（新 connectionId で再登録）。

## 9. `inprocess-transport.ts`（Room 直結・シード付きフォールト注入・カウンター・指示 5）

- **`InProcessHub`**: 1 Room＋複数 `InProcessTransport` を束ねる。クライアント→サーバーは Room を同期呼び出し、
  サーバー→クライアントの `Outbound[]` を**遅延キュー**へ積む。`deliverAll()`/`deliverNext()` で決定論的に配送。
  - `target` 展開: `connection`→当該 connectionId、`others`→送信元以外の活性接続、`all`→全活性接続（`room.activeConnectionIds()`）。
  - connectionId↔clientId は welcome（`handleJoin` の戻り）で学習し配送に使う。
- **フォールト注入（シード付き mulberry32・実タイマー不使用）**:
  - `duplicate`: 配送を 2 回積む（サーバー→クライアント operations 重複＝S-I3／submitOperation 重複＝S-F2）。
  - `drop`: 配送を捨てる（operations 欠落→catch-up＝S-I1／submitOperation 欠落→再送＝Q-2）。
  - `delay`: `deliverNext` が先頭でなく決定論的に後方インデックスを選ぶ＝**イベントキュー順序操作**でリオーダー（S-I4）。
  - `disconnect`: 対象接続を落とし `handleDisconnected` 通知（`reconnect(clientId)` で `handleConnected`＝再 join）。
- **発火カウンター**（`counters: { duplicate, drop, delay, disconnect }`）: Phase 5 の S-M3（メタ検証＝フォールトが実際に
  発火した）に使う。各注入で加算。

## 10. 公開 API（テストが叩く面）

```ts
class ClientSession implements TransportListener {
  constructor(config: SessionConfig);
  start(): void;                                          // transport.connect()
  submitLocalOperation(operation: DocumentOperation): OperationId;  // 楽観適用＋送信（stopped 時 throw）
  sendPresence(p: { activeCell?; selectionRanges; editingCell? }): void;
  sendHeartbeat(): void;
  tick(): void;                                           // 再送タイマー＋offline 上限（注入クロック駆動）
  // TransportListener: handleServerMessage / handleConnected / handleDisconnected
  // 検査用: committedDocument / viewDocument / committedHash() / viewHash() / nextExpectedRevision /
  //         pendingCount / pendingOperationIds() / conflictQueue / connectionId / colorKey / isStopped /
  //         isOnline / knownPresences() / rollbackBaselineHash()
}
```

## 11. 相互整合（scenarios / protocol-subset との対応）

| 本設計の要素 | scenarios | protocol-subset |
|-------------|-----------|-----------------|
| committed/pending 二層・楽観ビュー | H1〜H5・I-4 | §7 |
| 6 手順 rollback/replay・own 冪等除去 | S-H1/H2/H4 | §5-5 |
| 依存 pending 連鎖・Conflict Queue（消失0） | S-H3・G2/G3 | §3・§4 |
| 楽観ビューで hash 非主張 | S-H5・I-4 | — |
| 欠落→requestCatchup・重複無視・バッファ・off-by-one | S-I1〜I5 | §7 catch-up |
| 切断保持・再接続順序・再検証・clientId 継続・上限 | S-J1〜J5 | §7 再接続 |
| 再送ポリシー（タイマー/violation/再接続・reject 非再送） | — | §5 注記・Q-2 |
| Presence 送信・識別伝搬・welcome.colorKey | S-L1/L2 | §1/§6 |
| validateOperation 共有（サーバー=クライアント一致） | S-H3・S-G | §3 |
| フォールト注入カウンター | S-M3（Phase 5） | — |

## 12. DA 引き継ぎ（Phase 3 で検証／記録する観点）

- own 受信と pending 除去の競合窓（ACK 先着/echo 先着）＝`acknowledged`＋`localNoop`＋冪等除去で両順序吸収。
- catch-up 応答待ち中の新着＝`revisionBuffer` に積む（破棄しない）。
- rollback→replay 中に受信が割り込まない＝1 ServerMessage 同期完結（再入なし）。
- 再送と Conflict Queue の排他＝reject 済みは pending 除去で再送集合外（タイマーで蘇らない）。
- 逆操作復元の完全性＝`rollbackBaselineHash()==committedHash`（行/空セルは厳密・既存セル上書きは非厳密＝D22 で committed 権威管理）。
- 発見は DA 表へ **D22 から連番**追記。
