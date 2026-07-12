# DD-003 共同編集Operation収束 テストシナリオ（自然言語）

> 目的: 計画書 §7.6/7.7・§8.4/8.5・§9・§10.2/10.3・§18.3 合格条件の「操作 → 期待結果」を、
> Phase 1〜5 で TDD コード化する前に洗い出し、**ユーザー合意**を得る（guides.md §8）。
> ここで合意したシナリオを各 Phase のテスト（`packages/sheet-core/src/*.test.ts`・
> `packages/sheet-server-core/src/*.test.ts`・`apps/collaboration-server/src/client-session/*.test.ts`・
> `apps/collaboration-server/test/*.test.ts`）へ写像する。**コード化はユーザーレビュー・合意後**（本 Phase 0 では作らない）。
> 型・用語・境界仕様は `protocol-subset.md` と `phase1-design.md` に一致させる。

## 0. 前提モデル（シナリオの語彙）

**アクター**

| アクター | 意味 |
|---------|------|
| Room | サーバー権威。単調増加 `revision`・Operationログ・冪等/シーケンス表・Presenceレジストリを持つ。トランスポート非依存（メッセージ in/out）。 |
| Client | ヘッドレスクライアントセッション。`committed`（サーバー確定）と `pending`（未ACKのローカル楽観適用）の二層＋Conflict Queue＋`nextExpectedRevision` を持つ。 |
| Transport | Client↔Room の注入トランスポート。シード付きPRNGで重複・欠落(drop)・遅延(reorder)・切断/再接続を再現可能に注入する。 |

**識別子**（`protocol-subset.md` §Envelope と一致）

- `clientId`（= `clientSessionId`）: クライアントのセッション識別子。**再接続をまたいで安定**。`clientSequence` と冪等・pending 再送のキー。
- `connectionId`: 物理WS接続ごとにサーバーが割り当てる識別子（`welcome.sessionId`）。**Presence の管理単位**。再接続で変わる。

**文書モデル**（`phase1-design.md` と一致）

- 単一シート。行 = `rowOrder`（tombstone 含む全 `RowId` の並び）＋各行の `RowMeta{id, slot, tombstone, lastChangedRevision}`。
- 表示順 = `rowOrder` から tombstone を除いたもの。**アンカー解決は tombstone を含む `rowOrder` 上の位置**で行う。
- 列 = 固定 `ColumnId` 列（`columnOrder`）。セル = `(RowId, ColumnId) → CellRecord{value, lastChangedRevision}`。

**Operation（3種）**

- `SetCells{ changes:[{rowId, columnId, beforeRevision?, value}], conflictPolicy:'reject-overlap' }`
- `InsertRows{ afterRowId: RowId|null, rows:[{rowId, height?}] }`（`null` は先頭挿入）
- `DeleteRows{ rowIds: RowId[] }`

**文書ハッシュ**: 正準直列化（表示順 `rowOrder` × `columnOrder` の順に非空セルを `rowId,columnId,kind,value,lastChangedRevision` で列挙。tombstone 行は除外。**Map/Set 反復順・`localeCompare` に依存しない**）＋純TS FNV-1a 64bit。**committed 状態に対して計算**し、比較は静止点（全 Operation が ACK 済み・pending 空）で行う。

**不変条件（全シナリオで常に満たす）**

- I-1: 適用関数は時刻・乱数・DOM・ネットワークを参照しない。同一 (文書, Operation, 付与revision) → 同一 ApplyResult（§7.6）。
- I-2: **入力を黙って消さない**（§10.1-1）。reject されたローカル入力は Conflict Queue にコピー可能な形で保持する。
- I-3: **二重適用0**。同一 `operationId` を Room が二度適用しない・Client が同一 revision を二度適用しない。
- I-4: hash 一致は「committed 状態・静止点」でのみ主張する（pending 中の楽観適用ビューでは主張しない）。
- I-5: SetCells は**全件適用または全件拒否**（部分適用・部分ミューテーションを残さない）。

---

