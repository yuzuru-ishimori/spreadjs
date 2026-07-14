# DD-016-1: Facade実装・物理抽出

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-14 | 2026-07-14 | 完了 | 親=DD-016（案Y 2分割）。公開API固定・ime/selection/render抽出・grid/server-hono Facade・collaboration-server昇華・baseline 41→10。**720 test＋8 E2E＋R7漏洩0**。Codex xhigh 6 findings 反映（P2-1 consumer-harness は DD-016-2 委譲・見送り0） |

```text
Risk Class: A
Risk Triggers: 公開APIの新規固定（Experimental 0.x の consumer 契約＝外部I/F・互換性基線）／IME状態機械・textarea・focus/selection・render コードの物理移設（利用者入力経路へ間接波及）／CG-1 の変更トリガー例外（抽出・Facade化で挙動が変わりうる＝Phase 2 の自動回帰で担保、実機確認は DD-016-2）
Human Spec Gate: 解決済（親DD-016 要確認①〜⑤をユーザーが確定＝2026-07-14。API面の最終確定は Phase 1 の 👀 API確定ゲートで実施）
Codex: xhigh（Phase 2＝公開API固定×IME/render 物理移設〔挙動保存が破れた場合の検出〕×lifecycle 資源管理〔resource leak〕の必須シグナル複合＝親DDヘッダの理由記録を継承）
Manual Gate: なし（本子DDは自動検証のみ。CG-1 実機・CG-6 精密メモリは DD-016-2）
External Review: Codex xhigh で代替（親 要確認⑤確定・ADR-0011/012 先例。ChatGPT 不要）
Evidence Level: full（API surface snapshot・R7 型漏洩検査・挙動保存の回帰証跡・baseline diff を doc/DD/DD-016-1/ へ格納）
```

> アプローチ: 標準（Phase 1＝contract test 駆動〔TDD〕で公開面を Red→Green 固定、Phase 2＝挙動保存の物理移設）
> 親=**DD-016**（アンブレラ）。背景・全体像・要確認①〜⑤の確定は親を正とする。本子DDは**コード重心**（API固定・抽出・配線・baseline 縮退）を担い、実証重心（consumer・実機）は **DD-016-2**。
> CG: **CG-1** は Phase 2 の抽出で挙動が変わらないことを自動回帰（既存 test/E2E/不変条件 green）で担保する（実機スモークは DD-016-2）。CG-6 は範囲外（DD-016-2）。

## 目的

Stage 1 SDK Alpha の公開面を**コードとして確定**する。①主要 Facade（`@nanairo-sheet/grid`・`@nanairo-sheet/server-hono`＝最小経路・境界文書 §5 決定2）の公開APIを **Experimental 0.x で固定**（export・mount/destroy・serve/stop・Command/Event/Options・型定義・contract test）、②**consumer lifecycle 公開契約**（create/mount・destroy/disconnect・event subscribe/unsubscribe・document/room 指定・connection state・error notification＝DD-015 `SessionEvent` の公開整形・R7 非漏洩）、③縦切りDD群（DD-012-1/012-2）が委譲した **ime/selection/render の物理抽出＋Facade 配線＋boundary baseline 縮退**（担当31 entries・new=0 維持）、④`apps/playground`・`apps/collaboration-server` の Facade 経由化。

## 背景・課題（親DD-016 §背景の該当分）

- **Facade は stub のみ**: `packages/grid/src/index.ts`・`packages/server-hono/src/index.ts` は `throw` する skeleton（`mount`/`serve` が未実装エラー）。実 API 化が S1-2（Facade がある）・S1-3（内部 import なしで統合＝DD-016-2）の前提。
- **物理抽出の受け皿**: DD-012-1（ime/selection）・DD-012-2（render）は「Facade 未配線のまま抽出すると apps→internal の R1 baseline が肥大する」ため抽出を DD-016 へ委譲。baseline 41 entries 中 **31 が本子DD担当**（`scripts/boundary/baseline.json`: server-hono 系 8＝`apps/collaboration-server`／grid 系 23＝`apps/playground`。残 10 は PoC-D throwaway＝対象外）。
- **lifecycle 契約の素材は実装済み**: `packages/collab/src/session.ts` の `ClientSession` に `SessionEvent`（connection/pending/rejected/divergence）・observer 購読・`ConnectionState`・`ConflictQueueEntry` が存在。本子DDは**公開API面への整形が主で新規設計は最小**（R7: `ConflictQueueEntry`・`DocumentOperation`・`RejectDetails` 等の内部型を漏らさず公開型へ写像）。
- **現行の consumer 配線**: `apps/playground/src/integration/main.ts` が `fetchConfig`→`BrowserWebSocketTransport`→`createSessionSync`→`createBaseLayer`/`createOverlayLayer`→`createIntegrationEditor`→rAF ループ→tick interval→pointer/scroll/resize を手組みしている。`grid.mount()` はこれを束ね、`destroy()` は全解放する。

