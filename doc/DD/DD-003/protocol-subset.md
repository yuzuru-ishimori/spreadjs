# DD-003 プロトコルサブセット（PoC-C 採用分）

> 計画書 §8.3（メッセージ）・§7.3（Envelope）・§9（Presence）・§10.2/10.3（競合）の**PoC-C 採用分**を確定する。
> `scenarios.md`・`phase1-design.md` と型・用語・境界仕様を一致させる。**コード化はユーザーレビュー・合意後**。
> 本ファイルは DD 本体（決定事項 §メッセージ・§Presence・§Operation境界）の 50 行超の詳細分離先（guides.md §6）。

## 1. 採用メッセージ（§8.3 のサブセット）

### Client → Server

| type | フィールド | 用途 |
|------|-----------|------|
| `join` | `protocolVersion, documentId, lastAppliedRevision, clientId` | 初期接続/再接続。`lastAppliedRevision=R` 以降を要求 |
| `submitOperation` | `envelope: ClientOperationEnvelope` | Operation 送信 |
| `presence` | `sequence, payload: PresencePayload` | Presence 更新（connection 単位・単調 sequence） |
| `heartbeat` | `sentAt` | 生存通知（目安5秒） |
| `requestCatchup` | `afterRevision` | 欠落検知時の差分要求 |

### Server → Client

| type | フィールド | 用途 |
|------|-----------|------|
| `welcome` | `sessionId(=connectionId), currentRevision, capabilities` | join 応答。`sessionId` が **Presence 管理単位**の connectionId |
| `operations` | `fromRevision, toRevision, operations: ServerOperationEnvelope[]` | Operation 配信（自分の分もエコー） |
| `operationAck` | `operationId, revision` | 受理確認（冪等再送時は同一 ACK） |
| `operationRejected` | `operationId, code, details?` | 拒否（§3 reject コード） |
| `presenceSnapshot` | `users: UserPresence[]` | 接続直後の全 Presence |
| `presenceDelta` | `presence: UserPresence` | 単一 Presence 更新 |
| `presenceRemoved` | `sessionId(=connectionId)` | Presence 削除（TTL/close） |
| `heartbeatAck` | `serverTime` | heartbeat 応答 |

**PoC 非採用（予約）**: `resyncRequired`（in-memory で全ログ保持＝差分が保持期間外にならないため PoC では発火しない。将来のログ退避時に採用）。protocolVersion 不一致切断も PoC 契約テスト対象外（§20.3 のうち重複・欠落・stale のみ）。

## 2. Envelope 必須フィールド（§7.3）

```
ClientOperationEnvelope = {
  protocolVersion: number
  documentId: DocumentId
  operationId: OperationId          // 冪等キー（文書単位で一意）
  transactionId: TransactionId      // 1利用者操作 = 1 transaction
  actorId: string                   // userId
  clientId: string                  // = clientSessionId。再接続で不変
  clientSequence: number            // clientId 単位で単調増加
  baseRevision: number              // 構築時の既知 revision（≤ currentRevision）
  operation: DocumentOperation      // SetCells | InsertRows | DeleteRows
}
ServerOperationEnvelope = ClientOperationEnvelope & {
  revision: number                  // サーバー付与（単調増加）
  acceptedAt: string                // ISO 文字列（ログ/監査用。適用関数には渡さない）
  canonicalOperation: DocumentOperation  // 正準化後（PoC では operation と同一）
  conflict?: ConflictMetadata
}
```

### 識別子モデル（重要 — DA D8）

- **`operationId`**: 文書単位で一意（§8.4）。**冪等（二重適用防止）の最終キー**。clientId が何であれ、同一 operationId は同一 ACK を返す（S-F2）。再接続後の再送も operationId で救済される。
- **`clientId`（= clientSessionId）**: クライアントが決めるセッション識別子。**`clientSequence` の単調検査キー**（clientId 単位の順序列。§7.3 の「接続＝セッション識別子」）。Room は per-clientId のシーケンス表を保持する。PoC では**再接続時に同一 clientId を再利用**して clientSequence を継続する（新規採番も可＝その場合は新列。二重適用は operationId で防がれる）。
- **`connectionId`（= welcome.sessionId）**: サーバーが物理WS接続ごとに割り当てる。**Presence の管理単位**。再接続で新しくなる（旧 connectionId の Presence は TTL/close で除去）。
- `clientId`（clientSequence 用・client 提供）と `connectionId`（Presence 用・server 割当）は**プロトコル上別フィールド**。混同すると Presence TTL 削除か clientSequence 検査のどちらかが壊れる。

