# DD-014 Evidence（永続化・snapshot復元 / CG-3・Evidence Level: full）

> A区分 full 証跡。durable ACK 契約・fault matrix・復旧手順・100k 復旧計測生ログ・未保証境界を省略なく格納する。
> 生ログ: `doc/DD/DD-014/recovery-perf-raw.txt`。ADR: `doc/adr/0023-durable-persistence-and-versioned-snapshot.md`（Proposed）。

> **重要（2026-07-13・Codex xhigh レビュー結果）**: 本 DD は **CG-3 未解除・DD 未完了（確認待ち）**。サーバー側の
> durable ACK/snapshot format/再起動復旧/O(N²)回避（bulk）は実証済みだが、**AC4 のクライアント初期ロード節と AC8
> （ブラウザー再読込）は未達**（クライアントが snapshot bootstrap せず全 replay。`room.ts` handleJoin）。加えて durable
> frontier 未満 revision の観測（P1-3）・snapshot が frontier 超過（P1-4）・oplog 失敗時 poisoning 未実装（P1-5）が
> 未対応。詳細と対応は §11 と DD-014 本文ログ参照。以下の ✅ は**サーバー側で実証済みの範囲**を指す。

## 1. AC1〜9 充足対応表

| AC | 基準 | 充足状態 | 証拠 |
|---|------|---------|------|
| 1 | durable ACK 定義＋ACK 済み operation は強制終了→再起動後も失われない | ⚠️ 部分（P1-3/P1-5 未対応） | 本書 §2（契約）。`persistent-room.test.ts`「ACK/broadcast は oplog append（fsync）解決後にのみ dispatch される」。`server.persistence.test.ts` 再起動復旧（close→再 startServer で ACK 済み文書再現・hash 一致）。`oplog-store.test.ts`「append→readAll 往復」。**残**: 未 durable revision が他読取から観測可（P1-3）・append 失敗時 poisoning 未実装（P1-5） |
| 2 | versioned snapshot format 定義＋serialize→persist→load→deserialize 往復一致 | ✅ | 本書 §4（format v1）。`snapshot-store.test.ts` persisted format v1 往復一致・checksum/version fail-fast・世代保持・atomic save |
| 3 | snapshot＋tail log 復元 hash == log 全replay hash | ✅ | `persistent-room.test.ts`「snapshot＋tail replay の hash == oplog 全 replay の hash」「snapshot が古い revision でも tail replay で最新 hash 一致」「snapshot 無し全 replay 一致」。`persistence.invariant.test.ts` randomized（seed 記録・§2.3 常設化） |
| 4 | 100k セル相当で再起動復旧・初期ロードが log 全replay 非依存（snapshot＋tail のみ） | ⚠️ サーバー✅/クライアント✗（P1-6） | **サーバー**: `recovery-perf-raw.txt`＝snapshot-based recovery は tailReplayed=tail 長のみ・865/660/565ms・≦5秒（本書 §5）。**クライアント初期ロードは未達**: join が全 operationLog を返し client 全 replay（`room.ts` handleJoin・§8） |
| 5 | O(N²)回避: 復元時間が tail 長に線形（tail 長 2 点以上） | ⚠️ bulk✅/実ログ未検証（P2-1） | `recovery-perf-raw.txt`＝tail 250→500→1000（×2.00）で時間 ×0.76/×0.86。`apply.ts` `replayAcceptedOperations`＝clone 1 回 in-place batch。**残**: 計測は bulk insert・単一行 InsertRows 連発は `nextSlot` 全走査で Θ(N²)（P2-1）。本書 §5 |
| 6 | corrupt/unsupported version の fail-fast（黙って空/部分文書化しない） | ✅ | 本書 §6 fault matrix。`persistence-fault.test.ts`・`oplog-store.test.ts`（中間破損 throw / torn write 破棄＋件数報告）・`snapshot-store.test.ts`（version/checksum fail-fast） |
| 7 | snapshot は正本か最適化物かの定義＋再起動復旧手順の文書化＋自動試験 green | ✅ | 本書 §3（log=正本・snapshot=最適化物）・§7（復旧手順）。`server.persistence.test.ts` が手順どおりを自動化 |
| 8 | ブラウザー再読込で編集済み文書が復元される（durable ACK 済み確定値） | ✗ 未達（P1-6/P1-7） | クライアントが snapshot bootstrap せず join で全 operationLog を replay（`room.ts` handleJoin・`session.ts` committed.revision=0）。実 Playwright ブラウザー再読込 E2E も未実施。**要判断**（snapshot ベース join＋E2E 追加が必要） |
| 9 | 回帰なし: test/typecheck/lint（boundary 新規0）/build/test:invariants green | ✅（既知flaky除く） | 本書 §9。`npm run test` **676 pass**（唯一 fail は既知flaky ws-convergence.smoke タイムアウト・本DD無関係）・typecheck green・lint green（boundary baselined=41 new=0）・build green |