## スコープ

- **対象**: `grid`/`server-hono` の公開API固定（Phase 1）／lifecycle 公開契約（SessionEvent の公開整形・R7）／ime/selection/render の物理抽出（`packages/{ime,selection,render}` 新設）＋`apps` の Facade 経由化＋baseline 担当31 縮退（Phase 2）／回帰 green（既存 test/E2E/不変条件/typecheck/lint/build）。
- **対象外**: 独立 consumer 実証・S1-3 機械検査・実挙動シナリオ（**DD-016-2**）／CG-1 実機スモーク・CG-6 精密メモリ（**DD-016-2**）／行操作・数式（Stage 2）／配布・CHANGELOG・Quick Start・Tier 1 matrix 実測（DD-017）／Stage 1 移行判定・baseline 空の最終確認（DD-018）／`element`・`react` Facade（Stage 2。最初の consumer は vanilla TS＝親 要確認②確定ゆえ前倒し無し）。

## 決定事項（親 要確認確定を継承）

- **分割**: 案Y 2分割（本子DD＝コード／DD-016-2＝実証）。**最初の consumer は vanilla TS・pack 経由**（`react` 前倒し無し）。**外部レビューは Codex xhigh 代替**。
- **方針**: 抽出は**挙動保存**（描画・IME・同期挙動を変えない・既存テスト/E2E/不変条件 green 維持＝CG-1/CG-5 解除証拠を無効化しない）。公開APIは skeleton の signature を出発点に**最初の consumer に必要な最小面**のみ固定。設計転換（API 全面再設計・保証拡大）が必要になったら停止しユーザー提示（👀 Phase 1 ゲート）。

## 受け入れ基準

| # | 基準（操作 → 期待結果) | 検証方法 |
|---|------------------------|---------|
| 1 | `@nanairo-sheet/grid`・`@nanairo-sheet/server-hono` の公開API（export・mount/destroy・serve/stop・Command/Event/Options・型定義）が固定され、contract test（export surface snapshot＋R7 内部型漏洩0）green・Experimental 0.x 表明（ADR-0015 整合） | Phase 1 🔬 `tests/contract` |
| 2 | lifecycle 公開契約: mount→destroy→再mount を繰り返しても listener/RAF/WS/canvas/textarea が解放され resource leak しない。document/room 指定・connection state・error notification（SessionEvent 4種の公開整形・R7 非漏洩）を Facade 経由で subscribe/unsubscribe できる | Phase 1 契約テスト（leak 実挙動は DD-016-2 Phase 3） |
| 3 | ime/selection/render が `packages/{ime,selection,render}` へ物理抽出され**挙動保存**（既存 test・E2E・不変条件 green・`tests/invariants/ime` の import 先を `apps/playground/...` → package へ差し替え=DD-012-1 申し送り） | Phase 2 🔬 一括 green |
| 4 | boundary baseline: owner が DD-016／DD-012/DD-016 の全31 entries が除去され、新規違反0・残存は PoC-D throwaway（owner=none・10件）のみ | Phase 2 🔬 `npm run lint`（boundary check） |
| 5 | 回帰なし: `npm run test`／`typecheck`／`lint`（boundary 含む）／`build`／`test:invariants`・既存 E2E green。Codex xhigh findings を到達性×実害で仕分けし反映/見送り記録 | Phase 2 🔬 一括機械検証＋Codex |

## タスク一覧

### Phase 0: 事前精査（完了）
- [x] 📋 現行資産の精査（下記に結果を記録）
- [x] 📐 **実装前詳細化トリガー判定**: Phase 1 → 詳細化要（外部I/F=公開API）／Phase 2 → 詳細化要（3ファイル超・状態遷移コード移設・パフォーマンス特性）
- [x] 🧑‍⚖️ **Codexレビュー要否判定**: Phase 2 → 必須・effort xhigh（複合シグナル）。Codex 利用可（2026-07-14 `--check` exit 0・codex-cli 0.144.0-alpha.4）
- [x] 😈 **Devil's Advocate調査**（挙動保存のつもりの抽出が CG-1/CG-5 解除証拠の前提〔DOM 構造・focus 経路〕を静かに変えないか／最小APIが Stage 2 で破壊的変更を強いないか／destroy 漏れをテストでどう観測するか）

