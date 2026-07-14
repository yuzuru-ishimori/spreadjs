# DD-018 Codex 証拠監査 依頼書（effort high）

## これは何か

DD-018「Stage 1 移行判定」は**コード変更ゼロの判定DD**です。差分レビューではなく、**判定チェックリスト × 証拠参照の突合監査**を依頼します（DD-007 Phase 2 証拠監査の先例）。

Stage 1 社内SDK Alpha への移行条件 **S1-1〜S1-6**（roadmap §0）・解除ゲート **CG-1〜CG-6**（cg-ledger）・**既知制約**（roadmap §8＋各DD）を既存アーカイブ証拠で合否判定し、総合判定=**Stage 1 移行 可（Alpha 宣言可）** としました。この判定が**甘くないか・証拠に裏付けられているか**を監査してください。

## 監査対象ファイル

- 判定チェックリスト（主対象）: `doc/DD/DD-018/stage1-gate-checklist.md`
- 総合判定・DA記録: `doc/DD/DD-018_Stage1移行判定.md`（決定事項・ログ・DA批判レビュー記録）
- 当日回帰スイートログ: `doc/DD/DD-018/regression-run-20260715.txt`
- 条件の正本: `doc/plan/phase1-dd-roadmap.md`（§0 S1-1〜6・CG-1〜6／§6 製品境界／§8 既知制約）・`doc/plan/cg-ledger.md`
- S1-6 再解釈: `doc/adr/0015-stage1-api-maturity-and-tier1-support.md`（§「S1-6 再解釈」）
- Stage 2 バックログ: `doc/plan/stage2-backlog.md`
- 証拠本体（各アーカイブDD）: `doc/archived/DD/DD-009〜017/`（チェックリストの証拠所在列に列挙）

## 判定の前提（ユーザー承認済み・2026-07-15）

- **A**: 総合判定の確定はオーケストレータ（Claude）へ委任（証拠に基づき本フローで確定・事後報告）。
- **B**: S1-6 の「private registry」→「再現可能な private 配布経路」（ADR-0015・DD-017 決定事項A）を合格基準とする（追認）。
- **C**: CG-4（macOS/Firefox/モバイル 対象外明示）・CG-6（redraw ≤12ms 上限明示）の境界化は合格扱い（roadmap §0 が境界化を許容）。
- **D/E**: Stage 2 バックログ新設／不合格時は子DD DD-018-1 起票（不合格0なら不要）。

## 重点的に監査してほしい観点（findings 優先で）

1. **証拠と条件の不一致**: 各行の「合否」が、証拠の所在（実在するファイル）と roadmap §0/cg-ledger の**条件原文**を実際に満たしているか。「証拠がある」だけで「条件を満たす」と誤認していないか。特に:
   - S1-1: boundary check `baselined=10 new=0` が本当に「`apps/playground` に採用資産が残っていない」ことを示すか。残10件が全て PoC-D throwaway である根拠は妥当か。
   - S1-3: 独立 consumer-app（monorepo外 pack closure install）が §7 の「fixtureだけでは不合格／workspace link・source path 直接参照・Internal 直接import は不合格」を回避しているか。
   - S1-6: 再解釈（registry→再現可能な配布経路）が**条件緩和**になっていないか。実質3要件（再現build・チャネル明示・成果物のみ統合）の証拠は十分か。
2. **境界化の甘さ**: CG-4/CG-6 の境界化が roadmap §0 の許容条件を満たすか。CG-6 の redraw over-budget を「計測環境アーティファクト」として合格にした論理は妥当か（render 無変更＝回帰不能の主張の裏付け）。
3. **既知制約の判定漏れ・誤分類**: C節（K1〜K9）の三値判定（解消済/延期/製品境界化）に、実装を要するのに「延期」で流した項目がないか。延期項目が Stage 2 バックログと対応しているか。
4. **証拠欠落**: チェックリストが参照する証拠パスに、実在しない or 主張を裏付けない参照がないか。
5. **総合判定の妥当性**: 上記を踏まえ「Stage 1 移行 可」の結論が証拠に対して過大でないか。不合格にすべき項目を見落としていないか。

## 制約

- 本DDはコード変更禁止。findings で「実装が必要」と判断される項目があれば、それは**不合格＝子DD DD-018-1 へ切り出す対象**として指摘してください（本DDで実装はしない）。
- 軽微な機械再実行（lint/boundary/test の再確認）は可。実装変更は不可。