## 2. durable ACK 契約

- **契約**: submitOperation が **accepted** のとき、oplog append（**fsync 完了**）**後にのみ** ACK/broadcast を dispatch する。「**ACK 受領＝サーバー再起動後も失われない**」。
- **順序**: submit（revision 割当・in-memory log 追記）は同期でここで順序確定。durable 境界（fsync）解決後に RoomBridge が ACK/broadcast を dispatch（`PersistentRoom.handleMessage` が Promise を返し、`RoomBridge.onMessage` が `result.then(dispatch)`）。
- **reject/duplicate**: oplog に書かず即応（accepted のみ durable 境界を通る）。`persistent-room.test.ts`「reject/duplicate は oplog へ書かず即応」で oplog 空を固定。
- **group commit**: 同一 flush ループ内の append を 1 回の write+fsync にまとめる（`FileOpLogStore.scheduleFlush`/`flush`）。順序=enqueue 順=submit 順=revision 順。`oplog-store.test.ts`「group commit でまとめても順序と durability を保つ」。
- **書込失敗**: 当該接続のみ 1011 切断・他接続へ波及させない（`RoomBridge.onMessage` の `.catch`）。
- **broadcast 境界**: broadcast も ACK と同一 durable 境界の後（同じ Promise で dispatch）。
- **未保証境界（§6・明示）**: ACK **前**のクラッシュ（fsync 未完了）での当該 operation 喪失は保証範囲外。fsync が OS/FS/ディスクキャッシュを honest に貫く前提（bit-rot・電源喪失時ディスクキャッシュ honesty は非保証）。ファイルベース永続化は Alpha トラステッド環境向けで本番バックアップを意味しない。

## 3. snapshot 正本定義

- **operation log（oplog.jsonl）＝正本**（ADR-0005 server-ordered log・replay 決定性が正）。
- **persisted snapshot＝復元最適化物**。operationLog を埋め込まない（サイズ O(document)・write amplification 回避）。復元は snapshot(document@R)＋oplog tail(revision>R)。
- snapshot 生成失敗は最適化物ゆえ oplog（正本）無傷・ACK は既に durable・次回生成でリカバリ。

## 4. persisted snapshot format v1

- 封筒: `{ formatVersion: 1, documentId, revision(R), createdAt(ISO), snapshot(SnapshotData v3・operationLog=[]), checksum }`。
- checksum = sha256(canonical payload without checksum)。canonical payload はキー順固定（決定的 checksum）。
- 中身 SnapshotData は既存 v3（DD-010/012-1・RowId キー CellStore・version 不一致/重複 slot/孤児セル fail-fast）。封筒 format と中身 version を独立検査。
- save は atomic: temp → write → fsync → rename → prune（K=2 世代保持）。rename 前クラッシュでも旧世代が loadLatest 対象で残り部分 snapshot を見せない。ファイル名 `snapshot-{revision}.json`。

## 5. 100k 復旧計測（生ログ: recovery-perf-raw.txt）

base cells: 1000 行 × 100 列 = 100,000 セル。node v22.20.0。

| 経路 | tail | totalOps | recoverMs | fromSnapshotRevision | tailReplayed | hashMatch |
|------|------|----------|-----------|----------------------|--------------|-----------|
| snapshot-based | 250 | 100,251 | 864.9 | 100,001 | 250 | true |
| snapshot-based | 500 | 100,501 | 660.3 | 100,001 | 500 | true |
| snapshot-based | 1000 | 101,001 | 564.6 | 100,001 | 1000 | true |

- **log 全replay 非依存（AC4）**: tailReplayed = tail 長のみ（totalOps 100k+ に非依存）。snapshot(document@R) load＋tail replay のみ。DD-006 の 14 分（全 replay）経路を排除。目標 100k 復旧 ≦5秒 → 全ケース ≦0.87 秒で達成。
- **O(N²)回避 / 線形性（AC5）**: tail 250→500（×2.00）で時間 ×0.76、tail 500→1000（×2.00）で時間 ×0.86。O(N²) なら tail比²=4 に近づくはずが、時間比 << tail比² ＝ O(N²) 非該当（概ね線形・GC/測定ノイズで tail 増でも時間微減の range あり）。
- **実装根拠**: `apply.ts` `replayAcceptedOperations(base, ops)`＝base を in-place 破壊しつつ clone 1 回で tail 全適用（op ごとの full clone を排除。従来 `applyOperation` を N 回呼ぶと N 回 clone＝O(N²)）。full-replay 対照（tailReplayed=totalOps）も併記され hashMatch=true。
- **再現コマンド**: `node scripts/dd014/measure-recovery.mts`（`doc/DD/DD-014/recovery-perf-raw.txt` を再生成）。

