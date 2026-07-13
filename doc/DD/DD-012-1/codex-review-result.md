LocalDate の正準表現と hash 分岐自体は決定的ですが、既存スナップショット世代と第一提供クライアントへの波及が不足しています。また、IME の DOM 不変条件を実際には検証できていないため、現状では ADR-0012 の Accepted 化を含めて完了扱いにできません。

Full review comments:

- [P2] date を含むスナップショットの形式世代を更新する — C:\repo\spreadjs\packages\core\src\operations.ts:25-25
  この版で date セルを含むスナップショットを生成し、変更前のサーバーへロールバックして復元すると、双方の `SNAPSHOT_VERSION` が 2 のままなので旧側も受理しますが、旧 `cloneCellScalar` には date 分岐がなく、その後の適用や hash 計算で `undefined` 化または例外になります。新しい wire variant の追加に合わせてスナップショット版を更新し、date を含む復元往復テストを追加してください。

- [P2] 組み込みデモの CellScalar 変換にも date を反映する — C:\repo\spreadjs\apps\playground\src\integration\document-view.ts:55-57
  組み込みの `/` デモが playground と同じサーバーへ接続する場合、`apps/collaboration-server/public/demo.html` の `scalarToText` は date を空文字として描画し、`textToScalar` は同じ日付入力を string として送信します。そのため第一提供クライアント間で表示と値型が不一致になるので、デモ側の双方の変換も date と標準パーサー規則へ追随させてください。

- [P2] textarea アダプターまで駆動して DOM 不変条件を検証する — C:\repo\spreadjs\tests\invariants\ime\ime.invariant.test.ts:103-104
  統合アダプターが composition 中に `setValue`、`setSelectionRange`、または textarea の置換を行う回帰が入っても、このテストは状態機械だけを生成して `BeginEdit` の回数を数えるため成功します。Effect 数は textarea instance・親・selection の不変性を証明しないので、fake `TextareaPort` と実際の `createImeEditingSession`、さらに DOM アダプターの同一 instance/parent を駆動する検証が必要です。

- [P2] 全角日付区切りの ADR 契約を実装と揃える — C:\repo\spreadjs\doc\adr\0012-local-date-cell-value.md:34-34
  全角スラッシュを使う `２０２６／７／３` を入力すると、`normalizeFullwidth` は U+FF0F を変換しないため string になりますが、ここでは全角区切りも正規化すると規定しています。確定済み受理表が半角区切りだけならこの記述を狭め、全角区切りも契約に含めるなら変換とテストを追加してから Accepted 化してください。

- [P2] date の文字列長をメモリ概算へ加算する — C:\repo\spreadjs\packages\core\src\cell-store.ts:44-45
  日付セルを大量に保持する場合、同ファイルの `valueChars` は `kind === 'string'` だけを数えるため、`approxMemoryBytes()` が date の UTF-16 文字列領域を常にゼロとして計上します。正準日付だけでも 500,000 セルで約 10 MB の過少評価となり、後続のメモリ実測資料を歪めるため date も文字数へ加算してください。
---

## 対応（DD-012-1・2026-07-13・Opus dd-implementer）

Codex は LocalDate・hash 決定性・偽陽性防止の**中核設計に異議なし**。findings 5 件（全 P2）は全対応（見送り0）。ADR-0012 を Accepted 化。

| # | finding | 対応 |
|---|---------|------|
| 1 | date snapshot を旧サーバーへロールバックすると壊れる（version 未更新） | ✅ `SNAPSHOT_VERSION` 2→3（cross-version fail-fast）＋date round-trip テスト（`packages/server/src/snapshot.test.ts`） |
| 2 | 組み込みデモ demo.html が date を空表示・string 送信で値型不一致 | ✅ `apps/collaboration-server/public/demo.html` scalarToText/textToScalar を date＋標準セット（桁区切り含む）へ追随 |
| 3 | Effect 数だけでは textarea instance/parent/selection の不変を証明しない | ✅ `tests/invariants/ime/` に実セッション（`createImeEditingSession`）+fake TextareaPort を追加。composition 中 setValue/setSelectionRange 非呼出・draft 保持を機械検証 |
| 4 | 全角スラッシュ ／(U+FF0F) が ADR 契約（全角区切り正規化）と不一致 | ✅ `cell-input.ts normalizeFullwidth` に U+FF0F→'/' を追加＋テスト（`２０２６／７／３`→date） |
| 5 | date の UTF-16 文字列領域が approxMemoryBytes で過少評価 | ✅ `cell-store.ts valueChars` が date も文字数計上 |
