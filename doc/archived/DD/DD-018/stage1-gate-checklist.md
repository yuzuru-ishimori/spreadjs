# DD-018 Stage 1 移行判定チェックリスト（S1-1〜6・CG-1〜6・既知制約）

> **本DDの原則（roadmap §5）**: スコープ決定の場ではなく、事前に決めた条件を証拠で判定する場。
> 各行は「条件原文（roadmap §0・cg-ledger から転記）× 主担当DD × 証拠の所在 × 合否 × 判定根拠」。
> 証拠本体は各アーカイブDD（`doc/archived/DD/`）を参照。判定日=2026-07-15。
> 判定基準の確定: 要確認A〜E（DD本文「決定事項」・ユーザー承認 2026-07-15）— B（S1-6 再解釈追認）・C（CG-4/CG-6 境界化合格）を反映。

## 凡例

- 合否: ✅合格 / ❌不合格 / 🔶境界化（合格扱い・対象外や上限を明示）
- 「証拠の所在」のパスは実在確認済み（Phase 1 doc-check / ls 確認）。

---

## A節: Stage 1 移行条件 S1-1〜S1-6（roadmap §0）

| # | 条件原文（roadmap §0 転記） | 主担当DD | 証拠の所在 | 合否 | 判定根拠（1行） |
|---|---|---|---|---|---|
| S1-1 | PoCコードが `packages/*` へ抽出されている（判定だけでなく実抽出）。DD-018で「Adopt/Harden対象が `apps/playground` 等に残っていないこと」を機械確認 | DD-009 台帳＋各縦切りDD＋DD-016-1（物理抽出） | `scripts/boundary/{check.mjs,baseline.json}`／`doc/archived/DD/DD-009/poc-asset-ledger.md`（A〜G節 Adopt/Harden 行）／`doc/archived/DD/DD-016-1/phase2-extraction-plan.md`／本DD `regression-run-20260715.txt`（boundary） | ✅合格 | boundary check `baselined=10 new=0 stale=0`・残10件は全て `apps/pocd-bench`/`apps/pocd-browser-bench`（PoC-D throwaway・owner=none）＝`apps/playground` に採用資産 0。DD-009 Adopt/Harden 資産は全て `packages/*` へ抽出済（下の照合表）。DD-016-1 で baseline 41→10 に縮退（PoC-A/B primitives 消し込み） |
| S1-2 | 利用者向け Facade パッケージがある | DD-009（境界）→DD-016（Facade） | `packages/grid/package.json`＝`@nanairo-sheet/grid`／`packages/server-hono/package.json`＝`@nanairo-sheet/server-hono`／`doc/adr/0015-stage1-api-maturity-and-tier1-support.md`（Experimental 面）／`doc/archived/DD/DD-016-1/phase1-api-design.md` | ✅合格 | Experimental Facade 2本（`@nanairo-sheet/grid`・`@nanairo-sheet/server-hono`）が確立。内部8 package は Internal（boundary lint で consumer 直接 import 禁止）。R7（素通し再エクスポート禁止）で公開面最小化 |
| S1-3 | 1つの社内アプリが直接内部importなしで統合できる（fixtureだけでは不合格・§7） | DD-016（consumer統合） | `scripts/consumer-app.sh`／`scripts/consumer/check-closure.mjs`／`consumer-app/`（repo 直下・npm workspaces 非登録）／`doc/archived/DD/DD-016-2/{consumer-app-run.log,consumer-app-leak-metrics.json,consumer-app-scenario-alice-input.png,consumer-app-scenario-bob-reflected.png}` | ✅合格 | roadmap §7「実在社内アプリ **または** 独立consumerプロジェクトへ pack済み成果物 install」の後者で充足。consumer-app は `$REPO_ROOT/consumer-app`（**repo ディレクトリ直下だが npm workspaces 非登録＝boundary 検査対象外の独立プロジェクト**。root `workspaces=["packages/*","apps/*"]` に非該当）へ内部9 tarball closure を registry非経由で install＝`consumer-app/node_modules` には SDK tarball のみ・`@nanairo-sheet/*` Internal の直接 import 0（check-closure.mjs green）。§7 不合格条件（workspace link／source path 直接参照／Internal 直接import／unpublished assets）に全て非該当。**留意（Codex P2#3）**: dev ツール（vite/tsx/playwright/tsc）はルート node_modules から実行＝完全な外部ディレクトリ実証ではないが、§7 が禁ずるのは SDK の workspace link/source 参照であり dev ツール分離までは要求しない＝§7 充足。より厳密な「repo 外ディレクトリでの依存宣言実証」は Stage 2 で強化可（stage2-backlog.md 留意） |
| S1-4 | Quick Start・型定義・最小サンプルがある | DD-016/DD-017 | `doc/quick-start.md`／各 package の型定義（TS ソース配布 `main: ./src/index.ts`）／`consumer-app`（DD-016-2 実証） | ✅合格 | Quick Start 文書存在・consumer 前提（vite 等 TS 透過コンパイル環境）明記。型定義は TS ソース同梱。最小サンプル=consumer-app（DD-016-2 で pack closure install・vite build 実証） |
| S1-5 | API は `0.x` で変更可能だが変更履歴を残す | DD-009（成熟度）＋DD-017（CHANGELOG） | `CHANGELOG.md`／`doc/adr/0015-stage1-api-maturity-and-tier1-support.md`（Internal→Experimental 方針）／`GRID_API_VERSION='0.1.0-experimental'` | ✅合格 | `CHANGELOG.md` 新設・運用ルール確立。package 版 `0.1.0-alpha.0`＋API 面版 `0.1.0-experimental` の対応を CHANGELOG に記録。Experimental=長期後方互換非保証・version 検出 |
| S1-6 | 配布・運用成果物（private registry配布・再現build/publish・alpha dist-tag・Tier 1 compatibility matrix・最小error code/debug hook・CHANGELOG）。※複数チャネル運用・汎用診断基盤は Stage 2 | DD-017（S1-6）＋DD-018 ゲート化 | **本DD再取得**: `doc/DD/DD-018/{release-manifest-reproduced-20260715.json,release-reproduce-20260715.txt}`／`doc/archived/DD/DD-017/{error-codes.md,codex-review-result.md}`／`doc/adr/0015-stage1-api-maturity-and-tier1-support.md` §「S1-6 再解釈」／`scripts/release/build-release.sh`／`scripts/consumer-app.sh`／`CHANGELOG.md` | ✅合格（要確認B 追認基準・再現build 再取得済） | 要確認B（ユーザー追認 2026-07-15）により「private registry」→「再現可能な private 配布経路」で評価。実質3要件を充足: ①**再現 build（本DDで再取得: `build-release.sh` の typecheck/lint/test 前置ゲート green・EXIT=0＝現 committed 版 `0.1.0-alpha.0` から 9 tarball closure を再生成）**②チャネル明示（manifest `channel=alpha`・版数・sha256・生成コミット `2022d826`）③成果物のみ統合（内部9 tarball closure を registry 非経由 install）。alpha dist-tag=manifest チャネル表記で代替。error code 語彙＋debug hook（error-codes.md）。CHANGELOG（S1-5）。**Codex P1#1 対応**: DD-017 の旧 manifest は dirty tree（commit 5eb89b6・当時 版=0.0.0・script 不在）由来で再現不能だったため、本DDで現 committed 版から再取得。再取得 manifest の `gitDirty:true` は **DD-018 の doc 変更のみ由来（packages/scripts は無変更＝build closure 不変・git status で確認）**。完全 `gitDirty:false` は DD-018 コミット後に再生成で確定（本DDはコミット禁止のため主ループへ委譲）。複数チャネル/汎用診断基盤は Stage 2 送り（バックログ記載） |

