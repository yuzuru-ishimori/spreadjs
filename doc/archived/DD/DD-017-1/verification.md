# DD-017-1 検証（verification / After）

日付: 2026-07-15 / 環境: Windows 11・Node v22.20.0・vite 6.4.3

## 修正内容（1ファイル）

`apps/playground/vite.config.ts`:
- build input を相対 `'poc-integration.html'` から、**ディスク上の正準 casing に揃えた絶対パス**
  `resolve(realpathSync.native(dirname(fileURLToPath(import.meta.url))), 'poc-integration.html')` に変更。
- 意図: `vite:html-inline-proxy` の仮想 CSS モジュールキー `entryId.replace(config.root,'')` について、
  add 時（cwd 由来 casing）と load 時（rollup の正準 casing）でエントリ id の casing を一致させ、
  `No matching HTML proxy module found` を解消する。詳細は cause-analysis.md。
- packages/*・画面・vite 版・HTML には非接触（Risk Class C 維持）。

## Before / After 比較

| 項目 | Before（相対 input） | After（realpath 正準絶対 input） |
|---|---|---|
| ルート `npm run build`（no-cd＝小文字 cwd） | 8/8 **FAIL**（html-inline-proxy） | **8/8 green**（build-after-8x.log） |
| 直接 `npx vite build`（apps/playground） | 8/8 green | green（回帰なし） |
| `npm run typecheck` | green | green |
| `npm run lint`（+boundary） | green | green（baselined=10 new=0） |
| `npm run test` | green | green（79 files / 730 tests） |
| `dist/poc-integration.html` | inline-css 反映 | Before と**バイト同一**（`diff` 差分ゼロ） |
| `dist/assets/*` 集合 | — | Before と同一集合 |

## AC 達成状況

- **AC1**（再現条件特定・切り分けマトリクス）: repro-log.md / env-diff.md / cause-analysis.md で達成。
- **AC2**（修正後ルート build 連続 8 回 green）: build-after-8x.log で **8/8 green** 達成（要確認2の既定 N=8）。
- **AC3**（回帰なし・dist 実質同等）: 上表のとおり typecheck/lint/test/直接 build 全 green・dist バイト同一で達成。
- **AC4**（境界化）: 恒久是正が成立したため**不発動**（案 e 不採用）。

## Codex レビュー（effort high）対応

- [P2] withUpperDrive はドライブレターのみ正規化 → 中間セグメント casing 差で再発しうる: **反映**。
  `realpathSync.native` に置換し、ドライブレター＋全区間 casing＋シンボリックリンクを正準化。
- [P3] DD-INDEX ステータス不整合: **反映**。本文ステータス確定後に `scripts/dd-index-gen.sh` で再生成。

## 因果の確認（DA 観点: 8/8 green が偶然でないか）

- 修正前は同一 no-cd 起動で 8/8 決定的 FAIL、修正後は同条件で 8/8 green。単なる確率的 flake ではなく、
  原因（casing 不一致）を意図的に成立させる起動条件（小文字 cwd）で FAIL→green の因果を確認済み。
- 修正の効き所は input casing のみに閉じており（config.root には非依存）、rollup の正準化と一致する
  realpath を用いるため casing 由来の再発面を塞いでいる。