## A. 決定論的適用（sheet-core `apply`）— AC1/AC2 基盤・Phase 1

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-A1 | 空文書・revision=0 | `SetCells[{row-1,col-a,"x"}]` を revision=1 で適用 | ApplyResult を返す。changeSet=`[{row-1,col-a, before:blank, after:"x"}]`・`(row-1,col-a).lastChangedRevision=1`。dirtyRegions に row-1・formulaInvalidations=[]（PoC）。 |
| S-A2 | S-A1 の結果文書 | 同一 `SetCells` を同一 revision=1 で再適用 | I-1: まったく同じ ApplyResult・同じ文書。適用は純粋（入力を破壊しない＝新状態を返す/バッファ適用）。 |
| S-A3 | 任意文書 | 同じ Operation 列を2つの独立プロセスで同順・同 revision 付与で適用 | 2つの結果文書の hash が一致（決定論）。 |
| S-A4 | row-1 が存在 | `InsertRows{afterRowId:row-1, rows:[{row-2}]}` を revision=2 | row-2 が row-1 直後に入る。`rowOrder=[row-1,row-2]`・row-2.lastChangedRevision=2。changeSet に構造変更 rowsInserted=[row-2]。 |
| S-A5 | row-1, row-2 存在 | `DeleteRows{[row-1]}` を revision=3 | row-1 が tombstone 化（`rowOrder` から消さない・表示順から除外）。changeSet に rowsDeleted=[row-1]。row-1 のセルは論理的に不可視。 |
| S-A6 | 空文書 | `SetCells` の changes に**未知の rowId**（一度も存在しない） | 明示エラー（`ApplyError` code=`unknown-row`）。文書は不変（I-5）。 |
| S-A7 | row-1 が tombstone 済み | `SetCells[{row-1,col-a,"y"}]`（削除済み行への SetCells＝§10.3） | 明示エラー（code=`target-row-deleted`）。文書は不変。 |
| S-A8 | 任意文書 | `InsertRows{afterRowId:未知ID}` | 明示エラー（code=`unknown-anchor`）。 |
| S-A9 | row-1（value "a"）存在 | `SetCells[{row-1,col-a,"a"}]`（同値上書き）を revision=5 | 値は同じでも `lastChangedRevision=5` に更新。changeSet は before="a"/after="a"（no-op 判定はサーバー/クライアント方針に委譲。適用関数は revision を素直に反映）。 |

## B. 文書ハッシュ決定論 — AC1・Phase 1

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-B1 | 2文書。片方は col-a→col-b の順、他方は col-b→col-a の順で同じ2セルを設定（内部 Map 挿入順が異なる） | 両者の hash を計算 | hash 一致（正準直列化が `columnOrder` 順で列挙し Map 反復順に依存しないため）。 |
| S-B2 | 2文書。片方は Operation 列を replay、他方は snapshot import で同一論理状態を構築 | 両者の hash を計算 | hash 一致（構築経路によらず committed 状態が同一なら hash 同一）。 |
| S-B3 | tombstone 行を含む文書 | hash 計算 | tombstone 行は直列化に**含めない**。tombstone の有無だけが違う2文書で、生存セルが同一なら hash 一致。 |
| S-B4 | 文字列 "A" と "a"、記号を含む rowId/columnId | hash 計算 | `localeCompare` 等の環境依存整列を使わず、`rowOrder`/`columnOrder` 配列順で列挙するため、ロケール/OS によらず同一 hash。 |
| S-B5 | 同一論理値だが lastChangedRevision が異なる2文書 | hash 計算 | hash **不一致**（lastChangedRevision を直列化に含めるため。収束の判定材料）。 |

## C. Operation境界: SetCells 原子性（全件適用/全件拒否）— 決定事項・Phase 2

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-C1 | Room: (row-1,col-a) rev=10 / (row-2,col-b) rev=10 | `SetCells[{row-1,col-a,beforeRevision:10,"x"}, {row-2,col-b,beforeRevision:10,"y"}]` | 両件受理。1つの revision（例 11）で両セル更新。ACK 1件。 |
| S-C2 | 同上・ただし (row-2,col-b) は他者が rev=12 に更新済み | `SetCells[{row-1,col-a,beforeRevision:10,"x"}, {row-2,col-b,beforeRevision:10,"y"}]`（2件目が stale） | **全体 reject**（`operationRejected` code=`stale-cell-revision`）。**row-1 も適用されない**（I-5）。details に競合セル (row-2,col-b) の現在値・現在revision（§10.2）。文書 hash は操作前と不変。 |
| S-C3 | 1件が正常・1件が tombstone 行対象 | `SetCells[{row-1(生存),...}, {row-9(削除済み),...}]` | 全体 reject（code=`target-row-deleted`・§10.3）。row-1 も未適用。 |
| S-C4 | 3件すべて正常 | 3件 SetCells | 全件を単一 revision・単一 changeSet・単一 ACK で原子適用。 |
| S-C5 | 楽観適用中のクライアントで、apply 途中（2件目）でエラー | ローカル `apply` が2件目でエラー | 1件目のミューテーションも残さない（validate-all→commit の二相。文書はバイト同一に戻る）。 |

