# DD-016-3: アクティブセル キーボードナビ（focus保持・scroll-follow）

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-14 | 2026-07-14 | 完了 | 発見元=DD-016-2 CG-1 実機テスト中（ユーザー報告）。**「今すぐ軽く修正＝DDは後追い記録」方針（2026-07-14 ユーザー）**。既存バグ（DD-016-1 リグレッションではない）＋未実装機能を修正。実機ドライブ（Playwright）＋ユーザー実機確認で green |

```text
Risk Class: B
Risk Triggers: 利用者入力経路（クリック focus・キーボードナビ）の挙動修正／grid Facade 内部の pointer/keydown 配線変更（IME 経路と隣接）
Human Spec Gate: 不要（期待挙動は Excel 標準＝明確・ユーザーが症状と期待を明示）
Codex: 不要（挙動修正・変更3点が小さく局所・実機で end-to-end 検証済み）
Manual Gate: 不要（ただしユーザー実機確認済み＝「十字キーでのアクティブセルの動きとスクロールが期待どおり」2026-07-14）
Evidence Level: standard（実機ドライブの before/after ログを DD 本文へ記録）
```

> アプローチ: バグ修正＋小機能追加（E2E 駆動で原因特定→最小修正→実機検証）。DD-016-2 の consumer 実証中に露見したが、本件は grid コアのナビ挙動であり consumer/Facade 契約（公開 API）は不変。別DDとして分離。

## 目的

grid のアクティブセルを**キーボード十字キーで移動**でき、移動に伴い**アクティブセルが常に可視域に入るよう scroll-follow**（Excel 標準: セルが動き、ビューポート端に達したらスクロールし始める）させる。

## 背景・課題

DD-016-2 の CG-1 実機テスト中、ユーザーが「下キーを押すと**スクロールはするがカレントセルが動かない**（Excel と異なる）」と報告。実機ドライブ（Playwright）で2つの独立した欠陥を特定:

- **① focus 保持バグ（既存・DD-016-1 前から）**: セルをクリックしても常駐 textarea がフォーカスを保持せず `document.activeElement` が **BODY** になる。scroller は非フォーカサブルなため mousedown 既定挙動が focus を body へ奪い、`pointerdownCell` の `textarea.focus()` を打ち消していた。結果、キーボードイベントが状態機械に届かず、ArrowDown が scroller のネイティブスクロールへ流れていた。**E2E が `ta.focus()` を明示的に呼ぶため（`apps/playground/e2e/integration-helpers.ts:153`）ずっと見逃されていた**。8コミット前の旧 `main.ts` も同構造＝リグレッションではなく既存欠陥。
- **② scroll-follow 未実装（機能欠落）**: アクティブセル移動に追従して `scroller.scrollTop/Left` を調整する処理がコードベースに皆無（`scroller.scrollTop=` は構造Op補正の1箇所のみ）。移動でセルがビューポート外に出ても追従スクロールが無かった。

状態機械（`packages/ime/editor-state-machine.ts`）の Navigation 分岐は ArrowDown を正しく Move に変換しており、ナビ論理自体は健全（focus さえ届けば動く）。

## 検討内容

- **① の修正方式**: (a) scroller の `pointerdown` で `event.preventDefault()`（cell ヒット時のみ）＝mousedown 既定の focus 奪取を止め、明示 `textarea.focus()` を活かす（採用）／(b) scroller に `tabindex` を付けて focusable 化（キーボードスクロールと競合・却下）。cell ヒット時のみ preventDefault することで scrollbar ドラッグ（cell 非ヒット）への影響を避ける。
- **②の実装方式**: `ViewportTransform.cellRect(row,col)` で現在スクロールにおけるセル矩形を得て、body 領域（`HEADER + frozen` 〜 viewport 端）からのはみ出し量だけ最小スクロールする `ensureActiveCellVisible()`。可視セルなら no-op（クリックで勝手にスクロールしない）。固定行/列のセルはスクロール非依存ゆえ対象外。
- **focus 既定スクロールとの競合回避**: `textarea.focus({ preventScroll: true })` で、focus 既定の scrollIntoView が scroll-follow と競合して画面が跳ねるのを防ぐ。

## 決定事項

- 公開 API（`GRID_API_VERSION` 0.1.0-experimental）は不変。修正は grid Facade 内部（`mount-controller`・`integration-editor`）に限定。
- 修正3点:
  1. `packages/grid/src/mount-controller.ts`: scroller `pointerdown` の cell ヒット分岐で `event.preventDefault()`（focus 保持）。
  2. `packages/grid/src/mount-controller.ts`: `ensureActiveCellVisible()` 追加＋`onChange` から呼ぶ（scroll-follow）。
  3. `packages/grid/src/integration-editor.ts`: `textarea.focus({ preventScroll: true })`（focus 既定スクロール抑止・pointerdownCell と port.focus 両方）。

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | セルを**実クリック**すると常駐 textarea が focus を保持（`document.activeElement` = grid textarea） | 実機ドライブ（Playwright 実クリック）: after real click `activeElement === TEXTAREA(grid)` ✓ |
| 2 | textarea focus 中に ArrowDown/Up で**アクティブセルが1セルずつ移動**し、ネイティブスクロールを誘発しない（可視域内はスクロール0） | 実機ドライブ: focus 済で ArrowDown (2,0)→(3,0)・scrollTop 不変 ✓ / 実 ArrowUp (35→34)・focus保持・scrollTop不変 ✓ |
| 3 | アクティブセルがビューポート端に達したら**追従スクロール**（Excel 標準） | 実機ドライブ: 22×ArrowDown で row14→26 は scrollTop 0、row29 で scrollTop 開始、row32-35 で 95→117→139→161（+22/row）✓ |
| 4 | 回帰なし: `typecheck`／`lint`（boundary new=0）／`build`／`test` green | 🔬 一括（test は server-hono contract tsc-emit の既知 flake 除き 718→単独 green） |

