# Codex レビュー依頼: DD-012-2 性能縦切り（Phase 0/1 判断＋Phase 2/3 計測足場）

## DD 目的・スコープ

DD-012-2 は親アンブレラ DD-012 の子DD（Risk A・CG-6 主担当）。利用者成果=「5万行×200列で scroll/selection が快適（回帰予算内）」を担保する。本セッションの実装範囲は **Phase 0〜1＋Phase 2/3 の足場まで**（headed 実機計測の手前で停止）。headed 実測（5万行 scroll/selection・CG-6 精密メモリ）は人手/実ブラウザーが必要で自動化不可のため、**計測ハーネス・予算表・判定器・手順書**を用意し、人間が実ブラウザーで走らせれば数値が出て判定が確定する状態にした。

## 対象差分（uncommitted）

- `scripts/cg-perf/perf-budget.json` — 性能回帰予算の正典（SSOT）。合格ライン＝DD-004『実機確認run』実測（scroll p95 16.8 / 選択 16.9 / 再描画 0.33ms / メモリ 300MB）＋計測条件＋ノイズマージン。
- `scripts/cg-perf/perf-judge-core.mjs` — headed 実測レポートの判定コア（純関数）。3 値判定（pass / over-budget=回帰予算超だが §18.2 機能上限内 / fail=機能上限超）＋負荷条件（可視セル帯）ゲート。`judgeMemoryReport`（ピーク ≤300MB AND リーク傾向）。
- `scripts/cg-perf/judge-perf-report.mjs` — 上記の CLI ラッパー（exit 0/1）。
- `scripts/cg-perf/fixtures/*.json` — 判定器の自己検証 fixtures（pass/over-budget/fail/condition-unmet）。
- `tests/invariants/perf/perf-judge.test.ts` — 判定器の機械検証＋予算ピン tripwire（予算を緩める編集を検出）。
- `tests/invariants/perf/perf.invariant.test.ts` — ヘッダ更新（実予算の所在・常設化の説明）。
- `doc/DD/DD-012-2/{perf-realmachine-procedure,cg6-memory-procedure,evidence}.md` — headed 手順・CG-6 封鎖回避・full 証跡。
- `doc/DD/DD-012-2_性能縦切り.md` — AC 調整（render 抽出 DD-016 委譲）・予算表・タスク更新・ログ。

## 設計意図・制約（レビュー時の前提）

- **render 抽出は DD-016 委譲（要判断）**: 今 `packages/render/` へ抽出すると apps(integration)→render の R1 が正味 +3 で baseline 肥大（AC5 逆行）、かつ render→chunk-store/presence-sim/selection（未 package 化）が R4 になり grid Facade＋selection package 化（DD-016）なしにクリーン抽出不可。DD-012-1 と一貫。**規約の新規発明（部分 Facade・DAG 拡張）はしない**。
- 予算は DD-004 実測の予算化（ユーザー確定）。**予算を緩める＝spec 変更＝再ゲート**。
- 計測ハーネスは pocb（`apps/playground/src/pocb/{harness,metrics,main}.ts`・DD-004 資産）を流用。判定器は package 外 harness（`scripts/cg-perf/`）。

## 重点的に見てほしい観点（findings 優先）

1. **仕様一致**: 判定器の予算値・条件が DD 本文の予算表／`perf-budget.json`／AC2・AC4 と一致しているか。合格ラインを取り違えていないか。
2. **判定ロジックの妥当性**: 3 値判定（pass/over-budget/fail）・負荷条件ゲート・メモリの AND 判定（ピーク AND リーク傾向）に、回帰を素通しにする穴（緩すぎる margin・n/a の握りつぶし・標本 0 の pass 化）がないか。
3. **バリデーション/回帰**: fixtures が判定分岐を網羅しているか。予算ピン tripwire が「緩める編集」を確実に捕えるか。
4. **render 抽出 DD-016 委譲判断の妥当性**: baseline 増減見込み（+5/−2）と R4 根拠が正しいか。委譲が過剰/過小でないか。
5. **テスト不足**: headed 実測前でも機械検証すべき箇所の取りこぼし。手順書で人間が再現できない曖昧さ。