### S1-1 Adopt/Harden 資産 × 抽出先 package 照合表（機械確認・AC2）

> DD-009 `poc-asset-ledger.md` の Adopt/Harden 行の抽出先が `packages/*` であり、`apps/playground` に残っていないことの照合。
> 機械確認: `node scripts/boundary/check.mjs` = `baselined=10 new=0`（残10件は全て `apps/pocd-bench`/`apps/pocd-browser-bench`=PoC-D throwaway・owner=none）。**`apps/playground` 由来の baseline 違反=0**。

| 資産（DD-009 台帳） | 分類 | 抽出先 package（論理名→実） | 現物確認 |
|---|---|---|---|
| `packages/sheet-types` | Adopt | `@nanairo-sheet/types` | `packages/types/` 実在 |
| `packages/sheet-core`（＋message-codec 移設） | Adopt/Harden | `@nanairo-sheet/core` | `packages/core/` 実在 |
| `packages/sheet-collaboration` | Harden | `@nanairo-sheet/collab` | `packages/collab/` 実在 |
| `packages/sheet-server-core` | Harden | `@nanairo-sheet/server` | `packages/server/` 実在 |
| `packages/sheet-formula` | Adopt（Stage 2 起動） | `@nanairo-sheet/formula` | `packages/formula/` 実在（Stage 1 は Facade 非搭載） |
| `grid/geometry.ts`・`grid/navigation.ts` | Harden | `@nanairo-sheet/render`/`selection` | `packages/render/`・`packages/selection/` 実在 |
| `ime/editor-state-machine.ts` 他 | Adopt/Harden | `@nanairo-sheet/ime` | `packages/ime/` 実在 |
| `pocb/*`（base/overlay/viewport/text-cache 他） | Harden | `@nanairo-sheet/render`/`selection`/`core` | `packages/render/`・`selection/`・`core/` 実在 |
| `integration/*`（integration-editor/document-view/commit-bridge 他） | Adopt/Harden | `@nanairo-sheet/grid`（内部は ime/render/collab） | `packages/grid/` 実在 |
| `server.ts`（Hono+ws）・ws-transport・ws-frame | Harden/Adopt | `@nanairo-sheet/server-hono` | `packages/server-hono/` 実在 |
| `integration/presence-adapter.ts` | Adopt（DD-019 起動） | `@nanairo-sheet/grid`（Stage 1 公開面除外） | Presence は Alpha 後拡張＝除外は仕様どおり |

