# Codex レビュー依頼: DD-018-1 serve() の documentId × persistenceDir 不一致 fail-fast

## 背景・目的

`serve()`（公開 `ServeOptions`）は `documentId` と `persistenceDir` を独立に受け取る。文書Aで使用済みの
`persistenceDir` を別 `documentId` で起動すると、現行 recovery は persisted documentId を照合せず **A の内容を
新 ID として公開し得る**（DD-014 既知制約 P2-3・DD-018 Codex P1#2）。これを起動時 fail-fast で塞ぐ。あわせて
DD-014 P2-4（restoreFrom＋persistenceDir 併用の revision 不連続）も併合する。

roadmap §6 の version-mismatch 哲学（「不一致を検出して fail-fast・黙って誤読しない」）に倣う。

## スコープ（3つの fail-fast）

- **(a) documentId 照合（AC1）**: `recoverSequencerState` に `documentId` を渡し、persisted 側 documentId
  （snapshot.documentId を第一、無ければ oplog 先頭 entry の documentId）が要求 documentId と不一致なら throw。
  空 persistenceDir（persisted 無し・oplog 空）は fresh 起動ゆえ照合対象なし＝throw しない（過剰拒否防止）。
- **(b) 封筒 revision 相互一致（AC3）**: persisted snapshot があるとき `persisted.revision`＝
  `snapshot.currentRevision`＝`snapshot.document.revision` の三者一致を検査し、乖離（改竄/bit-rot・checksum は
  通り抜ける論理不整合）なら throw。
- **(c) restoreFrom×persistenceDir 排他（AC3・P2-4）**: `startServer` で両指定を明示拒否（throw）。

## 設計判断

- エラー語彙: サーバー起動時 throw は既存のサーバー側 fail-fast（`recoverSequencerState:` /
  `parsePersistedSnapshot:` / `deserializeSnapshot: 非対応の snapshot version`）と同じ関数名 prefix 付き
  descriptive Error に揃える。DD-017 の grid `error-codes.ts`（GridErrorCode/GridConflictCode）は
  クライアント Facade の runtime イベント語彙で別レイヤゆえ適用しない。**ServeOptions は不変**（公開 API 追加なし）。
- restoreFrom 全ログの durable bootstrap（P2-4 のもう一方の sanctioned 対応）は現 caller 不在・Alpha スコープ外
  ゆえ Stage 2 backlog へ据え置き、明示拒否を採用。

## 対象差分（uncommitted）

- `packages/server/src/persistent-room.ts`: `recoverSequencerState` に `documentId` 引数追加＋documentId 照合
  fail-fast（a）＋封筒 revision 三者一致検査（b）。
- `packages/server-hono/src/server.ts` `startServer`: restoreFrom×persistenceDir 排他 throw（c）＋
  recoverSequencerState へ documentId 伝播。
- 既存 caller（invariant / fault / measure スクリプト / 単体テスト）へ documentId 引数を伝播。
- テスト追加: `packages/server/src/persistent-room.test.ts`（documentId 不一致 snapshot/oplog 両経路・同一 ID
  positive・空 dir 通過・封筒 revision 不一致）／`packages/server-hono/src/server.persistence.test.ts`
  （誤公開シナリオで throw の end-to-end・AC2 同一 ID 再開・restoreFrom×persistenceDir 排他）。

## 重点的に確認してほしい観点（findings 優先）

1. **仕様一致**: AC1（別 documentId 起動で throw＝A の内容が B として公開されない）・AC2（同一 documentId 再開は
   従来どおり復元）・AC3（封筒 revision 相互検査・restoreFrom×persistenceDir 排他）を実際に満たすか。
2. **バリデーション/データ整合**: persisted documentId の権威源（snapshot 優先・oplog fallback）は妥当か。
   照合をすり抜ける経路（例: snapshot 有だが documentId 未検査の分岐、oplog 空＋snapshot 有の組合せ）はないか。
   封筒 revision 検査が既存の「snapshot revision > oplog 長」「oplog 連番」検査と順序・網羅で矛盾しないか。
3. **過剰拒否（DA観点）**: 正常な restoreFrom 単独・空 persistenceDir の fresh 起動・同一 documentId 再開を
   誤って拒否して復旧不能にしていないか。
4. **回帰**: 既存 recovery / durable ACK / snapshot 経路への影響、既存 caller への引数伝播漏れ。
5. **テスト不足**: 誤公開を実際に注入して throw を確認しているか（「通るように書いた」だけでないか）。
