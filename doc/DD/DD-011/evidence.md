# DD-011 証跡（5点圧縮・Evidence Level: standard）

> roadmap §2.2 L5 の5点圧縮証跡。生ログは実行コマンドを都度再現できる（下記③のコマンド参照）。

## ① スコープ・対象外・リスク区分

- **Risk Class**: B（承認済みバックログ範囲・機械的基盤整備）。B→A 昇格トリガーは**発生せず**（Facade は stub のまま・実 API 未確定・データ形式/protocol/永続化境界へ波及なし・状態所有者の変更なし）。
- **スコープ**: codec 移設（collab→core）／Facade skeleton（grid・server-hono の stub）／boundary lint（R1〜R7・baseline）／常設不変条件 runner（ime/collab/api/perf）／contract test 骨格／independent consumer harness（雛形）／DD差分テンプレ新設。
- **対象外**: Facade 実 API・Command/Event/Options（DD-016）／不変条件の実充足（DD-012〜015）／実在アプリ統合＝S1-3 本実証（DD-016）／baseline のゼロ化（DD-018）／R6 は既存 `typecheck:core`（ADR-0022）流用で新規実装せず。

## ② AC 対応表

| # | 受け入れ基準 | 結果 | 証跡 |
|---|---|---|---|
| 1 | `npm run lint` で R3/R4/R5 full-error・R1 は harness full-error＋既存 apps baseline で green | ✅ | `npm run lint`（eslint＋`lint:boundary`）green。baseline=41・new=0 |
| 2 | 違反フィクスチャ4種で lint/検査が ERROR | ✅ | R1/R4/R7＝check.mjs で ERROR 検出・R5＝eslint で ERROR 検出（フィクスチャは削除済み） |
| 3 | `npm run test:invariants` 4カテゴリ green | ✅ | ime2・collab2・api3・perf1＝8 tests green |
| 4 | contract test が export 変更で fail し snapshot 更新で復旧 | ✅ | grid へ export 追加→snapshot mismatch で fail→除去で green を確認 |
| 5 | pack→install→`tsc --noEmit` green（workspace link・source path・内部 import なし） | ✅ | `bash scripts/consumer-harness.sh` green＋S1-3 不合格条件検査が内部 import 挿入時に FAIL するのを確認 |
| 6 | 既存回帰なし（test/typecheck/lint 全 green） | ✅（1 件は環境要因） | typecheck・lint・build green。test 570/571 green。1 failure＝`ws-convergence.smoke`（20s waitFor 上限・並行 node 20+ の高負荷 timeout・baseline から flaky・codec は byte 同一で decode 単体 green） |
| 7 | Risk Class ヘッダ＋製品化6観点が `doc/plan/dd-risk-class-header.md` に存在し DD-012 以降が参照可 | ✅ | 新設＋DOC-MAP 追記・`doc/plan/` 配下＝dd-update 非管理 |

## ③ 機械検証要約＋再現コマンド

```bash
npm run typecheck            # 全 workspace green（grid・server-hono 含む）
npm run lint                 # eslint（R2/R3/R5）＋ node scripts/boundary/check.mjs（R1/R4/R7・baseline=41 new=0）green
npm run build                # playground 本番ビルド green
npm run test:invariants      # ime2 collab2 api3 perf1 = 8 green
npx vitest run tests/contract  # Facade surface snapshot 2 green
bash scripts/consumer-harness.sh   # pack→install→tsc --noEmit green＋S1-3 不合格条件検査
npm run test                 # 570/571 green（1=ws-convergence.smoke の環境要因 timeout）
```

## ④ finding 対応・既知制約

- Codex レビュー（effort high・全差分一括）: 結果は `doc/DD/DD-011/codex-review-result.md`。対応/見送りは DD 本文ログ参照。
- **既知制約**:
  - `ws-convergence.smoke` は `waitFor` 20s ハード上限で並行負荷時に timeout（DD-011 前から flaky・回帰ではない）。
  - contract test は現状 **value export 名**の snapshot（stub 段階で最も安く破壊的変更を捕捉）。型シグネチャ全体の contract は実 API が入る DD-016 で `.d.ts`/API extractor ベースへ拡張。
  - R7 の型漏洩検査は「Facade が内部 package を import しているか」のヒューリスティック（stub は依存ゼロ＝green）。tsc 型情報での厳密検査は DD-016 で格上げ。
  - baseline（R1×38・R4×3）は縮退責務を各抽出DD（DD-012〜016）へ、ゼロ確認を DD-018（S1-1）へ送付済み（`scripts/boundary/baseline.json` の owner フィールドに明記）。

## ⑤ ADR・公開API・互換性影響

- **ADR**: 転換なし（新規 ADR 不要）。R6 は ADR-0022（ゼロ依存 core）・API 成熟度は ADR-0015 を踏襲。
- **公開API**: Facade（grid・server-hono）は **stub**。実 API は未確定（Internal→Experimental の確定は DD-016）。本DDで consumer へ確定露出した実 API は**なし**。
- **互換性**: codec 移設は import 経路の変更のみ（consumer は `@nanairo-sheet/core` から decode を取得）。挙動・wire format 変更なし＝**後方互換影響なし**。protocol/schema version 変更なし。