## D. Operation境界: InsertRows アンカー（tombstone/未知）— 決定事項・Phase 2

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-D1 | `rowOrder=[row-1,row-2,row-3]` | `InsertRows{afterRowId:row-2, rows:[row-new]}` | row-2 直後へ挿入 → `rowOrder=[row-1,row-2,row-new,row-3]`。 |
| S-D2 | row-2 が tombstone 済み・`rowOrder=[row-1,row-2(x),row-3]` | `InsertRows{afterRowId:row-2, rows:[row-new]}`（既知だが削除済みアンカー） | **アンカーは順序参照点として有効**。row-2 の論理位置直後に挿入 → `rowOrder=[row-1,row-2(x),row-new,row-3]`。表示順では row-1 の次に row-new。受理。 |
| S-D3 | 任意文書 | `InsertRows{afterRowId:"row-未知"}`（一度も存在しないID） | reject（code=`unknown-anchor`）。 |
| S-D4 | 空文書 | `InsertRows{afterRowId:null, rows:[row-a]}` | 先頭に挿入。`rowOrder=[row-a]`。 |
| S-D5 | 2クライアントが同一アンカーへほぼ同時に InsertRows | Room 受付順で連続適用（§10.3「同一anchor InsertRows」） | 両方を新 RowId で保持。サーバー受付順に並ぶ（例 anchor 直後に先着→後着）。全クライアントで同順・hash 一致。 |
| S-D6 | 任意文書（row-2 存在） | `InsertRows{rows:[row-2]}`（既存行と重複）または `InsertRows{rows:[row-x,row-x]}`（Operation 内重複） | reject（code=`duplicate-row`）。信頼できないクライアント入力を受ける Room 境界でサーバー担保（D11 の呼び出し側契約）。`validateOperation`（sheet-core 共有）で判定し、クライアント再検証とも一致。Phase 2 追加。 |

## E. Operation境界: DeleteRows 冪等（再Delete無視）— 決定事項・Phase 2

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-E1 | row-5 生存・row-6 生存 | `DeleteRows{[row-5,row-6]}` | 両行 tombstone。changeSet.rowsDeleted=[row-5,row-6]。成功。 |
| S-E2 | row-5 は既に tombstone・row-6 は生存 | `DeleteRows{[row-5,row-6]}` | row-5 は**冪等に no-op**、row-6 のみ削除。changeSet.rowsDeleted=[row-6]。成功（エラーにしない）。 |
| S-E3 | row-5,row-6 とも既に tombstone | `DeleteRows{[row-5,row-6]}` | 全件 no-op。**changeSet 空で成功**（reject でも例外でもない）。revision は付与しない/または no-op として ACK（`protocol-subset.md` §Operation境界で確定）。 |
| S-E4 | 同一行を2クライアントが同時 Delete | 先着が削除→後着が同一 `DeleteRows` | 後着は冪等 no-op。二重適用0・hash 一致。 |

## F. サーバー: revision・冪等・clientSequence — AC2・Phase 2

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-F1 | Room currentRevision=100 | 有効な `submitOperation` を受理 | revision=101 を付与し `operationAck{operationId, revision:101}`。ログに追記。 |
| S-F2 | S-F1 の operation を Client が**重複送信**（同一 operationId・同一 clientSequence） | Room が2通目を受信 | **二重適用しない**（I-3）。**同一 ACK（revision:101）を再返却**。ログ長・文書 hash は不変（AC2）。 |
| S-F3 | clientId=cA、直近 clientSequence=5 を処理済み | cA から clientSequence=7 が届く（6 が欠落） | シーケンス不整合。code=`client-sequence-violation`（または保留）。**ただし処理順は「operationId 冪等 → clientSequence 検査」**：既知 operationId の重複は F2 を優先し sequence 違反にしない。 |
| S-F4 | clientId=cA が clientSequence=5 まで、clientId=cB が clientSequence=1 まで | cB から clientSequence=2 | cA と cB は**別列**（clientId 単位）。cB の 2 は正常受理（cA の履歴と無関係）。 |
| S-F5 | 同一 userId が2接続（clientId=cA・cA2） | それぞれ独立に clientSequence を進める | 接続（clientId）ごとに独立検査。片方が遅れても他方に影響しない。 |
| S-F6 | Room currentRevision=100 | baseRevision=150（現在より未来）の operation | reject（code=`invalid-base-revision`）。baseRevision ≤ currentRevision を要求。 |

