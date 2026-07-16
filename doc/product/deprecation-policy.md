# Deprecation Policy（非推奨・破壊的変更の運用規定）

> **正本**: 公開 Facade API の非推奨期間・破壊的変更の運用を成熟度3層で定める常設規定。
> 憲章 §18.3「非推奨APIには代替手段と移行期間を示す」の具体化＝**P-10（非推奨期間・期限 Stage 2 前）の確定**
> （DD-028・ユーザー確定 2026-07-16・`doc/decisions.md` D-006）。
>
> **対象範囲**: Facade package（`@nanairo-sheet/grid`・`@nanairo-sheet/server-hono`・`@nanairo-sheet/react`、
> および将来の公開 Facade）の公開面。内部 package は対象外（同一 monorepo 内で同期更新する＝憲章 §18.1）。
> 「統合済み consumer」= S2-1 水準の統合実証を経て SDK を実利用している社内アプリを指す。

## 1. Experimental `0.x`（現行・Stage 1〜Beta 宣言まで）

破壊的変更を**許す**。ただし無断では壊さない（サイレント破壊の禁止）:

- **CHANGELOG 必記**: 破壊的変更は `CHANGELOG.md` の破壊的変更節に必ず記録する。
- **型スナップショット更新の同伴**: `tests/contract/facade-surface.test.ts` の snapshot 更新（`-u`）を同じ変更に含める
  （更新しないと CI が fail する＝記録漏れの機械的防止）。
- **migration guide 要否判定**: `doc/migration/README.md` §1 の条件で判定し、必須なら dry-run 検証付きガイドを書く。
- **非推奨を経る場合**（削除・置換の予告をするとき）: `@deprecated` JSDoc＋代替手段の明示＋**最低 1 minor リリースの共存**
  （非推奨にした minor の次の minor までは削除しない）。

## 2. Beta（Stage 2 宣言後）

公開 Facade API の**削除・非互換変更**は、非推奨マークを経て以下の**全充足後**にのみ行う:

1. **最低 1 minor リリース**の共存（非推奨マーク付きで配布された minor が 1 つ以上ある）
2. **最低 30 日**の経過（非推奨を CHANGELOG で告知した日から）
3. **統合済み全 consumer の移行確認**（各 consumer が代替 API へ移行済みであることを確認・記録）

- 例外（**緊急変更**）: データ整合・安全性に関わる欠陥の修正は即時変更可。ただし CHANGELOG 記録＋統合済み consumer への
  **直接通知**を必須とする。
- consumer が 2 件（社内）である実態に合わせ、期間だけでなく「全 consumer の移行確認」を軸にする（確認の記録は
  当該変更を行う DD のログ、または consumer 統合DDの記録へ残す）。

## 3. Stable `1.0` 以降（予告・正式確定は Stage 4 前）

- **削除は major version でのみ**行う（憲章 §18.3「Stable API の削除は major で行う」）。
- 非推奨期間は**最低 90 日**の予告を置く。
- 本節は予告であり、正式な数値・手続きは Stage 4（一般提供判断）前に再確定する（憲章 §15 Stage 4 条件と整合）。

## 4. 運用フック（この規定が適用される場所）

| 局面 | フック |
|---|---|
| 公開面を変えた時 | `tests/contract/facade-surface.test.ts` ヘッダの手順（snapshot `-u` → CHANGELOG → migration guide 要否 → **本 policy 適用判定**） |
| 変更の検出 | 公開宣言 closure snapshot＋CI（`.github/workflows/ci.yml`・DD-028） |
| 移行手順 | `doc/migration/`（dry-run 検証義務付き） |
| 版の扱い | lockstep versioning（P-06・DD-031 で正式化）。API 版（`*_API_VERSION`）と package 版の対応は CHANGELOG |

## 5. 成熟度の現在地

| 層 | 状態 |
|---|---|
| Experimental `0.x` | **現行**（Stage 1 Alpha 達成済み・Stage 2 進行中） |
| Beta | Stage 2 移行判定（DD-032）通過で宣言 |
| Stable `1.0` | Stage 4 前に再確定 |
