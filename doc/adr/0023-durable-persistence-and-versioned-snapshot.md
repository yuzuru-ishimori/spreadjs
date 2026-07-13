# ADR-0023: Durable 永続化契約と versioned persisted snapshot format

- **Status**: **Proposed**（2026-07-13）。DD-014（永続化・snapshot復元）で本 ADR の方式（durable ACK 契約・operation log 永続化・persisted snapshot format v1・snapshot＋tail 復元一致・100k で log 全replay 非依存＝O(N²)回避）を実装し、サーバー側は自動試験・100k 復旧計測で実証した。ただし **Codex xhigh レビューで P1 findings（durable frontier 未満 revision の観測・snapshot が durable frontier 超過・oplog 失敗時の room poisoning・クライアント snapshot bootstrap 未実装）を検出し未反映**のため、**Accepted は当該 findings 反映後**とする（Accepted 化＝原則 External Review 対象だが、本件は DD-010/ADR-0011・DD-012-1 先例に倣い Codex xhigh レビューをもって承認代替とする）。永続化方式の大きな設計転換（例: PostgreSQL 本採用）が生じたら停止して再判定・ユーザー提示。
- **関連**: 計画書 §19（Phase 2 永続化）・§6（信頼境界）／roadmap §0 CG-3・§4 DD-014／ADR-0005（server-ordered operation log＝本 ADR の「log=正本」の前提）／ADR-0015（version 不一致 fail-fast）／DD-010・ADR-0011（RowId キー CellStore＝CG-2・本 DD の前提）／DD-013（同期・本 ADR は触れない）・DD-015（reconnect・切断系）／DD-016（Facade・物理抽出）

## 背景・課題

DD-006 までの collaboration-server は **全てインメモリ**で、operation log・snapshot はプロセス内にのみ存在した（ADR-0005 の server-ordered log／snapshot v3 は実装済だがディスク永続化・durable ACK・再起動復旧は未実装）。サーバープロセスが落ちれば全文書が消える。CG-3（snapshot 正式形式）は Alpha のハードゲートで、reconnect DD（DD-015）の前に解除する必要がある。

制約:
- **DD-006 AC5 の実測**: 100k セル相当の全 operation replay は **14 分**＝log 全replay 依存の初期化は成立しない。snapshot ベース初期化が必須（§8 既知制約の回収先）。
- **Alpha 信頼境界（§6）**: トラステッド環境限定・本番バックアップ非保証。過剰なインフラ（PostgreSQL 常時稼働・HA）は Alpha には過剰。
- **データ消失リスク**: durable ACK 契約の欠陥（ACK 済み operation の喪失）・corrupt snapshot の誤読（黙って空文書化）は CG-3 の趣旨に反する。

## 決定

### 1. 永続化バックエンド（要確認①）
ストレージを薄い interface（`OpLogStore` / `SnapshotStore`）で抽象化し、**Alpha はファイルベース実装のみ**を提供する（append-only JSONL operation log ＋ snapshot ファイル・fsync 制御）。**PostgreSQL adapter は Stage 2（本番運用段階）で追加**する。理由: 依存追加を避け（roadmap §2.1 A区分トリガー）、現 Phase exit に必要な品質に留める（L4）。

### 2. durable ACK 契約（要確認②）
- submitOperation が **accepted** のとき、oplog append（**fsync 完了**）**後にのみ** ACK/broadcast を dispatch する。契約は「**ACK 受領＝サーバー再起動後も失われない**」。broadcast も同一の durable 境界の後。
- reject/duplicate は oplog に書かず即応する（accepted のみが durable 境界を通る）。
- 実装として **group commit**（同一 flush ループ内の append を 1 回の write+fsync にまとめる小バッチ）を許容する。順序は enqueue 順（= submit 順 = revision 順）で保存する。
- 書込失敗時は当該接続のみ切断（1011）し、他接続へ波及させない。
- **未保証境界**（§6・明示）: ACK **前**のクラッシュ（fsync 未完了）で当該 operation が失われることは保証範囲外。fsync が OS/FS/ディスクキャッシュを honest に貫く前提（bit-rot・電源喪失時のディスクキャッシュ honesty は非保証）。

