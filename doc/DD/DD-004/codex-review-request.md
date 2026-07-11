# Codexレビュー依頼書 — DD-004（PoC-B Canvas 仮想スクロール）

別モデル（Codex）視点で、DD-004 の実装差分を **findings 優先**でレビューしてほしい。仕様一致・入力検証・回帰・
テスト不足・性能上の落とし穴を重点に、重要度（Critical/Warning/Info）と根拠（ファイル・行・再現条件）を添えて挙げてほしい。

## DD の目的・スコープ

- 目的: 「50,000行×200列の Canvas グリッドが実用速度で描画・スクロールできるか」を検証する PoC-B（計画書 §18.2）。
  fps・メモリの実測で合格判定し、ADR-011（行スロット＋チャンク化セルストア）の判断材料を作る。
- 正典: `doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md` の §12（Canvas描画）・§13（仮想スクロール）・
  §18.2（実装範囲・合格条件）・§21（性能目標）。DD 本体: `doc/DD/DD-004_PoC-BCanvas仮想スクロール.md`。
- 受け入れ基準（§18.2）: ①通常スクロールの 95% フレーム<33ms ②停止中再描画 8〜12ms ③pointer→選択枠<50ms
  ④10分連続でメモリ単調増加しない ⑤50,000行末尾で scroll anchor 維持。加えて可変行高列幅・固定行列4象限・
  選択ドラッグ・Presence 20人・高DPI が動作。

## 対象差分（`--uncommitted`）

レビュー対象は **本DDの新規差分のみ**:
- `apps/playground/src/pocb/*.ts`（axis, viewport, dpi, prng, data-gen, chunk-store, render-scheduler,
  scroll-anchor, presence-sim, metrics, harness, text-cache, selection, base-layer, overlay-layer, main と各 *.test.ts）
- `apps/playground/poc-b.html`、`apps/playground/vite.config.ts`
- `doc/DD/DD-004/*`、`doc/adr/0011-row-slot-chunked-cell-store.md`、`doc/DOC-MAP.md`

**対象外**（レビューしない）: DD-002 の `apps/playground/src/{grid,ime,sim,ui}/`・`index.html`・`src/main.ts`、
DD-003 の `packages/**`・`apps/collaboration-server/**`。これらは凍結制約で本DDでは一切変更していない。

## 設計意図

- **純粋コアと Canvas アダプタの分離**: 座標・データ・判定ロジック（axis/viewport/scroll-anchor/selection/dpi/
  text-cache/prng/data-gen/chunk-store/render-scheduler/presence-sim/metrics）は DOM 非依存で vitest 検証。
  Canvas/DOM 依存（base-layer/overlay-layer/harness/main）は描画アダプタとして隔離し、vitest 対象外。
- **座標**: Axis は「順序配列＋ID→index Map＋標準サイズ＋疎override＋prefix sum キャッシュ＋二分探索」（§13.2・要確認3）。
  ViewportTransform が 4 象限 pane の可視範囲・セル矩形・ヒットテストを一元化（§12.2/§12.6）。
- **描画振り分け**: RenderScheduler の dirty flag で、選択・Presence 変更時に base（全セル）を再描画しない（§12.1/§12.3）。
- **可視範囲クエリ**: chunk-store は O(可視セル数)（範囲外を走査しない）。
- **計測**: metrics.ts（純粋）＋harness.ts（ドライバー）。合否は `evaluateAcceptance`。実ブラウザーの fps/メモリ実測は
  主セッションが headed で採取（本実装セッションは仕組みまで）。

## 制約（レビュー時に確認してほしい点）

1. **凍結**: `src/grid|ime|sim|ui`・`index.html`・`src/main.ts` を変更していないか（差分に混入していないか）。
2. **新規 npm 依存ゼロ**（package.json / lock に追加が無いか）。
3. **コーディング規約**（`doc/templates/coding-standards.md`）: `any`／`as unknown as`／非nullアサーション（`!`）／
   `console.log`／スタブ・TODO 残置が無いか（P01/P19/P03/P21/P20）。
4. **座標の正しさ**: 固定行列4象限の重なり・スクロール反映・ヒットテスト、DPR snap（非整数 DPR 含む）に破綻がないか。
5. **性能主張の妥当性**: 可視範囲クエリが本当に O(可視セル数)か、prefix sum 再構築の頻度・Float64Array 前提に穴がないか。
6. **anchor 補正**: 行高変更・挿入・削除（anchor 行消失フォールバック）で画面が跳ばない計算が正しいか。
7. **テスト不足**: 受け入れ基準に対応する判定ロジック・境界（先頭/末尾・空・オーバーフロー）のテスト漏れ。
8. **index キー簡略化**（chunk-store）が ADR-011/report に明記され、誤解を生まないか。