**照合結論**: Adopt/Harden 資産は全て `packages/*` へ実抽出済。`apps/playground` は統合デモ（Facade 経由）のみで採用 primitives の残置 0（boundary baseline に `apps/playground` エントリ 0）。S1-1 機械確認=合格。

---

## B節: 条件付きGo 解除ゲート CG-1〜CG-6（cg-ledger・roadmap §0）

| CG | 条件原文（roadmap §0 解除証拠） | 主担当DD | 証拠の所在 | 合否 | 判定根拠（1行） |
|---|---|---|---|---|---|
| CG-1 実機IME | 実機trace・確定Enter順序B＋先頭欠落0（Win Chrome/Edge 両方）。最終consumer統合後の Tier 1 実機スモーク | DD-012-1＋DD-016-2 | `doc/archived/DD/DD-012-1/{cg1-judge-result.json,cg1-chrome-msime.json,cg1-edge-msime-1.json,cg1-edge-msime-2.json,evidence.md}`／`doc/archived/DD/DD-016-2/{cg1-chrome-trace.json,cg1-edge-trace.json,cg1-judge-result.json}` | ✅合格（解除済・残無し） | DD-012-1 実機20セッション（Chrome6＋Edge5＋Edge9・Win Chromium150・MS IME）→`judge-ime-trace.mjs` verdict PASS（先頭欠落0・順序B・両ブラウザ）。DD-016-2 統合後 Tier1 実機スモーク（Chrome6＋Edge3=9 sessions）verdict PASS。順序A は Chromium150 で構造的に不発（実機0）→自動不変条件/E2E で担保（roadmap §0 注記・ユーザー承認 2026-07-13）。残ゲート無し |
| CG-2 安定ID | RowId serialization・replay 整合試験 green | DD-010 | `doc/archived/DD/DD-010/{replay-evidence.md,perf-report.md}`（AC1〜6） | ✅合格（解除済） | RowId keyed slot 間接 CellStore を `@nanairo-sheet/core` へ統合・round-trip/全replay/differential green。ADR-0011 Accepted（Codex xhigh findings 4件全対応・ユーザー判断 2026-07-13）。DD-014 より前に完了（期限充足） |
| CG-3 snapshot正式形式 | versioned snapshot・snapshot+tail replay一致・100kで log全replay非依存・O(N²)回避測定・corrupt/version fail-fast＋クライアント bootstrap・durable整合・実ブラウザ再読込E2E | DD-014＋DD-014-1 | `doc/archived/DD/DD-014/{recovery-perf-raw.txt,evidence.md}`／`doc/archived/DD/DD-014-1/{evidence.md,scenarios.md,bootstrap-perf-raw.txt,reload-01/02-*.png,codex-review-result.md}` | ✅合格（解除済） | durable ACK（fsync後ACK）・snapshot format v1（checksum封筒・atomic・K=2・fail-fast）・snapshot+tail hash==全replay hash（randomized常設）・再起動復旧が snapshot+tail のみ・O(N²)回避（tail250/500/1000=865/660/565ms≦5s）。DD-014-1 で join を snapshot@R+tail 化（bootstrap 4.8ms vs 全replay 26s）・実 Playwright 再読込 E2E green・durable frontier 読取ゲート等（Codex xhigh P1-3〜7 解消）。ADR-0023 Accepted。DD-015 前に完了 |
| CG-4 Tier 1環境 | Tier 1 compatibility matrix（枠=ADR-0015。実測記入DD-017・合否DD-018）。Phase開始時に確定・exit で実証 | DD-009（枠）＋DD-017（実測）＋DD-018（合否） | `doc/adr/0015-stage1-api-maturity-and-tier1-support.md`（matrix・最終検証日2026-07-14）／`doc/archived/DD/DD-016-2/{cg1-judge-result.json,cg6-report.json}`／`doc/archived/DD/DD-017/release-manifest.json`／本DD `regression-run-20260715.txt`（exit 実証・当日green） | 🔶境界化（合格扱い） | Tier1（Win Chrome/Edge）実証: CG-1実機IME PASS（DD-016-2）＋CG-6精密メモリ PASS＋DD-017 配布物スモーク green。対象外（macOS/Firefox/モバイル）は roadmap §6・ADR-0015 で明示・非検証＝境界化（roadmap §0「対象外環境を明示・境界化で可」＝要確認C 追認）。「exit で実証」=本DD当日回帰スイート全green（下 AC3）。**本DDでクローズ** |
| CG-5 reconnect境界 | fault injection・再送・収束（障害種別ごと保証/非保証を分離） | DD-015 | `doc/archived/DD/DD-015/{fault-matrix.md,reconnect-fault-evidence.json,codex-review-result{,-2,-3,-4}.md,headed-01〜04.png}` | ✅合格（解除済） | fault matrix 全セルに保証(C1〜C11)/非保証(N1〜N5=§6明示)割当。exactly-once reconnect（join.pending＋welcome.reconcile・durable frontier 判定）。catch-up 閾値 T=1000。revision 連続性 fail-fast。指数バックオフ再接続。D27/D34 回収=切断+duplicate/drop/delay+client→server欠落を seed 注入・全submit説明責任（サイレント喪失0）。Codex xhigh 2回全反映・実ブラウザ headed smoke green |
| CG-6 精密メモリ | 精密メモリ計測（`performance.memory` 封鎖回避=`--enable-precise-memory-info`） | DD-012-2（指標）＋DD-016-2（精密確定） | `doc/archived/DD/DD-016-2/cg6-report.json`／`doc/archived/DD/DD-012-2/{perf-judge-result.json,evidence.md}`／`scripts/cg-perf/run-cg6.mjs` | 🔶境界化（合格扱い） | 精密メモリ PASS: `--enable-precise-memory-info` 実 Chrome で peak 65.3MB≪300MB・leak slope −345KB/s（純減）・growthRatio 0.51<1.25＝verdict pass。scroll p95 16.8ms・selection 7ms も予算内。**redraw は境界化**: stoppedRedrawMean 10.8ms は budget 0.33ms 超だが hardCeiling 12ms 未満・render 無変更（回帰不能の計測環境アーティファクト・rAF cadence 律速）＝roadmap §18.2 機能上限 ≤12ms を上限明示（要確認C 追認・roadmap §0「上限明示 or 不可」の前者）。残ゲート無し |