## タスク一覧

### Phase 0: 事前精査
- [x] 📋 原因特定（実機ドライブで focus=BODY・scroll-follow 皆無を確認）
- [x] 📐 実装前詳細化トリガー判定: **不要**（変更3点・局所・公開I/F不変）
- [x] 🧑‍⚖️ Codexレビュー要否: **不要**（小さく局所・end-to-end 実機検証で代替）
- [x] 😈 Devil's Advocate（下記 DA記録参照）

### Phase 1: 修正・検証
- [x] `mount-controller.ts` scroller pointerdown に cell ヒット時 `preventDefault`（focus 保持）
- [x] `mount-controller.ts` `ensureActiveCellVisible()` 追加＋`onChange` 配線（scroll-follow）
- [x] `integration-editor.ts` `textarea.focus({ preventScroll: true })`（focus 既定スクロール抑止）
- [x] 🔬 機械検証: `typecheck` green・`lint`（boundary new=0）green・`build` green・実機ドライブ green（AC1-3）・ユーザー実機確認 green
- [x] 😈 DA批判レビュー（下記）

## ログ

### 2026-07-14
- DD作成（発見元=DD-016-2 CG-1 実機テスト中のユーザー報告「下キーでスクロールするがカレントセルが動かない」）。ユーザー選択「今すぐ軽く修正＝DDは後追い記録」。
- 原因特定（実機 Playwright ドライブ）: ①クリック後 `activeElement`=BODY（textarea が focus を保持しない・非フォーカサブル scroller の mousedown 既定が focus 奪取／`pointerdownCell` は `textarea.focus()` を呼ぶが打ち消される）。②scroll-follow 皆無（`scroller.scrollTop=` は構造Op補正のみ）。状態機械の ArrowDown→Move は健全（focus さえ届けば動く）。旧 main.ts も同構造＝**DD-016-1 リグレッションではない既存欠陥**。E2E が `ta.focus()` 明示呼びで見逃していた。
- 修正3点を実装（決定事項参照）→ 実機ドライブで before/after 検証: 実クリックで textarea focus 保持・ArrowDown/Up でセル移動・端で追従スクロール（row29 で scrollTop 開始、+22/row）。ユーザー実機確認「十字キーでのアクティブセルの動きとスクロールが期待どおり」。
- 回帰: typecheck/lint(boundary new=0)/build green。test は server-hono contract の tsc-emit が並列ロード flake（`facade-surface.test.ts` 単独で 4/4 green＝本変更起因でない・DD-016-2 既記録）。**完了**。

---

## DA批判レビュー記録

### Phase 1 DA批判レビュー

**DA観点:** focus 保持・scroll-follow の修正が別のUX/入力経路を壊さないか？

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | `pointerdown` 全体で preventDefault すると**scrollbar ドラッグ**が壊れうる（scrollbar クリックは scroller 上の pointerdown） | 中 | scrollbar つまみを drag → スクロールできない、になりうる | 修正が別の入力経路を壊さないか | ✅回避: preventDefault は **cell ヒット分岐のみ**（`hit.area==='cell'`）。header/範囲外/scrollbar 相当は従来どおり default |
| 2 | scroll-follow が**クリック時にも勝手にスクロール**して見た目が跳ねる | 中 | 可視セルをクリック → 画面がスクロールしてしまう、になりうる | 過剰なスクロール副作用 | ✅回避: `ensureActiveCellVisible` は body 領域からのはみ出し時のみスクロール（可視セルは no-op）。加えて `focus({preventScroll:true})` で focus 既定スクロールも抑止。実機で click 時 scrollTop 不変を確認 |
| 3 | IME 変換中（Composing）に矢印が来ても scroll-follow が誤発火しないか | 低 | 変換中に矢印 → 状態機械は SuppressKey（Move を出さない）→ onChange の activeCell 不変 | IME 経路との干渉 | ❌不要: 変換中は状態機械が矢印を SuppressKey にし activeCell を動かさない（`editor-state-machine.ts:230`）。scroll-follow は activeCell 基準ゆえ発火しない |
| 4 | 固定行/列（frozen）セルで scroll-follow が負方向へ暴走しないか | 低 | activeCell が row0/col0（frozen）のとき | 境界条件 | ✅回避: `active.row>=frozenRowCount`／`active.col>=frozenColCount` のガードで frozen セルは対象外 |