**Phase 0 精査結果（2026-07-14）**:
- Facade stub 2面: `mount(target,options)`/`serve(options)` が throw。公開型 `GridMountTarget`/`GridMountOptions`/`GridInstance`/`ServeOptions`/`ServerInstance`＋stage マーカー。依存ゼロ（R7）。
- baseline 担当31: server-hono 系 8（`ws-transport.ts`×2・`seed-dataset.ts`×3・`server.ts`×3）／grid 系 23（`apps/playground/src/integration/*` 各ファイル＋`main.ts`・`pocb/{main,scroll-anchor,viewport}.ts`）。
- 抽出対象（挙動保存で移設）: **ime**←`apps/playground/src/ime/{editor-state-machine,resident-textarea}`＋`integration/{ime-editing-session,integration-editor,editor-placement}`／**render**←`apps/playground/src/pocb/{base-layer,overlay-layer,render-scheduler,text-cache,axis,viewport,scroll-anchor,dpi,metrics,...}`＋`grid/{geometry,grid-view}`／**selection**←`apps/playground/src/pocb/selection.ts`＋`grid/navigation.ts`。※厳密な package 別メンバーシップは Phase 2 詳細化で確定（依存順: types→core→{selection,render,ime}→collab→grid）。
- `tests/invariants/ime/ime.invariant.test.ts` の import 先（`apps/playground/src/grid/geometry`・`ime/editor-state-machine`・`integration/{document-view,ime-editing-session}`）を package へ差し替える（DD-012-1 申し送り）。
- `scripts/consumer-harness.sh` は既に内部 package 禁止リストへ `selection|render|ime` を含む（新設を先取り済み）。

### Phase 1: 公開API固定・lifecycle 契約（contract test 駆動）
- [x] 📐 **実装前詳細化**（公開API面の全体設計）→ **`doc/DD/DD-016-1/phase1-api-design.md` に提案を作成**（grid: mount/destroy・GridEvent〔SessionEvent 写像・R7〕・GridConflict・GridMountOptions・GridInstance／server-hono: serve/stop・ServeOptions・ServerInstance／R7 型漏洩検査／要判断 D1〜D5）
- [x] 👀 **ユーザーレビュー**（API確定ゲート）**承認済 2026-07-14**: D1=**columnOrder 自動取得を既定（明示上書き可）**／D3=**rejected はサマリのみ（operationId/reason/code）**／D2 async serve・D4 Facade 所有 DOM・D5 内部メトリクス既定＝承認。**contract test（Red）→実装（Green）へ進む**
- [x] `packages/grid/src/index.ts`: stub → 公開型・mount/destroy・Command/Event/Options・イベント購読面（subscribe/unsubscribe）を確定
- [x] `packages/server-hono/src/index.ts`: serve/stop・接続 lifecycle・heartbeat/TTL の公開面を確定（`@nanairo-sheet/server` の `SnapshotData`/`RecoveryReport` 等内部型の非漏洩）
- [x] `tests/contract/facade-surface.test.ts` を拡張: export surface snapshot＋**R7 型漏洩検査**（公開シグネチャに内部 package 型が現れない）を Red で固定 → 実装で Green
- [x] 🔬 **機械検証**: `npx vitest run tests/contract` green（snapshot 差分がレビュー可能）
- [x] 😈 **DA批判レビュー**（公開型への写像で情報が欠落し consumer がエラー原因を特定できなくならないか。基準: da-method.md §3.4）

