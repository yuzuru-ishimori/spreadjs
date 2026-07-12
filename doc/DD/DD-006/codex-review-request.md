# DD-006 Codexレビュー依頼書

- **対象DD**: DD-006（PoC-Dデータ表現・簡易数式）
- **effort**: high（起票時確定・TDD対象＋parser=入力検証＋新規パッケージ外部I/F）
- **実行**: `bash scripts/codex-review.sh --request doc/DD/DD-006/codex-review-request.md --out doc/DD/DD-006/codex-review-result.md --uncommitted --effort high`
  - ※ 本セッションでは Codex CLI が利用不可のため未実施。Codex CLI のある環境／ユーザーが実行する。

## レビュー対象（差分）

DD-006 で追加した実装のみ（既存 packages/playground/collaboration-server は無変更）:

- `packages/sheet-formula/`（製品パッケージ候補・外部ランタイム依存ゼロ）: `errors`・`limits`・`a1`・`ast`・`tokenizer`・`parser`・`bind`・`evaluator`・`dep-graph`・`recalc`＋各テスト
- `apps/pocd-bench/`（PoC計測CLI）: `cell-store`・`stores/*`（4実装）・`data-gen`・`bench-cellstore`・`bench-recalc`・`op-gen`・`bench-replay`・`integration-sheetcore.test`＋テスト
- `apps/pocd-browser-bench/`（AC9 最小ページ）
- ADR差分: `doc/adr/0011`（DD-006拡充）・`doc/adr/0022`（新規ドラフト）

## 重点レビュー観点

1. **parser=入力検証（AC8）**: 資源制限 L1〜L6（`function-spec.md` §1）の実装が「例外を外へ出さず対応エラー値を返す」を満たすか。深いネスト・巨大範囲・過多引数でスタック枯渇/暴走がないか。トークナイザのロケール非依存（全角/未定義文字の拒否）。
2. **評価器の意味論（`function-spec.md` §2〜§4）**: 5関数の空白/文字列/エラー/範囲/数値変換、特殊値（非有限→#VALUE!・0除算優先・負の0正規化）、ロケール不変、エラー発生フェーズの優先。COUNT のみエラー非伝播が正しいか。`function-spec.md` を単一の正としテスト側に別仕様がないか。
3. **依存グラフの正しさ**: dirty→topological order（precedent 先）、**反復DFS の cycle 検出**（自己/相互/N項/範囲自己包含を全メンバー #CYCLE! 化できているか）、2戦略（expand/interval）の dependents 等価性。
4. **固定IDバインド（AC3/4）**: A1↔BoundCellReference、行挿入で RowId 不変・削除で #REF!。sheet-core 実文書結合が「読み取り＋apply のみ」で既存 package を汚していないか。
5. **CellStore 4実装の等価性（AC1）**: 同一操作列で4実装が同一 get/nonEmptyCount/queryRange を返すか。columnar の数値列 Float64Array 化が round-trip を壊さないか。
6. **env-free 純度（ADR-022）**: `sheet-formula` が DOM/Node 非参照・`dependencies:{}`・`typecheck:core` green。
7. **計測の妥当性**: bench-protocol 準拠（warmup/GC/順序/生JSON）、合否と参考の区別（`meta.acRelevant`）、レポートの結論が実測に裏付くか。
8. **憲章整合**: apps 間の内部 import（pocd-browser-bench → pocd-bench）は PoC-to-PoC で product 憲章 §25 の対象外である旨が妥当か。

## 期待する出力

- P1（要修正）/P2（推奨）/P3（任意）で指摘を分類。
- 各指摘に対象ファイル・根拠・修正案。
- 「実装が仕様（function-spec/scenarios/bench-protocol）と一致しているか」を主眼に。
