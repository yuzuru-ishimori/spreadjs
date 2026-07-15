# DD-012-3: F2 再編集×キャレット位置で IME 確定文字が末尾へ送られるバグ修正

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-15 | 2026-07-15 | 確認待ち | 修正実装・回帰テスト2本（S-C6/S-C7）・全746 test＋invariants＋E2E 8本 green・Codex high **findings 0**。残=AC4 実IME実機確認（ユーザーの再現手順で再検証依頼） |

```text
Risk Class: A
Risk Triggers: IME状態機械（editor-state-machine）を変更
Human Spec Gate: skipped（ユーザー報告バグの再現修正＝DD-016-3 先例「今すぐ軽く修正・DDは後追い記録」2026-07-14 方針）
Codex: high（状態機械の実質変更だが単一関心の guard 追加＝xhigh 非該当）
Manual Gate: あり（実IME確定の実機再確認はユーザー依頼＝報告者の再現手順で確認）
External Review: なし
Evidence Level: standard（fault の再現テスト・event trace＝synthetic 列を test 本文に保存）
```

> アプローチ: バグ修正（再現→修正→Before/After検証）
> 親: DD-012（単一利用者IME縦切り）。発見元=DD-017-2 showcase 実機確認中のユーザー報告（2026-07-15）

## 目的

F2（既存値編集）でキャレットを先頭・中間へ移動して IME 変換・確定すると、確定文字が**末尾へ送られる**バグを修正する。
再現: 「柿食えば」→ F2 → キャレット先頭 → 「いいい」変換確定 → セルを外す → **「柿食えばいいい」**（期待は「いいい柿食えば」）。

## 背景・課題（真因）

- `editor-state-machine.ts` の `handleCompositionEnd` が draft を **`compositionBase + data`（キャレット末尾前提の近似）で暫定確定**していた（「input が来ない環境向け」のフォールバック）。
- 変換中の `input`（isComposing=true）は**実 textarea 値**（キャレット位置込みの正しい文字列）を draft へ反映済みなのに、compositionend がそれを近似値で上書きする。
- Tier-1 実測（順序B・Chromium 150）では **compositionend の後に確定 input が来ない**ため、上書きされた近似値がそのまま Commit される。追記編集（キャレット末尾）では base+data と実値が一致するため DD-012 の実機ゲートでは顕在化しなかった。

## 決定事項

- **D1 修正方式**: composition 中に実値 input を受けたか（`sawCompositionInput`）を追跡し、受けていれば compositionend の base+data 上書きをスキップ（draft=実値を保持）。input が一切来ない synthetic/特殊環境では従来どおり暫定確定（後退なし・S-C7 で固定）。リセットは compositionstart／compositionend（確定・Escape 取消とも）／enterNavigation。
- **D2 スコープ外**: `handleCompositionUpdate` の base+data 近似は変換中の一時値（直後の input が上書き・commit 経路に乗らない）ため据え置き。順序B での blur 保留（EditingAwaitFinalInput＝最終 input 待ち）は既存の Codex 済み設計のため変更しない。

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | F2→キャレット先頭→IME確定（順序B・変換中 input あり）→ commit 値が実 textarea 値（挿入位置保持） | 🔬 S-C6（editor-state-machine.test.ts） |
| 2 | 変換中 input が来ない環境では従来挙動（base+data 暫定確定）を維持＝後退なし | 🔬 S-C7 |
| 3 | 既存の IME 不変条件・全テスト・実ブラウザーE2E に回帰なし | 🔬 `npm test` 746・`npm run test:invariants`・`npm run test:e2e` 8本 |
| 4 | 実IMEでの再現手順（柿食えば→F2→先頭にいいい→確定→セル外）が期待どおり | 実機確認（ユーザー・Manual Gate） |

## タスク一覧

### Phase 1: 再現→修正→検証（バグ修正）
- [x] 再現テスト S-C6 追加（`packages/ime/src/editor-state-machine.test.ts`・synthetic で順序B trace 再現）→ **red 確認**（commit 値が「柿食えばいいい」）
- [x] `packages/ime/src/editor-state-machine.ts`: `sawCompositionInput` 追加・`handleCompositionEnd` の上書きを guard（D1）
- [x] 現行挙動維持テスト S-C7 追加（フォールバック経路の後退なし）
- [x] 🔬 機械検証: ime 91 test・全体 746/746・invariants・typecheck・lint(boundary)・E2E 8/8 → **全 green**
- [x] 😈 DA批判レビュー（下記記録）
- [x] Codexレビュー（high・状態機械変更のため必須）→ `DD-012-3/codex-review-result.md`
- [ ] 実機確認（ユーザー・AC4）: 報告の再現手順で「いいい柿食えば」になること

## ログ

### 2026-07-15
- ユーザー報告（DD-017-2 実機確認中）: 柿食えば→F2→先頭に「いいい」→セル外で「柿食えばいいい」
- 真因特定: compositionend の base+data 暫定確定（キャレット末尾前提）が、変換中 input の実値 draft を上書き。順序B では後続 input が来ず近似値が commit される
- S-C6 red（value: '柿食えばいいい'）→ D1 修正 → S-C6/S-C7 green・全746・invariants・E2E 8本 green
- DD-016-3 先例（今すぐ修正・後追い記録）で本DDを後追い起票。Codex high 実行
- **Codex high 結果: findings 0**（「flag は全遷移でリセット・順序B で実 input を正として保持・no-input フォールバック維持」）→ 対応事項なし
- ステータス 進行中→確認待ち（残タスクは AC4 実IME実機確認のみ＝ユーザーへ依頼）。修正はコミット

---

## DA批判レビュー記録

### Phase 1 DA批判レビュー

**DA観点:** guard フラグの導入で「今まで動いていた確定経路」を壊す組み合わせはないか？

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | Escape 取消経路でフラグが残ると次の composition の確定を誤って skip する | 高 | F2→変換→input→Escape 取消→再変換（input なし synthetic）→確定 | 状態リーク | ✅Escape 経路・compositionstart・enterNavigation・確定経路すべてでリセット（4箇所） |
| 2 | 順序A（compositionend 後に確定 input が来る環境）で挙動が変わらないか | 中 | S-D 系既存テスト | 順序A/B 両立（不変条件） | ✅順序A では後続 input が draft を再上書き（従来どおり）。guard は compositionend 時点の値の質を上げるだけで、後続 input の優先は不変。既存 54+2 test green |
| 3 | compositionupdate の近似値が commit される経路が残っていないか | 中 | 変換中に commit する経路の探索 | 近似値の漏れ | ✅変換中（composing）は Enter/Tab/矢印を Suppress・pointerdown は pendingNavigation 保持＝commit は非 composing のみ。commit 時 draft は input 実値 or compositionend 確定値 |
