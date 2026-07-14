# DD-018-1: serve() の documentId × persistenceDir 不一致 fail-fast

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-15 | 2026-07-15 | 検討中 | DD-018 判定で切り出した子DD（Codex P1#2・K7=DD-014 P2-3）。**起票のみ**＝着手はユーザー判断。**非ブロッカー扱いをユーザー承認（2026-07-15）**＝Alpha 宣言は成立・本DDは追跡課題。起票時の DD-018-M から採番是正 |

## 目的

`serve()`（公開 `ServeOptions`）が `documentId` と `persistenceDir` を独立に受け取るため、**文書Aで使用済みの `persistenceDir` を別 `documentId` で起動すると、現行 recovery が persisted documentId を照合せず A の内容を新 ID として公開し得る**（DD-014 既知制約 P2-3）。これを **起動時 fail-fast**（persisted documentId／revision 封筒と要求値の不一致検出で拒否）で塞ぐ。

## 背景・課題

- 出自: DD-014 既知制約 **P2-3**「recovery の documentId/revision 相互検証欠如」。DD-014 では「異常構成のエッジケース」として Alpha 対象外の既知制約に分類（ユーザー決定 2026-07-13）。回収先=「起動 recovery 堅牢化の後続DD」。
- DD-018 Codex 証拠監査（high・2026-07-15）**P1#2** が再評価: `documentId`/`persistenceDir` は**公開 Facade 入力**であり、悪意ある入力ではなく**通常の内部設定ミス**で誤公開に至る。roadmap §6 の trusted internal 境界（tenant isolation 非保証）では防げず、§6 の version-mismatch fail-fast 哲学（「古い snapshot/protocol を誤読しない・不一致を検出して fail-fast」）に倣うべき、と指摘。
- DD-018 判定での扱い: K7 を「延期→子DD DD-018-1 切り出し」とし、**Alpha ブロッカー扱いの是非はユーザー判断へ残した**（§6 は documentId を security 境界としない・P2-3 はユーザー既決で Alpha 対象外＝§5 でスコープ再決定しない、を根拠に DD-018 本判定は非ブロッカー。ただし Codex は不合格＝fail-fast 必須を主張）。

## 検討内容（着手時に精査）

- 関連: DD-014 P2-4（restoreFrom＋persistenceDir 併用の revision 不連続）も同じ recovery 堅牢化の範囲。まとめて扱うか要検討。
- fail-fast の粒度: (a) persisted `documentId` と要求 `documentId` の不一致で throw ／ (b) 封筒 revision と `snapshot.currentRevision`/`document.revision` の相互一致検査 ／ (c) 明示 override フラグ（意図的な restoreFrom）との両立。
- 公開面への影響: `ServeOptions` に検証エラーの通知経路（error code）を足すか。既存の fail-fast（version mismatch）と語彙を揃える。

## 決定事項

（着手時に記入）

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | 文書A使用済み `persistenceDir` を `serve({documentId:'B', persistenceDir: dirA})` で起動 → persisted documentId 不一致を検出して **fail-fast（起動拒否・明示エラー）**。A の内容が B として公開されない | Phase 実装 🔬（fault/negative テスト） |
| 2 | 正常系（同一 documentId で既存 persistenceDir を再開）は従来どおり復旧できる | 🔬（既存 recovery テスト green 維持） |
| 3 | 封筒 revision と snapshot/document revision の相互検査で不整合を fail-fast（P2-4 併合時） | 🔬 |

## タスク一覧

### Phase 0: 事前精査
- [ ] 📋 各Phaseのタスク精査・詳細化（着手時）
- [ ] 📐 実装前詳細化トリガー判定（recovery=起動時の状態確立・データ整合に触れる＝詳細化要の見込み）
- [ ] 🧑‍⚖️ Codexレビュー要否判定（見込み: 必須・入力検証/データ整合の公開面）
- [ ] 😈 Devil's Advocate調査（正常な restoreFrom 意図との誤判定・過剰拒否で復旧不能にしないか）

### Phase 1: recovery 相互検証・fail-fast 実装（着手時に詳細化）
- [ ] `packages/server/`（recovery 経路）で persisted documentId × 要求 documentId の照合＋不一致 fail-fast
- [ ] revision 封筒相互検査（P2-4 併合判断次第）
- [ ] 🔬 機械検証: negative テスト（誤公開シナリオで throw）＋正常系 green
- [ ] 😈 DA批判レビュー
- [ ] Codexレビュー（Phase 0 判定次第）

## ログ

### 2026-07-15
- DD-018 判定（Codex P1#2 追認）で起票。**起票のみ＝着手はユーザー判断**（DD-018 要確認E: 子DD起票まで自動・着手はユーザー）。Alpha ブロッカー扱いの是非も要ユーザー判断（DD-018 総合判定は非ブロッカーとしつつ透明化のため本DDへ切り出し）。
- 出自証拠: `doc/archived/DD/DD-014_永続化・snapshot復元.md`（既知制約 P2-3/P2-4）・`doc/DD/DD-018/codex-review-result.md`（P1#2）・`doc/DD/DD-018/stage1-gate-checklist.md`（C節 K7）。

---

## DA批判レビュー記録

> 本DDは **DD-018 判定で起票のみ（未着手）**。DA批判レビューは着手時（Phase 0〜1）に実施・記録する（要確認E: 着手はユーザー判断）。起票段階のリスク観点は「## 検討内容」に記載（正常な restoreFrom 意図との誤判定・過剰拒否で復旧不能にしない）。