### Phase 2: 物理抽出・Facade 配線・baseline 縮退（挙動保存）＋Codex xhigh
- [x] 📐 **実装前詳細化** → **`doc/DD/DD-016-1/phase2-extraction-plan.md`**（依存グラフ・package 別メンバーシップ〔geometry/navigation→ime で DAG 無改変〕・PoC-A/B デモ処遇・実装順）
- [x] 👀 ユーザーレビュー（**PoC-A/B 標準デモ処遇のみ要判断**＝plan §3。他は内部エンジニアリング決定）
- [x] `apps/playground/src/{ime,pocb,grid,integration 対象資産}` → `packages/{ime,selection,render}` へ挙動保存で移設（`tests/invariants/ime` の import 先差し替え・`resident-textarea` 不使用化確認=DD-012-1 申し送り）
- [x] `packages/grid`: core/collab/render/selection/ime を束ね mount/destroy・Command/Event・接続イベントを配線（`apps/playground/src/integration` を昇華・第二 CellStore を作らない=境界文書 §3）
- [x] `packages/server-hono`: `apps/collaboration-server` を昇華（Room/Sequencer/ws 実トランスポート配線・startServer→serve）
- [x] `apps/playground` を Facade 経由へ書き換え・`apps/collaboration-server` は server-hono へ昇華し削除 → `scripts/boundary/baseline.json` の担当31 entries を除去（new=0 維持）
- [x] 🔬 **機械検証**: `npm run test`（720 pass）・`typecheck`（13 ws）・`lint`（boundary 41→10・new=0）・`build`・`test:e2e`（8 pass）green
- [x] Codexレビュー自動実行（`--effort xhigh`・結果 → `codex-review-result.md`＝6 findings P1×2/P2×4）
- [x] Codexレビュー指摘への対応（P1-1/P1-2/P2-2/P2-3/P2-4 反映・P2-1 は DD-016-2 委譲・見送り0。到達性×実害で仕分け＝ログ参照）
- [x] 😈 **DA批判レビュー**（移設で DOM 親・focus 順・イベント発火順が変わり IME/E2E が「たまたま green」になっていないか／Facade 配線後の初期化順序で race がないか）→ DA記録参照（4件・#1/#2 実証・#2 再mount leak は DD-016-2）

## ログ

