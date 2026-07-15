# Codex レビュー依頼書 — DD-012-3: F2 再編集×キャレット位置 IME 確定バグ修正

## 背景

ユーザー報告バグ（2026-07-15・DD-017-2 showcase 実機確認中）: 「柿食えば」→ F2 → キャレット先頭 → 「いいい」を IME 変換確定 → セルを外すと「柿食えばいいい」になる（期待は「いいい柿食えば」）。

真因: `packages/ime/src/editor-state-machine.ts` `handleCompositionEnd` が draft を `compositionBase + data`（**キャレット末尾前提の近似**）で暫定確定し、変換中 `input`（isComposing=true・実 textarea 値）が反映済みの正しい draft を上書きする。Tier-1 実測（順序B・Chromium 150）では compositionend 後に確定 input が来ないため、近似値がそのまま Commit される。

## 対象差分（uncommitted）

- `packages/ime/src/editor-state-machine.ts`: `sawCompositionInput` フラグ追加。変換中 input 受領で true。`handleCompositionEnd`（確定経路）で true なら base+data 上書きを skip・false なら従来どおり暫定確定。リセットは compositionstart／確定経路／Escape 取消経路／enterNavigation の4箇所
- `packages/ime/src/editor-state-machine.test.ts`: S-C6（再現・順序B synthetic trace・red→green）・S-C7（input が来ない環境のフォールバック維持＝後退なし）
- `doc/DD/DD-012-3*`: 記録（レビュー対象外）

## 制約・設計意図

- **IME 状態機械は Risk Class A**。変更は「compositionend 時の draft の質を上げる guard」のみに限定。順序A（compositionend 後に input が来る環境）では後続 input が draft を再上書きする従来優先順位を変えない
- `handleCompositionUpdate` の base+data 近似は据え置き（変換中の一時値・直後の input が上書き・commit 経路に乗らない）
- 順序B の blur 保留（EditingAwaitFinalInput＝最終 input 待ち・blurPendingCommit）は既存 Codex 済み設計のため不変
- 検証済み: ime 91 test・全体 746/746・invariants suite・typecheck/lint(boundary)・playground E2E 8/8 green

## 重点確認観点（findings 優先で）

1. **フラグのリセット漏れ**: sawCompositionInput が残留して後続 composition の確定を誤 skip する遷移列はないか（Escape 取消・pendingNavigation・blur・remoteUpdate・連続 composition の組み合わせ）
2. **IME 不変条件との整合**: I-1（値の正は input 後）・I-3（composition 中 textarea 不変）・順序A/B 両対応・S-D 系（確定 Enter 抑止）への影響
3. **guard の逆方向リスク**: 変換中 input はあったが「最後の input 以後に composition 内容が変わる」ケース（候補ウィンドウ操作等）で stale draft を確定しないか（Chromium は compositionupdate 後に必ず input が続く前提の妥当性）
4. **テストの実効性**: S-C6/S-C7 が回帰を実際に検出できるか・synthetic trace が実イベント順（順序B）を正しく模しているか
