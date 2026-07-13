# DD-014 Codexレビュー依頼書（永続化・snapshot復元 / CG-3）

## 目的
「同期」済み operation をサーバー側で durable に保存し、サーバー再起動・ブラウザー再読込後も文書を復元できる状態を製品品質（Alpha）にする。
具体的には **durable ACK 契約 / operation log 永続化 / versioned snapshot format / snapshot＋tail log 復元一致 / 100k 相当で log 全replay 非依存（O(N²)回避）**を実装し **CG-3 を解除**する。

「保存」のみを扱い「同期」は扱わない（同期=DD-013・確定済 / reconnect/catch-up/再送=DD-015・未着手）。既定案どおりファイルベース（append-only JSONL oplog＋snapshot ファイル・fsync後ACK）で、PostgreSQL は Stage 2。

## スコープ（本レビューの対象差分＝working tree の未コミット分）
- 新規 `packages/server/src/oplog-store.ts` — append-only JSONL oplog（FileOpLogStore・group commit・torn write 破棄・中間破損 fail-fast・MemoryOpLogStore）
- 新規 `packages/server/src/snapshot-store.ts` — persisted snapshot format v1（checksum 封筒・atomic save temp→fsync→rename・世代保持 K=2・version/checksum fail-fast）
- 新規 `packages/server/src/persistent-room.ts` — durable ACK 境界＋snapshot 生成トリガー＋再起動復旧（recoverSequencerState）
- コア変更 `packages/core/src/apply.ts` — **二相適用リファクタ**。`applyOperation` は 1 回だけ clone→working copy を in-place 変更。新規 export `replayAcceptedOperations(base, ops)` は base を **in-place** で破壊しつつ clone 1 回で全 op 適用（O(N²) 回避・再起動復旧/tail replay 用）。
- 配線 `apps/collaboration-server/src/server.ts`（persistenceDir 指定で永続化有効化・durable 解決後 dispatch・seed を oplog へ durable 化・RoomController 抽象で PersistentRoom を Room と同形に駆動）、`packages/server/src/index.ts`（3 store を re-export）
- テスト: `oplog-store.test.ts` `snapshot-store.test.ts` `persistent-room.test.ts` `persistence-fault.test.ts`・`apps/collaboration-server/src/server.persistence.test.ts`・`tests/invariants/collab/persistence.invariant.test.ts`・計測 `scripts/dd014/measure-recovery.mts`

## 設計意図・確定した契約
- **log=正本 / snapshot=復元最適化物**（ADR-0005 server-ordered log と整合）。persisted snapshot は operationLog を埋め込まない（サイズ O(document)・write amplification 回避）。復元は snapshot(document@R)＋oplog tail(revision>R)。
- **durable ACK 契約**: submitOperation が accepted のとき oplog append（fsync）**完了後に** ACK/broadcast を dispatch（「ACK 受領=再起動後も失われない」）。broadcast も同じ durable 境界の後。reject/duplicate は oplog に書かず即応。
- **group commit**: 同一 flush ループ内の append を 1 回の write+fsync にまとめる（順序=enqueue 順=submit 順を保存）。
- **snapshot 生成**: N=1,000 accepted op ごとに非同期生成。保持 K=2 世代。log 切詰めなし（正本保全）。生成失敗は最適化物ゆえ oplog は無傷・ACK は既に durable。
- **fail-fast（AC6）**: format version 不一致・checksum 不一致・JSON 破損・oplog revision 不連続・snapshot revision > oplog 長・中間行破損 → throw（黙って空/部分文書化しない）。**末尾 torn write（改行なし=未 fsync=未 ACK）のみ**安全破棄＋件数報告。

## 重点で確認してほしい観点（findings 優先・具体指摘を）
1. **apply.ts 二相 in-place リファクタの安全性**（最重要）:
   - `applyOperation` が clone→in-place で、部分適用途中に throw した場合に **入力 doc（呼び出し側の共有参照）が汚れないか**。SetCells は検証を全件先出ししてから変更するが、Insert/Delete の throw 経路・working copy の所有権を確認。
   - `replayAcceptedOperations(base, ...)` が base を破壊する契約。呼び出し側（recoverSequencerState）が渡す base（deserializeSnapshot の産物・freshSequencerState.document）が **他所と共有されていないか**（aliasing で本番文書を壊さないか）。
   - リファクタで hash 決定性・changeSet/inverseSeed の従来契約に回帰がないか（既存 apply.test 26・hash.test 22 は green だが観点漏れがないか）。
2. **durable ACK 順序・torn write・corrupt fail-fast・fsync**:
   - ACK/broadcast が本当に fsync 後にのみ出るか（PersistentRoom.handleMessage → RoomBridge の Promise dispatch 経路）。書込失敗時の応答（接続切断 1011）が他接続へ波及しないか。
   - FileOpLogStore の group commit（scheduleFlush/flush の flushing フラグ・queue.splice）に **取りこぼし・二重 resolve・reject 後の状態不整合**がないか。close 時の flush 待ち（flushPromise）が pending append を確実に確定するか。
   - torn write 判定（末尾行のみ改行なしを破棄・中間は throw）が **改行を含むデータや複数末尾破損**で誤判定しないか。
   - snapshot atomic save（temp→fsync→rename→prune）で rename 前クラッシュ・prune が最新世代を消さないか。checksum の canonical JSON がキー順依存で不安定にならないか。
3. **仕様一致・回帰・テスト不足**: AC1〜9（DD-014 受け入れ基準）に対しテストが「通るように書いた」だけで実障害を注入できていない箇所、seed op を oplog へ durable 化する配線（baseRevision 破綻回避）の正しさ、snapshot 生成中に到着する op の取り漏らし、revision 連番の巻き戻り。

## 制約
- 既定案（ファイルベース・fsync後ACK・log正本/snapshot最適化物・PostgreSQL は Stage 2）を超える設計転換は本DD対象外（提案は歓迎するが Stage 2/別DD 送り可）。
- 物理抽出・Facade 公開は DD-016 委譲。reconnect/catch-up は DD-015。
- Alpha 信頼境界（トラステッド環境限定・本番バックアップ非保証・ACK 前クラッシュは未保証）は既知の未保証境界。

findings は「重要度・該当ファイル/行・再現/理由・提案」を添えて優先度順に列挙してください。