## 6. fault matrix（AC6・fail-fast）

| ケース | 注入 | 期待 | 固定テスト |
|--------|------|------|-----------|
| unsupported snapshot format version | formatVersion≠1 | throw（非対応 version） | `snapshot-store.test.ts` / `persistence-fault.test.ts` |
| snapshot JSON 破損 | 不正 JSON | throw（JSON parse で fail） | `persistence-fault.test.ts` |
| snapshot checksum 不一致 | payload 改竄 | throw（checksum 不一致・破損の疑い） | `snapshot-store.test.ts` / `persistence-fault.test.ts` |
| oplog 中間行破損（既 ACK データ） | 中間行を NOT_JSON | throw（corruption at line N） | `oplog-store.test.ts` / `persistence-fault.test.ts` |
| oplog 末尾 torn write（改行なし=未 fsync=未 ACK） | 末尾に改行なし途中 JSON | 安全破棄＋discardedTornRecords 報告（空文書化しない） | `oplog-store.test.ts`「torn write は破棄して件数を報告」 |
| oplog revision 不連続 | revision 飛び | throw（revision 不連続・破損） | `persistent-room.ts` recoverSequencerState / `persistence-fault.test.ts` |
| snapshot revision > oplog 長 | snapshot が log より先 | throw（snapshot が log より先・破損） | `persistence-fault.test.ts` |
| snapshot 欠落＋log 残存 | snapshot 無し | 縮退経路で oplog 全 replay・hash 一致（空文書化しない） | `persistent-room.test.ts`「snapshot 無し全 replay」 |

- **共通原則**: 黙って空文書・部分文書にせず、明示エラーで起動失敗する（AC6）。唯一の安全破棄は末尾 torn write（未 ACK ゆえデータ損失なし）で、破棄は件数報告し隠蔽しない。

## 7. サーバー再起動復旧手順

1. `startServer({ persistenceDir })` で起動。`recoverSequencerState({ oplog, snapshotStore, columnOrder })` を実行。
2. `snapshotStore.loadLatest()`＝最新有効 snapshot（破損なら throw）。`oplog.readAll()`＝全 operation（末尾 torn write 破棄・中間破損 throw）。
3. oplog の revision 連番検証（不連続なら throw）。
4. snapshot 有: `deserializeSnapshot` で document@R を復元 → oplog tail(revision>R) を `replayAcceptedOperations` で in-place replay → currentRevision=N・operationLog=全 log（catch-up 供給用）・ackCache/clientSequenceTable を前進。snapshot 無: 空文書から全 replay（縮退）。
5. 復旧内訳（fromSnapshotRevision/totalOps/tailReplayed/discardedTornRecords）を `RunningServer.recovery` で公開・stdout 出力。
6. fresh（復元でも restoreFrom でもない）起動時は seed op を oplog へ durable 化（seed が oplog に無いと edit の baseRevision が破綻するため）。
- **自動試験**: `apps/collaboration-server/src/server.persistence.test.ts` が close→再 startServer（同 persistenceDir）で ACK 済み文書の hash 一致・revision 継続を機械検証。

## 8. ブラウザー再読込復元（AC8）— ✗ 未達（要判断・Codex P1-6/P1-7）

- **現状（未達）**: サーバーの `Room.handleJoin` は `operationsSince(join.lastAppliedRevision)` を返す。ブラウザー再読込で生成される新規 `ClientSession` は `committed.revision=0` で join するため（`packages/collab/src/session.ts:465`）、**全 operationLog を受信して client 側で全 replay**する。snapshot ベースの client bootstrap（`/snapshot` 取得→snapshot 初期化→tail のみ join 受信）は**未実装**。したがって AC4 のクライアント節（初期ロードが log 全replay 非依存）と AC8（ブラウザー再読込復元）は満たさない。
- **未実施**: 実 Playwright ブラウザーでの「編集→durable ACK→再読込→確定値復元＋サーバー再起動を挟む復元」E2E は未実施。`server.persistence.test.ts` は Node の `WsClientTransport` で新規接続の初期状態一致を確認しているのみ（実ブラウザーの再読込経路ではない）。
- **要判断**: (a) join プロトコルに snapshot bootstrap 経路を追加（server が welcome で snapshot を配り client が snapshot 初期化→tail 受信）＋(b) 実ブラウザー Playwright E2E の追加。子DD DD-014-M もしくは本DD追加 Phase の要否をユーザー/オーケストレータ判断。

## 9. 回帰（AC9・機械検証）