## G. 競合 reject（stale beforeRevision / 削除行 SetCells）— AC4・§10.2/10.3・Phase 2/3

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-G1 | (row-1,col-a) は Room 上 rev=20。Client は rev=15 を基準に編集 | `SetCells[{row-1,col-a,beforeRevision:15,"mine"}]` | reject（code=`stale-cell-revision`）。details=現在値・現在revision(20)・競合相手（§10.2）。 |
| S-G2 | S-G1 の Client | reject 受信後 | ローカル入力 "mine" を**Conflict Queue にコピー可能な形で保持**（消失0件・I-2/AC4）。committed は Room の現在値に収束。 |
| S-G3 | row-1 が Room 上で DeleteRows 済み | Client が `SetCells[{row-1,...}]` を送信（削除を知らずに楽観適用済み） | reject（code=`target-row-deleted`・§10.3）。ローカル入力を Conflict Queue へ。 |
| S-G4 | 2クライアントが同一セルを同一 beforeRevision で同時 Commit | 先着受理→後着 | 先着 revision 付与。後着は stale で reject（§10.3「先に確定を保持・古い beforeRevision は拒否」）。後着はローカル保持。全体は収束。 |

## H. クライアント楽観適用 rollback/replay（§7.7 の6手順）— AC4・Phase 3

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-H1 | Client: pending=[opX(SetCells row-1)] を楽観適用済み | Room から**別クライアントの** operationY（row-2 更新, revision=N）到着 | 6手順: pending 逆順 rollback → Y を committed へ適用 → opX は own でないので pending 残す → opX 再検証（row-1 は非競合）→ 再適用。view=committed(+Y)+opX。 |
| S-H2 | Client: pending=[opX] | Room から**自分の** opX が operations/ACK で確定（revision=N） | rollback → opX(committed rev=N) 適用 → **own なので pending から除去**（I-3: 二重適用しない）→ 残 pending なし。view==committed。 |
| S-H3 | Client: pending=[opX(row-1), opZ(row-1 追記)] | Room から他者 operationY が row-1 を更新（opX と競合） | rollback → Y 適用 → opX 再検証で**競合（stale）→ 不成立 → Conflict Queue** → opZ は opX に依存するため連鎖再検証（`protocol-subset.md` §再接続/再検証の依存規則）。入力消失0。 |
| S-H4 | Client: own opX の ACK と、operations 経由の own opX エコーが**両方**届く（順不同） | 両方受信 | operationId で own を識別し pending 除去は**冪等**（片方で除去、もう片方は no-op）。二重適用0（Phase 3 DA「own受信とpending除去の競合窓」）。 |
| S-H5 | Client: pending 複数・楽観適用ビュー表示中 | 途中の hash 比較 | I-4: 楽観ビューでは hash 一致を主張しない。ACK 完了・pending 空の静止点で committed hash を比較。 |

## I. 欠落検知 → requestCatchup / 重複無視 — AC3・§8.4・Phase 3

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-I1 | Client nextExpectedRevision=51 | operations{fromRevision:53}（52 が欠落）到着 | 適用を止め `requestCatchup{afterRevision:50}` 発行（= nextExpected-1）。53 は catch-up 完了まで**適用しない**（バッファ or 破棄して再取得）。 |
| S-I2 | S-I1 後 | Room が operations{fromRevision:51, toRevision:現在} を返す | 51→52→…と順に適用し nextExpectedRevision を前進。最終的に hash 一致（自動追従・AC3）。 |
| S-I3 | Client nextExpectedRevision=51 | operations{revision:49}（期待より小さい）到着 | **重複として無視**（§8.4）。二重適用0。 |
| S-I4 | catch-up 応答待ちの間に operations{fromRevision:54} が届く | 待機中の新着 | 順序を守るためバッファ or 破棄→再 catch-up。**revision 順を飛ばして適用しない**（Phase 3 DA「catch-up応答待ち中の新着処理」）。 |
| S-I5 | requestCatchup{afterRevision:N} | Room 応答 | operations{fromRevision:N+1, toRevision:current}。**off-by-one 無し**（N 自身は再送しない）。 |

