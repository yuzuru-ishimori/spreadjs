# Codex レビュー依頼: DD-013 共同編集同期・OCC（Harden）

## 背景・目的

DD-013 は、PoC 実証済み資産（`@nanairo-sheet/collab` ClientSession・`@nanairo-sheet/server`
Sequencer/Room・collaboration-server）を**製品品質へ Harden** する縦切りDD。ゼロから作らない。
「同期」のみを扱い、durable/snapshot 復旧（DD-014）・reconnect/catch-up 製品保証（DD-015）・
公開API整形（DD-016）は対象外。

**Phase 0 精査結論**: 受理/reject/duplicate/OCC/rollback-replay の挙動は既存実装＋既存テスト
（sequencer.test S-F/C/D/E/G・session.test S-H/G・room.test・convergence.test・ime.invariant・
integration-scenario E2E）で既に成立・固定済み。よって本DDは **protocol/OCC の挙動を変えず**、
§2.3 共同編集不変条件を `tests/invariants/collab` へ **randomized 収束スイートとして実充足**するのが主眼。
（Codex effort は起票時 xhigh 指定だが、挙動保存 harden に留まると判明したため high へ下げてレビュー依頼。）

## 対象差分

- **本体変更なし**（`packages/server/src/sequencer.ts` 等の production code は無変更）。
- 変更 = `tests/invariants/collab/collab.invariant.test.ts` を「最小 replay 1本」から
  「randomized 収束スイート（3〜5 client × 500op以上 × 複数 seed・duplicate/drop/delay 注入）」へ実充足。
- 添付ドキュメント `doc/DD/DD-013/*`（scenarios / evidence / phase4 手順）。

## 設計意図・制約

- 本番配線（Room＋Sequencer＋ClientSession×N を InProcessHub で結線）へ seed 付きフォールトを注入。
  決定論: 選択=mulberry32(seed)・ID=決定的連番・時刻=手動クロック。Date.now/Math.random 不使用。
- **disconnect は注入しない**（reconnect は DD-015 スコープ。本DDは同期のみ）。
- 検証する §2.3 不変条件: INV-1 全順序→hash一致 / INV-2 rollback-replay収束 /
  INV-3 beforeRevision不一致でサイレント上書きなし / INV-4 reject時draft保持 /
  INV-5 idempotency（二重適用0）/ INV-6 RowId・ColumnId安定（hash独立の構造deep-equal）。

## 重点的に確認してほしい（findings 優先）

1. **テストが「通るように書いた」化していないか**（最重要・DA観点）: randomized スイートが本当に
   欠陥を検知するか。特に INV-3「サイレント上書きなし」の検知が seed 依存で弱くないか。
   （実施済み: sequencer step4 で stale-cell-revision を握りつぶす一時パッチ → deterministic S-C2/G1/G4 即 fail・
   randomized seed=1337 が INV-3 で fail することを確認済み。この二重センサーで十分か、追加すべき assert は。）
2. **不変条件の網羅漏れ**: §2.3 の本DD担当行（INV-1〜6）で、assert が実は成立を保証していない箇所はないか。
   例: INV-6 の構造 deep-equal が hash と独立の導出になっているか（同じ関数から導出して盲点にしていないか）。
3. **収束判定の妥当性**: 静止点（フォールト無効化→tick 前進→全 client hash==server）が「収束を偽装」して
   いないか。quiescenceTicks 上限・maxSteps で収束不成立を見逃す経路はないか。
4. **スコープ境界の正しさ**: disconnect を注入しない判断が「同期のみ」スコープとして妥当か。
   行操作（Insert/Delete）混合が INV-3 の setCells 判定を誤検知/見逃ししないか
   （`rejectedValueNotInCommitted` の hot cell 値ユニーク性の前提は妥当か）。
5. **決定性の担保**: 同一 seed 再実行で serverHash/受理数/reject 数が一致する assert で十分か。

回帰・仕様一致・テスト不足の観点で findings を挙げてほしい。production code は無変更のため、
「harden と言いつつ実は保証できていない不変条件」があれば最優先で指摘してほしい。
</content>
