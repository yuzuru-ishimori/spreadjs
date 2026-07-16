# Codex レビュー依頼: DD-020-1 範囲選択・範囲クリア（子DD全差分・effort high）

## レビュー対象

`git diff 869dc21...HEAD`（DD-020-1 の全差分＝2 コミット: Phase 1 範囲選択 53c31b3・Phase 2 範囲クリア 94ed764）。

## DD の目的とスコープ

矩形範囲選択 UI（ドラッグ／Shift+クリック／Shift+矢印）と範囲クリア（Delete＝blank 敷き詰めの**原子的 SetCells**）を
TypeScript 製共同編集グリッド（Canvas 描画・IME 常駐 textarea）へ追加する。あわせて「選択レンジ読み取り
（selectedRange）」「範囲→原子 SetCells 生成＋上限検査（range-ops）」を内部 API として確立し、後続 DD-020-2
（clipboard copy/cut/paste）・DD-020-3（Undo/Redo）の土台にする。

- 正本 DD: `doc/DD/DD-020-1_範囲選択.md`（受け入れ基準 AC1〜AC8・決定事項・既知の未保証境界）
- E2E シナリオ正本: `doc/DD/DD-020-1/e2e-scenarios.md`（S1〜S9）
- 親 DD: `doc/DD/DD-020_Clipboard.md`（確定済み仕様: 上限 100,000 セル・原子性・OCC・値のみ）

## 設計意図（これに反する実装があれば指摘してほしい）

1. **案X（選択所有者は grid 層）**: 選択レンジの所有者は新設 `packages/grid/src/selection-controller.ts`。
   activeCell の所有は既存 `packages/ime/src/editor-state-machine.ts`（CG-1 常設ガードレール資産）のまま**一切変更しない**
   （遷移追加なし）。Shift+矢印・Escape（レンジ解除）・範囲 Delete は状態機械の**前段**（integration-editor の keydown →
   `decideNavigationIntercept` 純関数）で裁定し、消費したイベントは状態機械へ流さない。
2. **IME 不変条件（I-3/CG-1）**: composition 中（DOM の isComposing / 状態機械の内部 composing のどちらか）と
   非 Navigation 位相では、前段裁定は必ず 'none'（不消費）。textarea の value/selection/DOM 親には触れない。
3. **明示レンジの不変条件**: 「anchor === activeCell（値一致）かつ phase === 'Navigation'」の間だけ存在。
   activeCell 移動・編集開始で `syncWithEditor` が解除（AC4）。
4. **範囲クリアの契約（AC5/AC6）**: 上限判定は**範囲セル数**（矩形面積）で 100,000 超は走査せず実行前拒否
   （公開 code `range-too-large`・operationId 空文字=未 submit）。changes は**非空セルのみ**（表示値=view 基準）・
   value=blank・beforeRevision=committed の `lastChangedRevision`（未書込=0）。submit は既存
   `submitLocalOperation`（楽観適用→OCC→全成功/全失敗=I-5）へ 1 op で流す。
5. **公開面（R7）**: 追加は `GRID_CONFLICT_CODES` の `'range-too-large'` のみ。内部型を公開シグネチャへ漏らさない。
   公開 .d.ts snapshot は更新済み（意図的変更）。

## 既知の設計判断（指摘不要・DD に記録済み）

- own pending を含む範囲のクリアは pending 先行確定で全体 reject になりうる（committed 由来 beforeRevision・
  単一セル Delete と同一規約・安全側）。
- 全空レンジの Delete は消費して no-op（operation 最小化）。
- Ctrl+A 全選択・ドラッグ autoscroll・Presence への選択共有・Undo は対象外（後続/別 DD）。
- E2E S7 の rejected 公開 code は経路により `revalidation-failed` または `cell-conflict` の 2 値（シナリオ正本に記録済み）。

## 重点的に確認してほしいこと（findings 優先）

1. **仕様一致**: AC1〜AC8 と実装の乖離。特に範囲クリアの原子性（部分適用が起きる経路が無いか）・上限検査の抜け道
   （範囲セル数と changes 数の取り違え等）。
2. **回帰**: 既存の単一セル編集・IME 経路（keydown/pointerdown 裁定の追加による挙動変化）。resizeDrag・
   pendingNavigation・Shift+Enter/Tab（逆方向移動）等の既存操作を壊していないか。
3. **バリデーション/防御**: 表示 index → RowId/ColumnId 解決の境界（構造変化後の残存選択・範囲外 index）。
   マルチポインター・pointer capture 喪失時の選択ドラッグ状態。
4. **IME 不変条件**: composition 中に選択・範囲 Delete が textarea / draft / 状態機械へ影響する経路が残っていないか。
5. **テスト不足**: 上記に対する unit / E2E / invariants の欠落。