## J. 再接続（§8.5）— AC1/AC5・Phase 3/4

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-J1 | Client が pending=[opX] を持ったまま切断 | 切断中 | 確定/未送信ローカル Operation を上限付きキューに保持。IME ドラフト相当（PoC ではローカル値）も保持。 |
| S-J2 | S-J1 の Client が再接続 | 再接続手順 | **先にサーバー差分を取得**（join lastAppliedRevision or requestCatchup）→ committed を最新へ → **その後で** pending(opX) を再検証 → 非競合なら再送、競合なら Conflict Queue（§8.5）。 |
| S-J3 | 切断中に Room で opX の対象セルが他者更新 | 再接続後 opX 再検証 | stale と判明 → 再送せず Conflict Queue。ローカル入力保持。二重送信/二重適用0。 |
| S-J4 | 再接続時、clientId は不変・connectionId は新規 | 再接続 | clientSequence は clientId 単位で**継続**（Room 側の per-clientId 表が再接続をまたいで保持）。古い connectionId の Presence は TTL/close で除去、新 connectionId で Presence 再登録。 |
| S-J5 | 切断が上限（暫定30秒/100 Operation）超過 | 長時間切断 | 編集停止・読み取り状態へ移行（§8.5。PoC では上限到達を検知して停止フラグ）。 |

## K. スナップショット復元起動 → catch-up — AC5・Phase 5

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-K1 | 稼働中 Room（文書＋Operationログ・currentRevision=R） | snapshot＋log を JSON エクスポート | エクスポート内容から状態を完全復元できる（revision・rowOrder・tombstone・lastChangedRevision を含む）。 |
| S-K2 | K1 のエクスポートから**新インスタンス**を復元起動 | import → currentRevision=R | 復元直後の文書 hash が停止前と一致（S-B2 と同根: 構築経路非依存）。 |
| S-K3 | 復元起動後、クライアントが再接続（lastAppliedRevision=R') | R' < R のクライアントが join | R'+1..R を catch-up 配信 → クライアント hash が Room と一致（AC5）。 |
| S-K4 | 復元後に新規 Operation を受理 | revision は R+1 から継続 | revision 単調性が復元をまたいで維持される（重複/巻き戻り無し）。 |

## L. Presence（connection単位・sequence・TTL）— 決定事項・§9・Phase 2/4

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-L1 | connA が join | Room | サーバーが connectionId・colorKey を割り当て（接続単位・同色回避）。他接続へ presenceDelta 配信、新規接続には presenceSnapshot。 |
| S-L2 | connA が presence{sequence:5, activeCell,selectionRanges,editingCell} 送信 | Room 中継 | 3種フィールド＋connectionId/userId/displayName/colorKey を presenceDelta で他接続へ。 |
| S-L3 | connA から sequence:5 の後に sequence:3 が届く（遅延/リオーダー） | Room | **古い更新を破棄**（sequence 単調比較・§9.3）。sequence:5 の状態を維持。 |
| S-L4 | connA が heartbeat を送り続ける | 注入クロックを TTL 未満で進める | Presence 維持（heartbeat 受信ごとに有効期限更新）。 |
| S-L5 | connA の heartbeat が途絶・注入クロックを**TTL(15s目安)超過**まで進めスイープ実行 | TTL 判定 | connA を `presenceRemoved{connectionId}` で削除。**TTL 判定は注入クロック**（実時間待ちなし・テスト可能）。 |
| S-L6 | connA が正常 close | close イベント | **即時** presenceRemoved（TTL を待たない・§9.3）。 |
| S-L7 | 同一 userId の connA・connB | 両接続が Presence 送信 | connectionId ごとに別 Presence として保持・配信（connection 単位管理）。片方 close で片方のみ削除。 |