**CG節結論**: CG-1/2/3/5=解除済・CG-4/CG-6=境界化（合格扱い・要確認C 追認）。全6ゲートが終端状態（解除済/境界化）。Alpha ブロッカー（未解除の必須CG）=0。

---

## C節: 既知制約の棚卸し（roadmap §8＋各DD既知制約・三値判定）

> 三値: 解消済 / 延期（回収先DD明示＋Stage 2 バックログ掲載） / 製品境界化（roadmap §6 or Stage 2 と突合）

| # | 既知制約（原文） | 出典 | 判定 | 回収先/境界 | 根拠（roadmap §6 or Stage 2 突合） |
|---|---|---|---|---|---|
| K1 | client→server 欠落時の完全再整列（D27/D34） | roadmap §8 | 解消済 | DD-015（CG-5） | DD-015 で reconcile＋再送＋fault injection（C→S欠落含む・全submit説明責任）＝完全再整列・サイレント喪失0 実証。§8 で「解消済」明記 |
| K2 | snapshotベース初期化（大規模文書の初期ロード） | roadmap §8 | 解消済 | DD-014-1＋DD-015 | fresh/再読込は bootstrap（document@frontier）1通・再接続の大量差分も snapshot 再取得で log全replay 非依存。§8 で「解消済」明記 |
| K3 | 行挿入後のローカル選択・Enter移動先の再ベース | roadmap §8 | 延期 | DD-021（行操作・Stage 2） | 行操作は Alpha 範囲外（roadmap §6「範囲外/拡張扱い: 行操作」）。Stage 2 バックログ DD-021 に掲載 |
| K4 | 実IME変換中に対象行が削除された場合の挙動 | roadmap §8 | 延期 | DD-021（行操作・Stage 2） | IME×行削除の競合。行操作 Alpha 範囲外（roadmap §6）＝該当操作は Alpha で非推奨。Stage 2 DD-021 に掲載 |
| K5 | 新 integration-editor アダプタ×実IME候補ウィンドウ・順序A/B の実機記録（CG-1） | roadmap §8 | 解消済 | DD-012-1＋DD-016-2（CG-1） | CG-1 実機ゲート PASS（先頭欠落0＋順序B・両ブラウザ）＋統合後スモーク PASS。順序A は Chromium150 不発→自動テスト担保。§8 の CG-1 未解除条件を充足 |
| K6 | P2-1: 単一行 InsertRows 連発ログの Θ(N²)（`apply.ts` nextSlot 全走査＋splice） | DD-014 既知制約 | 延期 | DD-021（行操作・Stage 2） | 行操作は Stage 2＝最適化しない。100k は bulk insert で O(N²)回避を実証（snapshot経路は線形性担保）。roadmap §6「行操作は範囲外」。Stage 2 バックログ掲載 |
| K7 | P2-3: recovery の documentId/revision 相互検証欠如（`serve({documentId:'B', persistenceDir: dirA})` で文書Aを B として誤公開し得る） | DD-014 既知制約 | 延期（子DD切り出し） | **DD-018-1（fail-fast guard・要着手ユーザー判断）** | **Codex P1#2 追認**: 公開 `ServeOptions` の `documentId`/`persistenceDir` は通常の内部設定ミスで誤公開に至り、trusted internal 境界では防げない＝単なる異常構成エッジではない。§6 の version-mismatch fail-fast 哲学に倣い **persisted documentId 照合で fail-fast** すべき。回収先を子DD `DD-018-1` へ具体化。**Alpha ブロッカー扱いは要ユーザー判断**（§6 は tenant isolation 非保証・documentId は security 境界でない・P2-3 は DD-014 でユーザーが Alpha 対象外と既決＝§5 でスコープ再決定しない、を根拠に本判定は非ブロッカーとするが Codex は不合格＝要 fail-fast を主張。透明化のためユーザーへ判断を残す） |
| K8 | P2-4: restoreFrom＋persistenceDir 併用の revision 不連続（異常構成エッジ） | DD-014 既知制約 | 延期 | 同上（Stage 2 運用DD） | 異常構成のエッジケース。roadmap §6 信頼境界内（本番運用 Stage 1 対象外）。Stage 2 バックログ掲載 |
| K9 | DD-012-1 確定Enter順序A が現行 Tier-1（Chromium 150）で構造的に不発 | DD-012-1 | 製品境界化 | roadmap §0 注記＋自動テスト担保 | 順序A は実機必須から除外し不変条件（invariant 4/6）＋E2E（synthetic）で担保（green）。roadmap §0 注記に条件明記（将来 Tier-1 に順序A発生ブラウザが入れば再ゲート）＝製品境界（Tier1 限定）の一部 |