### 3. snapshot の位置づけ・生成・保持（要確認③）
- **operation log を正本、snapshot は復元最適化物**と定義する（ADR-0005 の server-ordered log・replay 決定性を正とする）。
- persisted snapshot は **operationLog を埋め込まない**（サイズ O(document)。埋め込むと snapshot 生成ごとに O(N) 書込＝総 O(N²) の write amplification）。復元は **snapshot(document@R) ＋ oplog tail(revision>R)**。
- 生成: 前回 snapshot 以降 **N=1,000 accepted operation** ごとに**非同期**生成。保持は **直近 K=2 世代**。それより古い log の切詰めは Alpha では行わない（正本保全優先）。
- 生成失敗は最適化物ゆえ oplog（正本）は無傷・ACK は既に durable。次回生成でリカバリする。

### 4. versioned persisted snapshot format v1
既存 SnapshotData **v3**（中身）を土台に、永続化封筒 **format version 1**（`formatVersion` / `documentId` / 確定 `revision` / `createdAt` / `snapshot`(v3) / `checksum`＝sha256(canonical payload)）を付与する。封筒 format と中身 version は独立に検査する。save は **atomic**（temp → write → fsync → rename）で、rename 前クラッシュでも旧世代が `loadLatest` 対象で残り、部分 snapshot を見せない。

### 5. fail-fast（AC6・ADR-0015 と整合）
version 不一致・checksum 不一致・JSON 破損・oplog **中間行**破損・oplog revision 不連続・snapshot revision > oplog 長 は **throw**（黙って空/部分文書化しない・自動 migration はしない）。**例外は oplog 末尾の torn write**（改行なし = fsync 未完了 = 未 ACK）で、これのみ安全に破棄し**破棄件数を報告**する。

## 結果（DD-014 の実装・計測）

- **実装**: `packages/server/src/{oplog-store,snapshot-store,persistent-room}.ts`（＋各 `.test.ts`）。配線 `apps/collaboration-server/src/server.ts`（`persistenceDir` 指定で有効化）。O(N²)回避のため `packages/core/src/apply.ts` を二相適用へリファクタ（`applyOperation`＝clone 1 回→in-place、新規 `replayAcceptedOperations`＝base を in-place 破壊しつつ clone 1 回で tail 適用）。
- **復元一致（AC3）**: snapshot＋tail replay の文書 hash == log 全replay の hash を単体＋randomized 不変条件（`tests/invariants/collab/persistence.invariant.test.ts`・seed 記録）で常設化。
- **100k 復旧計測（AC4/AC5・`doc/DD/DD-014/recovery-perf-raw.txt`）**: base 100k セル。snapshot-based recovery tail 250/500/1000 = **865/660/565ms**（全 hashMatch=true・≦5秒目標達成）。tailReplayed=tail 長のみ（log 全長 100k+ に非依存）＝log 全replay 非依存。O(N²)回避: tail ×2.00 に対し時間 ×0.76/×0.86（tail比²=4 から程遠い＝概ね線形）。
- **fault matrix（AC6・`doc/DD/DD-014/evidence.md`）**: unsupported version・JSON 破損・checksum 不一致・oplog 中間破損・torn write（末尾のみ破棄）・snapshot 欠落＋log 残存 の各ケースを注入して fail-fast/安全破棄を固定。
- **回帰**: `npm run test` 674 pass / 0 fail（apply.test 26・hash.test 22 含む＝リファクタで hash 決定性維持）・typecheck・lint（boundary 新規 0）・build green。

## 再検討条件

- **PostgreSQL 本採用**への転換（本番運用・HA・複数サーバー・tenant isolation が要件化）＝ Stage 2。運用（起動前提・接続設定・migration）が Alpha 配布 DD-017 へ波及するため停止して再判定・ユーザー提示。
- ログの無限成長（切詰めなし前提）が運用制約になり、log 退避・snapshot 圧縮・`resyncRequired` の本実装が必要になる。
- fsync のみでは不十分な耐障害要件（電源喪失・bit-rot 保証・チェックサム付き WAL・レプリケーション）が生じる。