## M. 収束・契約・復元の統合（フォールト注入）— AC1〜5・Phase 5

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-M1 | 3〜10 Client・シード付き PRNG | 10,000 件のランダム Operation（SetCells/InsertRows/DeleteRows 混合）＋重複/欠落/遅延/切断再接続を注入 | 静止点で**全 Client と Room の committed hash が一致**（AC1）。二重適用0。失敗時は**シードを標準出力**して再現可能に。 |
| S-M2 | S-M1 と同一シード | 再実行 | 完全に同一の実行列・同一の最終 hash（決定論。ID 生成も注入シードで再現）。 |
| S-M3 | S-M1 の実行 | フォールト注入カウンタを検査 | 注入した重複数>0・欠落数>0・切断数>0・reject 数>0 を**assert**（フォールトが実際に発火した=「テストのための実装」化の防止。Phase 5 DA）。 |
| S-M4 | S-M1 の実行 | 内容不変条件を検査 | 「非空セル数>0」「InsertRows/DeleteRows が最低1件適用」「Room hash == ログ再構築 hash」等の**自明でない invariant** を assert（全 no-op で通らないように）。 |
| S-M5 | 実WS（3 Client×1,000 件） | 縮小スモーク | hash 一致（実トランスポートでの疎通確認。件数は縮小してタイミング非決定の影響を限定）。 |
| S-M6 | 契約テスト（§20.3 該当分） | 重複/欠落/stale を個別に注入 | それぞれ AC2（同一ACK・二重適用0）/AC3（requestCatchup 発行・追従）/AC4（operationRejected・ローカル入力保持）を満たす。 |

---

## 未確定・ユーザー判断が要る点（合意ゲートで確認）

> 本 PoC の「決定事項」でユーザー合意済みの範囲を具体化したもの。以下は**実装前に確認したい細部**。

- **Q-1（no-op DeleteRows/同値 SetCells の revision 付与）**: S-E3（全件削除済み DeleteRows）や S-A9（同値上書き）を、(a) revision を消費して ACK するか、(b) revision を消費せず no-op ACK するか。仮決め = **(b) no-op は revision を消費せず、直近 revision を ACK に載せて返す**（ログ肥大と hash 揺れを避ける）。→ `protocol-subset.md` §Operation境界で確定。
- **Q-2（clientSequence 欠番の扱い）**: S-F3 で 6 が欠落し 7 が届いた場合、(a) reject して再送を促すか、(b) 到着を保留して 6 を待つか。仮決め = **(a) reject（`client-sequence-violation`）**。PoC のトランスポートは順序保証（同一接続内 FIFO）を前提にし、欠番は異常として扱う。→ ユーザー確認。
- **Q-3（Conflict Queue の再送 UX）**: reject されたローカル入力は保持するが、PoC では**自動再送しない**（保持＋カウントのみ・S-G2/S-J3）。「自分の値で再送/現在値採用/コピー」の UI 化は PoC-A 側/後続。この範囲でよいか。
- **Q-4（切断上限の暫定値）**: S-J5 の停止しきい値は計画書 §8.5 の暫定「30秒 または 100 Operation」を採用してよいか（Phase 0 で UX 確定は後続）。
- **Q-5（実WS スモークの規模）**: S-M5 を 3 Client×1,000 件としてよいか（10,000 件は in-process 収束試験 S-M1 が担い、実WS はタイミング非決定のため縮小）。

## Phase への写像（受け入れ基準トレーサビリティ）

| カテゴリ | 受け入れ基準 | コード化 Phase / ファイル |
|---------|-------------|--------------------------|
| A,B | AC1（決定論・hash） | Phase 1 `packages/sheet-core/src/*.test.ts` |
| C,D,E,F | AC2・境界仕様 | Phase 2 `packages/sheet-server-core/src/*.test.ts` |
| G | AC4（competition reject） | Phase 2/3 |
| H | AC4（rollback/replay） | Phase 3 `apps/collaboration-server/src/client-session/*.test.ts` |
| I | AC3（欠落 catch-up） | Phase 3 |
| J | AC1/AC5（再接続） | Phase 3/4 |
| K | AC5（復元） | Phase 5 `apps/collaboration-server/test/restart-restore.test.ts` |
| L | Presence（決定事項） | Phase 2 `presence.ts` テスト・Phase 4 smoke |
| M | AC1〜5（統合） | Phase 5 `convergence/ws-convergence/protocol-contract/restart-restore` |