**C節結論**（9行）: 解消済3（K1/K2/K5）／延期5（K3/K4/K6/K8=Stage 2 バックログ／**K7=子DD DD-018-1 切り出し**）／製品境界化1（K9）。空欄0。延期項目は全て回収先（Stage 2 バックログ or 子DD）と対応。**K7（documentId 誤公開）は Codex P1#2 追認で子DD DD-018-1（fail-fast guard）へ切り出し**（着手はユーザー判断・Alpha ブロッカー扱いの是非も要ユーザー判断）。K7 以外に実装を要する未境界化の制約=0。

---

## 総合判定サマリ（Phase 5・Codex 監査反映後）

- S1-1〜S1-6: **全て合格**（S1-6 は要確認B 追認基準＋本DDで再現build 再取得〔Codex P1#1 対応〕）
- CG-1〜CG-6: **全て終端**（CG-1/2/3/5=解除済・CG-4/CG-6=境界化・要確認C 追認で合格扱い）
- 既知制約: 解消済3/延期5/製品境界化1。**実装を要する項目=K7 の1件のみ**（Codex P1#2 追認）→ 子DD **DD-018-1**（documentId/persistenceDir fail-fast guard）へ切り出し
- 回帰スイート（当日・CG-4 exit 実証）: `regression-run-20260715.txt`（全 EXIT=0・730 tests） 参照
- Codex 証拠監査（high・2026-07-15）: findings 4件（P1×2・P2×2）→ P2×2 全反映（証拠パス修正・S1-3 実態化）／P1#1 反映（再現build 再取得）／P1#2 反映（K7→DD-018-1 切り出し）

→ **総合判定: Stage 1 社内SDK Alpha 移行 = 可（Alpha 宣言可）**。条件=境界化2項目（CG-4 対象環境 Tier1 限定・CG-6 redraw ≤12ms 上限）＋Stage 2 送り既知制約＋**DD-018-1（K7 fail-fast）を追跡**（Alpha ブロッカー扱いの是非は要ユーザー判断＝Codex は不合格主張・本判定は §6/§5 根拠で非ブロッカー）。
