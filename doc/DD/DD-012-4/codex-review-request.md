# Codex レビュー依頼 — DD-012-4 列幅・行高リサイズ（effort: high）

## 目的・スコープ

Excel 風にヘッダー境界（列ヘッダー右端／行ヘッダー下端）をドラッグして列幅・行高を変更する機能を実装した。
設定は **view-local**（他ユーザーへ即時同期しない・protocol/snapshot/Operation 無改変）。公開 API は Experimental 0.x への追加のみ。

正典: `doc/DD/DD-012-4_列幅行高リサイズ.md`（決定事項 D1〜D6・受け入れ基準 AC1〜8）。

## 重点的に見てほしい観点（findings 優先）

1. **仕様一致**: D2 公開 API（`GridMountOptions.columnWidths/rowHeights`・`GridEvent 'layout'`＝pointerup 発火・override のみ）、
   D3 操作仕様（±4px 掴み代・col-resize/row-resize・最小 列20/行16・最大2000クランプ）に実装が一致しているか。
2. **IME 不変（D5・I-3）**: リサイズの pointer イベントが編集状態機械（ime-editing-session）へ流れていないか。
   composition 中に textarea の value/selection/DOM 親へ触れていないか（`place()`＝配置のみが許容）。
3. **override の永続性（AC4）**: 構造Op（行挿入/削除）で Axis を作り直しても列幅・行高 override が失われないか。
   `DocumentView.flush()` の再構築経路と `colWidthOverrides`/`rowHeightOverrides` の一貫性。
4. **pointer capture / ドラッグ状態機械のリーク**: `setPointerCapture`/`releasePointerCapture`・pointerup/pointercancel/
   lostpointercapture の後始末、`layout` イベントの二重発火や取りこぼし、drag 中の scroll 併発・DPR・frozen 列/行境界の扱い。
5. **バリデーション/クランプ**: 負値・0・巨大値・空 Axis（行0件）での getId 例外回避、境界共有（列 c 右端＝列 c+1 左端）の解決。
6. **境界（R7）**: 公開 Facade（`packages/grid/src/index.ts`）に内部型を漏らしていないか（キーは string で受けているか）。
7. **回帰/テスト不足**: 既存のスクロール追従・編集追従・選択枠との座標整合、テストで固定できていない不変。

## 主な変更ファイル

- `packages/grid/src/resize-interaction.ts`（新規・純粋: hit 判定/クランプ/サイズ算出）＋ `resize-interaction.test.ts`
- `packages/grid/src/document-view.ts`（override 保持・初期注入・構造再構築維持・record 出力）＋ `document-view.test.ts`
- `packages/grid/src/mount-controller.ts`（pointer 配線・drag 状態機械・layout emit・debug API）
- `packages/grid/src/session-sync.ts`・`index.ts`・`internal.ts`（API 追加・配線）
- consumer: `apps/playground/src/integration/main.ts`・`apps/showcase/src/demo/main.ts`（localStorage 保存/復元）
- `apps/playground/e2e/resize.spec.ts`（実ドラッグ E2E）・showcase features.json/scenarios.ts・CHANGELOG.md

## 制約

- protocol・永続化・IME 状態機械は無改変。コミットはしない。
- 検証は全 green 済み: typecheck / lint（boundary new=0）/ test（763）/ test:invariants（40）/ e2e（playground 11・showcase 3）。