## 3. reject コード一覧

| code | 契機 | details | scenarios |
|------|------|---------|-----------|
| `stale-cell-revision` | SetCells の change の `beforeRevision` が Room の現在 cell revision と不一致（§10.2） | 競合セルごとの現在値・現在 revision・競合相手 | S-C2, S-G1, S-G4 |
| `target-row-deleted` | SetCells が tombstone 行を対象（§10.3「DeleteRow 先なら SetCell 拒否」） | 対象 rowId 一覧 | S-C3, S-G3 |
| `unknown-anchor` | InsertRows の `afterRowId` が一度も存在しないID | 該当 afterRowId | S-D3 |
| `duplicate-row` | InsertRows の `rows[].rowId` が既存行と重複、または Operation 内で重複（信頼できないクライアント入力を受ける Room 境界での担保・DA D11） | 該当 rowId 一覧 | S-D6 |
| `unknown-row` | SetCells が未知 rowId を対象 | 該当 rowId | S-A6 |
| `invalid-base-revision` | `baseRevision > currentRevision` | currentRevision | S-F6 |
| `client-sequence-violation` | clientId 単位で clientSequence が単調でない（欠番/戻り。既知 operationId 重複は除く） | 期待 sequence・受信 sequence | S-F3 |
| 予約 | `protocol-version-mismatch` / `payload-too-large` / `unauthorized` | — | PoC 対象外（後続） |

**SetCells 原子性**: 1つの SetCells 内に stale/削除行/未知行が**1件でもあれば全体 reject**（部分適用しない）。details には**全ての違反 change**を列挙する（利用者が一括で状況把握できるように）。

## 4. Operation 境界仕様（決定事項の具体化）

1. **SetCells 全件適用/全件拒否**: changes を**まず全件検証**（beforeRevision 照合・行存在/tombstone 確認）し、全件 OK のときだけ**単一 revision で原子適用**。1件でも NG なら reject（§3・上記）。適用関数（sheet-core）は validate-all → commit の二相で**部分ミューテーションを残さない**（S-C5）。
2. **tombstone 化された既知アンカーへの InsertRows**: `afterRowId` が DeleteRows 済みでも、**論理表示順（tombstone を含む `rowOrder`）上の参照点として有効**。その直後に挿入する（S-D2）。アンカーが一度も存在しないIDなら `unknown-anchor`（S-D3）。
   - **重複 rowId は拒否**（Phase 2 追加・D11 の呼び出し側契約の Room 境界担保）: `rows[].rowId` が既存行と重複、または Operation 内で重複する場合は `duplicate-row` で reject（S-D6）。apply 層は採番一意性を呼び出し側契約とするが、信頼できないクライアント入力を受ける Room は `validateOperation`（sheet-core 共有）でサーバー側担保する。
3. **削除済み行への再 Delete は冪等無視**: `DeleteRows.rowIds` に tombstone 済みIDが含まれる場合、その ID は no-op、残りは適用（S-E2）。**全件が削除済みなら changeSet 空で成功**（reject/例外にしない・S-E3）。no-op のみの Operation は **revision を消費せず**、直近 revision を載せた ACK を返す（Q-1 仮決め）。
4. **`clientSequence` は `clientSessionId`（= clientId）単位**で単調増加・検査（S-F4/F5）。同一 userId の複数接続は独立列。

## 5. サーバー処理順（DA D3 — 順序が正しさを決める）

`submitOperation` 受信時、次の順で処理する:

1. **operationId 冪等チェック**: 既知 operationId なら**適用せず**キャッシュ済み ACK を再返却（S-F2）。以降のチェックは行わない。
2. **clientSequence 検査**（clientId 単位・単調）: 違反なら `client-sequence-violation`（S-F3）。
3. **baseRevision 検査**: `baseRevision > currentRevision` なら `invalid-base-revision`（S-F6）。
4. **Operation 検証＋適用**（sheet-core の `validateOperation` と `applyOperation` を共有）: 行存在/tombstone/beforeRevision/重複行を**全件検証**（`validateOperation`＝サーバー/クライアント判定一致・SetCells 原子性）。NG なら reject（details に全違反を列挙）。OK なら `applyOperation` で revision 付与・ログ追記・文書更新。no-op（空 changeSet）のみは revision 非消費（§4-3）。
5. **配信**: `operationAck{operationId, revision}` を送信元へ、`operations{fromRevision, toRevision, [envelope]}` を全接続へ（送信元にもエコー）。ACK と operations の順不同を許容し、クライアントは operationId で own を冪等識別する（S-H4）。