- `npm run test`: **676 pass / 1 fail**。唯一の fail は既知flaky `ws-convergence.smoke`（3×1,000 実 WS smoke・58〜60s 境界のタイムアウト・単体でも再現・persistenceDir 非使用ゆえ本DD変更と無関係・是正は DD-015 スコープ）。DD-014 ユニット green（oplog-store 8〔P1-1/P2-2 テスト追加〕・snapshot-store 9・persistent-room 6・persistence-fault 8・server.persistence・persistence.invariant 4）。apply.test 26・hash.test 22・cell-store-differential 6 含め二相リファクタで回帰なし。
- `npm run typecheck`: green。
- `npm run lint`: green（eslint＋boundary `baselined=41 new=0 stale-baseline=0`＝新規境界違反0・DD-016 委譲維持）。
- `npm run build`: green。

## 10. 密度計測（roadmap §2.4）

| 指標 | 値 |
|------|-----|
| 人間確認時間 | 要確認①〜④は起票時に既定案提示・本仕上げ段はユーザー合意済スコープ内で停止なし |
| Codex effort/回数 | xhigh × 1 回（DD 起票時判定どおり） |
| ゲート待ち | Codexレビュー（xhigh）実行の待ち |
| findings 数 | 12（P1×7・P2×5）。対応=3件即修正・9件要判断（本書 §11） |

## 11. Codexレビュー結果（xhigh・1回）

依頼書 `doc/DD/DD-014/codex-review-request.md`／結果 `doc/DD/DD-014/codex-review-result.md`。**apply.ts 二相リファクタは致命指摘なし**（部分適用時の破壊・aliasing・reject 汚染の観点で問題検出されず）。永続化の durable 境界とクライアント bootstrap に **12 findings**。

| # | 重要度 | 概要 | 対応 |
|---|--------|------|------|
| P1-1 | P1 | oplog 末尾の改行なし完全 JSON を復元してしまう／破損バイトを truncate せず再 append が連結 | ✅修正（`oplog-store.ts` readAll で改行なし末尾を内容によらず破棄・ensureOpen で最後の改行まで物理 truncate・テスト2件追加） |
| P1-2 | P1 | `FileHandle.write` の short write 未確認で durable 誤判定（oplog＋snapshot） | ✅修正（`writeAllBytes` で全バイト書き切り・両 store） |
| P2-2 | P2 | 初回起動で oplog 親ディレクトリ未作成→ENOENT クラッシュ | ✅修正（ensureOpen で `mkdir recursive`・テスト追加） |
| P1-3 | P1 | fsync 前の revision が join/catch-up/`/snapshot` から観測可能（durable frontier 未満を隠さない） | ⏸️要判断（読取を durable frontier までゲートする設計） |
| P1-4 | P1 | snapshot が durable frontier を超え得る→再起動 fail-fast で起動不能 | ⏸️要判断（fsync 済み最大 revision から snapshot 生成する barrier） |
| P1-5 | P1 | oplog append 失敗時に送信元 socket のみ切断で room 継続→revision 欠番 | ⏸️要判断（store/room poisoning・保留バッチ reject） |
| P1-6 | P1 | クライアント初期ロードが snapshot bootstrap せず全 replay（AC4 クライアント節 未達） | ⏸️要判断（snapshot ベース join 経路の新設） |
| P1-7 | P1 | 実 Playwright ブラウザー再読込 E2E 未実施で AC8/完了/CG-3 を確定不可 | ⏸️要判断（CG-3 未解除・DD 未完了として扱い＝本仕上げで反映済み） |
| P2-1 | P2 | 単一行 InsertRows 連発は `nextSlot` 全走査＋splice で Θ(N²)（計測は bulk で回避＝AC5 実ログ未検証） | ⏸️要判断（slot cursor 等・core apply.ts 変更） |
| P2-3 | P2 | recovery で documentId・revision メタの相互検証なし（別 documentId 起動で誤公開） | ⏸️要判断 |
| P2-4 | P2 | restoreFrom＋persistenceDir 併用で既存 log が oplog へ書かれず revision 不連続 | ⏸️要判断（組合せ拒否 or bootstrap） |
| P2-5 | P2 | snapshot 生成中の閾値超過分が完了後に再判定されず tail が肥大 | ⏸️要判断 |

**総括**: サーバー再起動復旧・durable ACK（fsync 後）・snapshot format v1・O(N²)回避（bulk）はサーバー側で実証。ただし Codex xhigh（CG-3 の指定レビューゲート）が **AC4 クライアント節/AC8 未達**と durable 境界の複数ギャップを検出したため、**CG-3 未解除・DD 未完了**。残 P1（クライアント bootstrap・durable frontier・poisoning）は設計判断＋追加スコープゆえ要判断で呼び出し元へ返す。
