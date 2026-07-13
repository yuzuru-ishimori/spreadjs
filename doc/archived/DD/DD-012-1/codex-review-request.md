# Codex レビュー依頼: DD-012-1 入力縦切り（xhigh・1回）

## 背景・目的

DD-012-1「入力縦切り」（親 DD-012・Stage 1 最初の縦切り）。利用者成果=「日本語で文字列/数値/日付をセルへ
連続入力し、Enter/矢印で移動・確定できる」を製品品質にする。本レビューは **IME 状態機械・入力パイプライン・
CellScalar データ形式の実質変更**（roadmap §2.2 L3 の複合）を xhigh で確認する。

**このレビューは ADR-0012（LocalDate）の Accept 判定を兼ねる**（ユーザー確定 2026-07-13＝ChatGPT 外部レビュー不要・
Codex レビューで代替。DD-010/ADR-0011 先例）。LocalDate 表現・hash 決定性・偽陽性防止に致命的問題がなければ Accepted 化する。

## スコープ（本DDで実装した差分）

1. **CellScalar へ `date` 追加**（`{ kind:'date'; value:'YYYY-MM-DD' }`・LocalDate）。波及: `operations.ts`（型）・
   `document.ts` cloneCellScalar・`cell-store.ts` cloneScalar・`hash.ts`（コメントのみ・logic 不変）・
   `document-view.ts` cellScalarToDisplay（表示）。**documentHash の cross-platform 決定性を壊さないこと**が最重要（ADR-0022・DD-006/010）。
2. **入力パーサー（型変換・標準セット）** `packages/core/src/cell-input.ts` `parseCellInput`。受理書式表（下記）を
   実装し、偽陽性（電話番号・型番・郵便番号・実在しない日付が数値/日付化）を防ぐ。commit 経路
   （`commit-bridge.ts draftToScalar`）が委譲する。**composition 中の状態機械・textarea には触れない**（IME 不変維持）。
3. **ローカル Operation + hash 決定性** テスト（`local-operation.test.ts`）: サーバー接続なしで SetCells 適用・
   同一入力列→同一 documentHash・date≠string・JSON 往復一致。
4. **IME 不変条件 6 項目** `tests/invariants/ime/ime.invariant.test.ts`（状態機械を synthetic イベントで駆動）。

## 受理書式表（標準セット・確定＝本レビューの検証対象）

- number: 半角整数 `123 0 -5 007` / 全角 `１２３ －５` / 桁区切り `1,234 1,234,567 -1,234`（3桁群厳密）/ 小数 `1.5 -0.5 1,234.5`
- date（→ LocalDate `YYYY-MM-DD`）: `2026-07-13` / `2026/07/13`（→ `-`）/ `2026-7-3`（→ 0埋め）。実在暦日のみ（閏年考慮）
- string（非該当は入力どおり）: `090-1234-5678`（電話）/ `123-4567`（郵便）/ `ABC-123`（型番）/ `2026-13-01 2026-02-30`（非実在日）/
  `1,23 12,34`（不正桁区切り）/ ` 123 `（前後空白）/ `1e5 +5`（標準セット外）

## 設計意図・制約

- **core ゼロ依存・環境非依存**（ADR-0022）: 時刻/乱数/DOM を使わない。JS `Date` を正規値にしない（LocalDate 文字列）。
- **hash 正準性**: `field(kind)` が 'date' と 'string' を区別するため、同一 `YYYY-MM-DD` テキストでも hash が分岐する。
- **IME 不変条件**（§2.3）: composition 中に textarea.value/selection/instance を壊さない。型変換は確定時のみ（commit 経路）。
- **抽出は本DDでは物理未実施**（packages/ime・selection への move は grid Facade=DD-016・render=DD-012-2 未成立で
  apps→internal の R1 baseline が増えるため見送り。状態機械は apps/playground 現位置のまま不変条件で検証）。

## 重点的に見てほしい観点（findings 優先）

1. **hash 決定性 / 正準性**: date 追加で documentHash が環境依存・非決定になる箇所はないか。date と string の区別は堅牢か。
   clone 分岐（cloneCellScalar / cloneScalar）の網羅漏れ・`as` 濫用はないか。
2. **パーサーの受理/棄却の正しさ**: 受理書式表に対し取りこぼし・偽陽性はないか（特に全角正規化・桁区切り検証・
   暦日検証・電話/郵便/型番の string 保持）。前方影響（DD-013 OCC・DD-014 snapshot）で date が壊す前提はないか。
3. **IME 不変条件テストの妥当性**: 6 項目が実挙動を正しくカバーしているか（順序A/B・先頭欠落0・synthetic と実IMEの区別・
   remote update/rollback 中 draft 不変）。抜け穴（passする偽の不変条件）はないか。
4. **ADR-0012 の妥当性**: LocalDate 選択・受理書式・hash 戦略に設計上の欠陥はないか。Accepted 化して差し支えないか。
5. 回帰・テスト不足: 既存 hash/apply/cell-store/document/commit-bridge テストへの影響、追加すべきテスト。

対象差分は uncommitted（作業ツリー）全体。仕様一致・データ整合・回帰・テスト不足を最優先で指摘してください。