> 1 を 2 より先にする理由: 重複再送は clientSequence が「前回と同値（単調増加でない）」になるため、順序を誤ると正当な重複が `client-sequence-violation` で誤 reject され AC2 が壊れる。

## 6. Presence フィールド・配信・TTL（§9・connection 単位）

```
UserPresence = {
  connectionId: string          // = welcome.sessionId。管理単位
  userId: string
  displayName: string
  colorKey: string              // サーバーが接続単位で割当（§9.4 同色回避）
  activeCell?: CellAddressById       // {rowId, columnId}
  selectionRanges: SelectionById[]   // 矩形範囲（RowId/ColumnId 参照）
  editingCell?: CellAddressById
  sequence: number              // connection 単位で単調増加
}
```

- **共有 3 種**（§9.2）: `activeCell` / `selectionRanges` / `editingCell`。＋識別用 `connectionId`/`userId`/`displayName`/`colorKey`。
- **共有しない**: IME 変換中文字列・変換候補・キャレット位置・未確定ドラフト・スクロール位置（§9.2）。
- **sequence 比較**: 受信 sequence ≤ 保持 sequence の更新は**破棄**（古い更新・S-L3）。
- **colorKey 割当**: 接続時にサーバーが未使用色から割り当て、同色衝突を避ける（§9.4）。close で解放。
- **単一シート PoC**: `activeSheetId`（§9.1）は省略。

### heartbeat / TTL

- heartbeat 間隔 = **5秒目安**、Presence TTL = **15秒目安**（§9.3 初期値）。
- **TTL 判定は注入クロック**（`now()` を注入し、テストで任意に進められる）。正常 close は**即時** `presenceRemoved`、異常切断は TTL 超過で `presenceRemoved`（S-L5/L6）。
- **TTL スイープは決定論的に発火可能にする**（DA D6）: 実運用は `setInterval` でも、テストは「注入クロックを進める + 明示 `sweep()` 呼び出し」で TTL 失効を再現できる構造にする（実時間待ちに依存しない）。

## 7. 初期接続・catch-up・再接続手順

### 初期接続（§8.2）

1. HTTP `GET /snapshot?documentId=…` → snapshot（`revision R` 含む）を取得。
2. WS 接続 → `join{lastAppliedRevision:R, clientId, protocolVersion, documentId}`。
3. サーバー `welcome{sessionId(=connectionId), currentRevision}` ＋ `R+1..currentRevision` を `operations` で配信。
4. クライアントは snapshot を committed の起点にし、`R+1` 以降を順に適用。`nextExpectedRevision = R+1`。

### catch-up（§8.4・off-by-one 明記 — DA D9）

- クライアントは `nextExpectedRevision` を保持。受信 revision > 期待 → 適用停止し `requestCatchup{afterRevision: nextExpectedRevision-1}`。
- サーバー応答 = `operations{fromRevision: afterRevision+1, toRevision: currentRevision}`（**afterRevision 自身は再送しない**・S-I5）。
- 受信 revision < 期待 → **重複として無視**（§8.4・S-I3）。
- catch-up 応答待ち中に届く先の revision は**バッファ or 破棄して再取得**。revision 順を飛ばして適用しない（S-I4）。

### 再接続（§8.5 — 先にサーバー差分、後に未送信再検証）

1. 切断中: 確定/未送信ローカル Operation を上限付きキューに保持（暫定 30秒/100 Operation・Q-4）。ローカル未確定値も保持。
2. 再接続: **同一 clientId** で `join`。**先にサーバー差分を取得**（`R'+1..current` を適用し committed を最新化）。
3. **その後**、pending（未送信/未 ACK）を§7.7 の rollback/replay で**再検証**: 非競合なら再送、競合（stale/削除行）なら Conflict Queue（S-J2/J3）。
4. clientSequence は clientId 単位で継続（Room の per-client 表が保持）。Presence は新 connectionId で再登録、旧 connectionId は TTL/close で除去（S-J4）。
5. 上限超過は編集停止・読み取り状態へ（S-J5）。