### 2026-07-14
- DD作成（親=DD-016 の案Y 2分割。親 §要確認①〜⑤ のユーザー確定を継承。Phase 0 精査を実施し抽出対象・baseline 内訳・import 差し替え先を確定）。番号は子DD `DD-016-1`（トップ連番 DD-017/018 は不変）。
- **Phase 1 📐 実装前詳細化 完了 → 👀 API確定ゲートで確認待ち**。公開API設計提案を `doc/DD/DD-016-1/phase1-api-design.md` に作成（grid `mount/destroy/subscribe/GridEvent/GridMountOptions`・server-hono `serve/stop/ServeOptions`・SessionEvent→GridEvent の R7 写像・R7 型漏洩検査・要判断 D1〜D5）。**合意後に contract test（Red）→実装（Green）へ**。
- **API確定ゲート 承認**（D1=columnOrder 自動取得既定／D2 async serve／D3 rejected サマリのみ／D4 Facade 所有 DOM／D5 内部メトリクス既定）。
- **Phase 2 📐 抽出計画**（`doc/DD/DD-016-1/phase2-extraction-plan.md`）→ 👀 PoC-A/B デモ処遇のみ要判断 → **承認=削除（再利用資産は package へ・roadmap S1-1 整合）**。
- **Phase 1/2 実装 完了**（挙動保存）:
  - **内部 package 新設**: `selection`（pocb/selection）・`ime`（editor-state-machine＋geometry＋navigation＋event-recorder）・`render`（pocb/* 描画群）。geometry/navigation は render/selection 未使用ゆえ **ime 内へ置き boundary DAG 無改変**（policy.mjs 不変）。
  - **grid Facade**: 統合 glue を grid/src へ移設＋`mount-controller`（旧 integration/main.ts 昇華）＋`dom-scaffold`（D4）＋`index`（公開API）＋`test-support`（E2E introspection・boundary 除外）＋`internal`（debugRegistry）。
  - **server-hono Facade**: apps/collaboration-server を全面昇華（server.ts/seed-dataset/ws-frame＋テスト群）。WS クライアントテストトランスポートは `test-support.ts` へ。**apps/collaboration-server 削除**（playwright/dev-start/dev-kill/policy.mjs を server-hono へ更新）。
  - **apps 書換え**: playground 統合デモを grid.mount() consumer 化（内部 package 直 import 0）。**PoC-A/B 標準デモ＋対応 E2E spec 3本を削除**（承認済）。
  - **boundary tooling 精緻化**: `scripts/boundary/check.mjs` の **R7 検査を Facade 公開エントリ（src/index.ts）限定**へ（glue の内部型 export 誤検出を回避＝R7 の意図「公開シグネチャ非漏洩」に一致）。`tests/contract/facade-surface.test.ts` に **公開 .d.ts の内部 package specifier 走査**（R7 型漏洩0）を追加。
  - `tests/invariants/ime` の import 先を `@nanairo-sheet/ime`＋grid 内部（document-view/ime-editing-session）へ差し替え（DD-012-1 申し送り完了）。
  - **baseline 41→10**（担当31 除去・残 10=PoC-D throwaway・new=0）。
- **🔬 機械検証 全 green**: `npm run test` **720 pass**（selection3/ime89/render89/grid71/server-hono28＋既存＋invariants）／`npm run test:e2e` **8 pass**（Facade 経由の実ブラウザー統合＝AC1〜4/Presence/reconnect-headed/reload-bootstrap）／`typecheck`（13 workspace）・`lint`（eslint＋boundary new=0）・`build`・contract R7 .d.ts 走査 green。**挙動保存を全テストで実証**（既存 unit/invariant/E2E が import 差し替えのみで green）。
- **Codex xhigh レビュー完了・triage**（結果 `codex-review-result.md`・6 findings＝P1×2/P2×4・到達性×実害で仕分け）:
  - **[P1-1] Facade runtime 依存の宣言**（`grid`/`server-hono` package.json）: 実行時 import する `@nanairo-sheet/*` を `devDependencies`→`dependencies` へ（pack install 時に omit されない）。✅修正。**pack 済み内部 private package の closure/bundling は DD-016-2**（S1-3 pack実証の責務）。
  - **[P1-2] WS 接続失敗の connect error 化**（mount-controller）: 初回接続確立前の transport エラーを `GridEvent error{phase:'connect'}` で通知（`hasEverConnected` フラグ＋logger 注入。接続後の一時エラーは reconnect＝offline で表現）。✅修正。
  - **[P2-2] destroy 時の /config abort**: `fetch(/config, {signal})` で boot 進行中の destroy が fetch を残さない＋AbortError はエラー通知しない。✅修正（AC2 leak）。
  - **[P2-3] boot 中 focus の保持**: `mount().focus()` を editor 生成/初回配置前に呼んでも `focusRequested` で保持し初回描画後に適用。✅修正（public API 正当性）。
  - **[P2-4] pending イベントで status 更新**（playground main.ts）: offline 中は connection が抑止されるため `pending` イベントで backlog 件数を再描画（旧 updateReadout 相当を復元）。✅修正。
  - **[P2-1] consumer-harness fixture の API 追随**: 旧 `GRID_FACADE_STAGE`/`serve` sync 型等を新 API へ。⏭️**DD-016-2 へ委譲**（独立 consumer 実証＝S1-3・pack closure と一体で対応する harness/fixture の責務）。
  - 修正後 再検証 全 green: `npm run test` **720 pass**／`npm run test:e2e` **8 pass**／typecheck/lint（boundary new=0）green。findings 全件を反映 or 明示委譲（見送り0）。

---

## DA批判レビュー記録

### Phase 2 DA批判レビュー

**DA観点:** 挙動保存のつもりの抽出が、DOM 構造・focus 経路・イベント発火順を静かに変え、IME/E2E が「たまたま green」になっていないか。destroy 漏れ・R7 抜け穴・最小 API の将来破壊。

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | 抽出で DOM 親/focus 順/イベント発火順が変わり IME 成立が崩れる恐れ | 中 | mount→日本語 synthetic composition→変換中スクロール→確定 Enter | 挙動保存 | ✅ integration-editor（textarea host=stage）を無改変移設。8 E2E green（AC1〜4・#9 競合・textarea 追従・reconnect-headed が実ブラウザーで成立）＝DOM 構造/focus 経路保存を実証 |
| 2 | `destroy()` の resource leak（RAF/interval/listener/WS/textarea 解放漏れ・再mount leak） | 中 | mount→destroy→再mount ×N で listener/RAF/WS が残留 | resource 管理 | ✅ destroy() で cancelAnimationFrame/clearInterval/AbortController.abort/ResizeObserver.disconnect/browserTransport.close/editor.destroy/scaffold.dispose＋debugRegistry.delete。boot 進行中は destroyed フラグで wiring 抑止。⏭️ **再mount leak の実挙動シナリオ検証は DD-016-2 Phase 3**（AC2 実証） |
| 3 | R7 スコープを check.mjs で index.ts 限定にした変更が内部型漏洩の抜け穴を作る | 低 | 公開 index.ts が内部型を signature に出す | R7 正しさ | ✅ contract test の公開 .d.ts 走査で二重化（`@nanairo-sheet/内部` specifier 0 を独立検証・grid/server-hono green）。🧑‍⚖️ Codex xhigh で精査中 |
| 4 | 最小 API が Stage 2（行操作・数式・element/react）で破壊的変更を強いる | 低 | Stage 2 で行操作 API を公開 | 将来互換 | ❌不要（現状）: GridEvent/GridMountOptions は optional 追加で後方互換に拡張可能。行操作は test-support（内部・E2E 駆動）で公開 API に出さない |
