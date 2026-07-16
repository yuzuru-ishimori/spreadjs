# DD-025: React Facade（@nanairo-sheet/react）

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-16 | 2026-07-16 | 検討中 | |

```text
Risk Class: A
Risk Triggers: 公開 API 新設（`@nanairo-sheet/react` Facade パッケージ＋外部依存 react を peer に追加）／再 mount リーク（StrictMode 二重 mount・unmount 反復）／受け入れ基準に新規操作仕様（props/lifecycle 変換契約）を含む
Human Spec Gate: required（Phase 1 の props/契約案をユーザーレビューで確定してから実装）
Codex: high（公開 API/外部 I-F 新設=必須シグナル。IME 状態機械・protocol・永続化アルゴリズムは無変更のため xhigh 非該当〔roadmap §2.2 L3〕）
Manual Gate: あり（実機スモーク1回・正味約10分: Chrome 実機の React ハーネスで日本語IME入力→onCellCommit→ref.setData 再注入→unmount/再mount 正常を確認。synthetic と実IMEを混同しない）
External Review: なし（ChatGPT は手動運用方針・呼び出し元判断。API確定は Codex＋Human Spec Gate で担保）
Evidence Level: standard
```

> アプローチ: TDD＋E2E駆動の混在（props/lifecycle 変換契約が中心＝unit を Red→Green。StrictMode 二重 mount・再mountリークは実ブラウザーE2E。画面の見た目は grid 側で実証済みのためモック不要）

## 目的

`@nanairo-sheet/react` パッケージを新設し、React アプリから `NanairoSheetView` コンポーネントで Nanairo Sheet を自然に使えるようにする。Facade は lifecycle（mount/destroy）と props/イベント変換のみを担当し、**グリッド内部状態を React state へ複製しない**（憲章 §11.2）。最初の実 consumer = housing-e-kintai-next（React 19.2 + Vite 8・DD-026）の直接の前提（roadmap §1 DD-025 行・S2-1）。

## 背景・課題

- 命名は確定済み（D-005・2026-07-16）: 製品名 Nanairo Sheet・scope `@nanairo-sheet/*`・コンポーネント名 `NanairoSheetView`（憲章 §11.2）。改名リスクなしで公開面を作れる。
- DD-024 完了により grid Facade は判別 union の `GridMountOptions`（共同編集 | standalone）・`cell-commit` イベント（通知のみ）・`GridInstance.setData`（mount 後再注入）を持つ（契約: `doc/archived/DD/DD-024/standalone-contract.md`・現物: `packages/grid/src/index.ts`）。React Facade は**この公開契約の薄い写像**とする（DD-024 DA #4/contract §6 で「union は props へ 1:1 写像可」確認済み）。
- consumer 実態: housing は react-query 5 でサーバー状態を非同期取得→`setData` 再注入・zustand・単独グリッドモード先行（roadmap §6: 認証・保存は全面的に利用側）。
- 既存 playground は非 React（Vite vanilla）。React コンポーネントのテスト手段（jsdom unit＋ブラウザーE2E ハーネス）はこの DD で新設が必要。

## 検討内容

詳細比較は Phase 1 成果物 `doc/DD/DD-025/react-facade-contract.md` へ（50行超は添付）。論点と仮説:

1. **props 形状（GridMountOptions ⇔ props の写像）**: 案a=フラット判別 union props（`mode` を判別子に props 型自体を union にし、standalone props に `serverUrl` を出さない＝grid と同じ型排他を props で維持・§11.2 の利用イメージに合致）／案b=`options` オブジェクト prop へ GridMountOptions を丸ごと渡す（写像最小だが React 慣行から外れ、部分変更検知が全再mountに直結）。仮説=案a。→ **要確認①**
2. **イベントの callback 化**: `GridEvent` 種別を個別 callback props（`onCellCommit`・`onLayout`・`onConnectionChange`・`onError` 等）＋生の `onEvent`（全種別素通し・診断/将来種別用）に写像。**callback props の差し替えは remount せず**最新参照を呼ぶ（内部 ref 保持で stale closure 回避）。subscribe は mount 時 1 本・unmount で解除。
3. **命令 API の公開方法**: 案a=ref handle（`useImperativeHandle` で `NanairoSheetViewHandle`＝`setData`/`focus`/`connectionState` を公開。GridInstance そのものは出さない）／案b=`data` prop の宣言的再注入（変更検知で setData）。仮説=案a（案b は文書データを React state で持たせる圧＝憲章 §11.2「内部状態を React state へ複製しない」への逆行。react-query の取得結果を effect から ref.setData で流すのが自然）。→ **要確認②**
4. **props 変更時の挙動契約**: mount 時固定の識別系 props（`mode`/`serverUrl`/`documentId`/`columnOrder`/`wrapColumns`〔grid 側 mount 固定〕）の変更=**自動 remount**（destroy→mount）／初期値系（`initialData`/`columnWidths`/`rowHeights`）は**初回のみ有効**（以後の変更は無視＋診断 warn。再注入は ref.setData・レイアウトは onLayout→次回 mount）／callback 系=remount なし差し替え。この3分類を契約として明文化。→ **要確認③**
5. **StrictMode 二重 mount 耐性**: React 19 StrictMode（dev）は effect を mount→cleanup→mount する。grid の mount/destroy は leak-free 実証済み（DD-024 E2E #4・DD-016-2 CG-6）なので「effect 内 mount・cleanup で destroy」の素直な実装で成立する見込み。unit＋E2E で二重 mount 後の表示・入力・購読重複なしを固定する。
6. **peer dependency 範囲**: `react` を peerDependencies のみで宣言（dependencies 追加なし）。範囲は案a=`^19.0.0`（検証済み範囲のみ宣言。18 対応は実需要トリガーで拡張＝推測で計画しない）／案b=`>=18 <20`（広いが 18 の検証マトリクス不在のまま宣言することになる）。仮説=案a。`react-dom` は peer に含めない（render は利用側・Facade は jsx-runtime のみ）。→ **要確認④**
7. **ADR-0022（ゼロランタイム依存）整合**: コア原則は不変。Facade の react peer は「利用側が既に持つホスト環境の宣言」であり dependencies 追加ではない——この整理を contract に記載し、必要なら ADR-0022 へ Facade 例外（peer 許容）を追記（Status 更新は別途）。
8. **配布形態と consumer ビルド**: 現行方式踏襲（TS ソース配布・`main: ./src/index.ts(x)`・private）。`.tsx` は consumer 側バンドラ変換が前提になるため、pack tarball 経由の扱い（`.tsx` を避け `createElement`/`jsx` 呼び出しで `.ts` に留める等）を Phase 1 で設計判断（DD-026/031 の手戻り防止）。dist ビルド切替は DD-031。
9. **テスト/E2E ハーネス**: unit=root へ dev 依存集約（react/react-dom/@testing-library/react/jsdom）し `packages/react` の Vitest を jsdom 環境で実行。E2E=playground へ React ハーネスエントリ（`react-standalone.html`・DD-024 standalone.html 先例）を追加するか、新規 app workspace にするかは Phase 1 で設計判断（仮説=playground エントリ追加が最小）。
10. **boundary lint**: react は Facade として R1〜R7 準拠（import は `@nanairo-sheet/grid` のみ・内部パッケージ直 import なし・公開シグネチャに内部型を出さない）。`scripts/boundary/` へ登録し new=0 を維持。

### 製品化6観点（dd-risk-class-header §2）

1. 公開API: Facade パッケージ新設（props/callback/ref handle 契約）＝本DDの主対象。2. 境界: grid 越しのみ・boundary lint 登録で機械担保。3. 再利用性: 特定案件へ結合しない（housing 固有要件は DD-026 側）。4. 拡張性: grid の Options/Event を素通しする薄い写像＝grid 側拡張が自動で通る形に。5. DX: Quick Start React 節・features.json・型定義。6. 互換性: Experimental 0.x（ADR-0015）・GRID_API_VERSION と同様の版数表記を検討。

## 決定事項

（未確定 — 要確認①〜④を Phase 1 Human Spec Gate で確定後に記載）

- **スコープ外**: 実 consumer 統合（DD-026）／React 状態管理ライブラリ（react-query/zustand 等）との統合支援コード／SSR・Next.js 対応（Vite SPA 前提）／Custom Element ラッパー（`@nanairo-sheet/element`）／dist ビルド配布切替（DD-031）。
- 両モード（共同編集|standalone）の props 写像を型として提供するが、動作実証の重心は standalone（DD-026 前提）。共同編集変種は unit（mount 引数写像）まで＝実ブラウザーE2E は張らない（共同編集経路自体は既存 E2E 12 本で回帰維持）。

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | React 19 アプリで `<NanairoSheetView mode="standalone" columnOrder=... initialData=... />` を render → グリッドが描画され初期データが表示される | Phase 2 unit＋Phase 3 E2E #1 |
| 2 | セルへ日本語IMEで入力・確定 → `onCellCommit` が `GridCellCommitChange` の batch で呼ばれる | Phase 3 E2E #2（synthetic）＋Manual Gate 実機スモーク |
| 3 | 再 render で `onCellCommit` 等 callback props を差し替え → remount されず、次の確定で新しい callback が呼ばれる | Phase 2 unit |
| 4 | ref（`NanairoSheetViewHandle.setData`）で再注入 → 表示が更新され、グリッド文書を React state に持たない（コンポーネントが値を保持しない） | Phase 2 unit＋Phase 3 E2E #1 |
| 5 | `<StrictMode>` 配下で mount → 二重 mount/cleanup を経ても表示・入力・イベント購読が正常（購読重複なし・console error なし） | Phase 2 unit＋Phase 3 E2E #3 |
| 6 | unmount → grid の destroy が呼ばれ、mount/unmount 反復でリークしない（canvas/textarea/listener 残留なし） | Phase 3 E2E #4（DD-024 lifecycle spec を範型） |
| 7 | 識別系 props（例 `columnOrder`）変更 → 契約どおり remount／初期値系（例 `initialData`）変更 → 無視＋診断 warn | Phase 2 unit（要確認③の確定内容に追随） |
| 8 | 既存回帰: `npm run test` 全 green（814+）・`npm run typecheck`/`npm run lint` green・`npm run lint:boundary` green（baseline 追加 0） | Phase 2/3 🔬機械検証 |
| 9 | Quick Start に React 節が追加され、`features.json` 整合が保たれる | Phase 4 🔬（`bash scripts/doc-check.sh`＋`npm test` features smoke） |

## タスク一覧

### Phase 0: 事前精査
- [ ] 📋 **各Phaseのタスク精査・詳細化**（受け入れ基準の検証対応・ファイルパス・変更内容の具体性・🔬タスクの有無を確認）
- [ ] 🧪 **テスト設計（Red）**: 主要シナリオ（AC1〜7）を自然言語で `doc/DD/DD-025/scenarios.md` に作成し、Phase 1 の Human Spec Gate で契約案と同時に合意を得る
- [ ] 📐 **実装前詳細化トリガー判定**: Phase 2 → 詳細化要（新規パッケージ・公開 I/F 新設・3ファイル超）／Phase 3/4 → 不要（判定を本文に確定記載）
- [ ] 🧑‍⚖️ **Codexレビュー要否判定**: Phase 2+3 → 必須・effort: high（公開 API 新設。xhigh 昇格条件〔状態機械/protocol/永続化の実質変更〕に非該当）
- [ ] 😈 **Devil's Advocate調査**: StrictMode 二重 mount で subscribe が重複しないか／identity 不安定な props（毎 render 新規の配列/オブジェクト）が意図せぬ remount を誘発しないか／`.tsx` TS ソース配布が DD-026 の Vite consumer で変換不能にならないか／peer 範囲を狭めて ReadyCrew（DD-030・stack 未確定）で詰まないか

### Phase 1: 公開契約設計（Human Spec Gate）
- [ ] `doc/DD/DD-025/react-facade-contract.md` を新規作成: 論点 1〜10 の比較・採用案（props union 形状・callback 一覧・ref handle 型・props 3分類契約・peer 範囲・ADR-0022 整理・配布形態・ハーネス配置）と、`packages/grid/src/index.ts` の公開型からの写像表（GridMountOptions→props／GridEvent→callback／GridInstance→handle）を記載
- [ ] 要確認①〜④（下記ログ）の判断材料（推奨案＋トレードオフ）を同ファイルへ併記
- [ ] 🔬 **機械検証**: 契約案の props/handle 型定義スケッチが `npm run typecheck` を通る → green
- [ ] 👀 **ユーザーレビュー**（Human Spec Gate: 要確認①〜④＋scenarios.md を確定してから Phase 2 へ）
- [ ] 😈 **DA批判レビュー**（この契約で DD-026 統合初日に何が露見するか。基準: da-method.md §3.4）

### Phase 2: 実装（Red→Green）
- [ ] 📐 **実装前詳細化**（詳細化要）: 触るファイル/関数・シグネチャ・データフロー（props→mount options 写像→GridInstance→callback）・エッジケース（boot 前 unmount・container 未確定・callback null）を確定し 👀 ユーザーレビュー
- [ ] **Red**: `packages/react/src/*.test.ts(x)` に合意済みシナリオのテストを作成（jsdom・@testing-library/react。AC1/3/4/5/7 対応: mount/destroy・callback 差替非remount・ref.setData・StrictMode・props 3分類）→ 全件失敗を確認
- [ ] `packages/react/` workspace 新設: `package.json`（name=@nanairo-sheet/react・0.1.0-alpha.0・private・dependencies=@nanairo-sheet/grid のみ・peerDependencies=react〔範囲は要確認④の確定値〕）・`tsconfig.json`・ルート `package.json` の workspaces 反映
- [ ] `packages/react/src/index.ts(x)` を新規実装: `NanairoSheetView`（effect で mount/destroy・subscribe 1本・callback ref 保持）・`NanairoSheetViewHandle`・props 型（判別 union 写像）・`REACT_API_VERSION`。公開シグネチャは grid 公開型のみ使用（R7）
- [ ] ルート dev 依存の追加（react/react-dom/@testing-library/react/jsdom を devDependencies へ集約）＋`packages/react` の Vitest jsdom 設定（`vitest.config` environment）
- [ ] `scripts/boundary/` の設定へ packages/react を Facade として登録（R1〜R7 検査対象・baseline 追加 0）
- [ ] **Green→Refactor**: テスト全件成功 → 品質改善
- [ ] 🔬 **機械検証**: `npm run typecheck && npm run lint && npm run lint:boundary && npm run test` → 全 green（814+新規・回帰 0・boundary new=0）
- [ ] 😈 **DA批判レビュー**（subscribe 重複・effect cleanup 順序・identity 不安定 props・grid 内部状態の React 複製が混入していないか）

### Phase 3: E2E検証・Codexレビュー・実機スモーク
- [ ] React E2E ハーネスを追加（Phase 1 確定の配置。仮説: `apps/playground` に `react-standalone.html`＋`src/integration/react-main.tsx`＝StrictMode 有効・localStorage 保存モックで onCellCommit→保存→F5 復元を実演）
- [ ] E2E #1〜4 を実装（`apps/playground/e2e/react-facade*.spec.ts`）: #1 表示/初期注入＋ref.setData 再注入／#2 synthetic IME→onCellCommit／#3 StrictMode 二重 mount 正常／#4 mount/unmount 反復リークなし（canvas/textarea/listener 残留 0・DD-024 standalone-lifecycle.spec を範型）
- [ ] 🔬 **機械検証**: 新規 E2E 全 green＋既存 E2E（18 本）回帰 green＋`npm run test`/`npm run lint:boundary` green
- [ ] Codexレビュー自動実行（依頼書 `doc/DD/DD-025/codex-review-request.md` を生成→`bash scripts/codex-review.sh --request ... --out doc/DD/DD-025/codex-review-result.md`・effort=high。観点: 契約一致・StrictMode/leak・テスト網羅・回帰）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録
- [ ] 🖐️ **Manual Gate（実機スモーク・正味約10分）**: Chrome 実機で React ハーネス→日本語IME入力→onCellCommit→ref.setData→unmount/再mount を確認（ユーザー実施）
- [ ] 😈 **DA批判レビュー**（synthetic E2E と実IMEの乖離・jsdom unit が実ブラウザー挙動を代弁できていない箇所はないか）

### Phase 4: DX成果物
- [ ] `doc/quick-start.md` に React 節を追加（`NanairoSheetView` 最小手順・onCellCommit→利用側 API 保存・ref.setData 再注入・StrictMode 注意・peer 要件）
- [ ] `apps/showcase/src/features.json` に React Facade のエントリを追加（status/summary/demo。AGENTS.md の更新義務）
- [ ] `doc/DOC-MAP.md` へ新規ドキュメント（quick-start 変更は既載なら不要・contract は DD 添付のため対象外）の要否を確認・反映
- [ ] 🔬 **機械検証**: `bash scripts/doc-check.sh` green＋`npm test` features smoke green
- [ ] 😈 **DA批判レビュー**（Quick Start の React 節だけ読んだ新規利用者が詰まる箇所: peer 導入・StrictMode・remount 契約の明記漏れ）

## ログ

### 2026-07-16
- DD作成（phase2-dd-roadmap §1 の採番 DD-025・Risk Class A・命名ゲート通過済み〔D-005〕を前提に公開面を新設）
- Codex 利用可否: `bash scripts/codex-review.sh --check` → 利用可（exit 0・codex-cli 0.144.2）。判定=Phase 2+3 必須・effort high
- Playwright MCP: 起票セッションでは未確認（実装セッション開始時に確認。利用不可なら手動キャプチャで代替と記録する）
- **要確認①**: props 形状 — 案a=フラット判別 union props（`mode` 判別子・standalone props に serverUrl を出さない・§11.2 の利用イメージ準拠）か、案b=`options` オブジェクト prop 丸ごとか。**推奨=案a**（React 慣行・型排他を props でも維持。DD-024 contract §6 で写像可を確認済み）
- **要確認②**: 命令 API — 案a=ref handle（`setData`/`focus`/`connectionState` のみ公開・GridInstance は出さない）か、案b=`data` prop の宣言的再注入か。**推奨=案a**（案b は文書データを React state に持たせる圧＝憲章 §11.2 に逆行。react-query の取得結果は effect から ref.setData が自然）
- **要確認③**: props 変更契約 — 推奨=3分類（識別系 `mode`/`serverUrl`/`documentId`/`columnOrder`/`wrapColumns` の変更は自動 remount／初期値系 `initialData`/`columnWidths`/`rowHeights` は初回のみ有効＋診断 warn／callback 系は remount なし差し替え）。対案=識別系変更をエラー扱い（remount させず fail-fast）。**推奨=3分類（自動 remount）**（React の宣言的モデルと整合し DD-026 で画面切替に追随できる）
- **要確認④**: react peerDependencies 範囲 — 案a=`^19.0.0`（検証済み範囲のみ宣言。housing=19.2。18 対応は実需要〔例: DD-030 ReadyCrew の stack 確定〕をトリガーに拡張）か、案b=`>=18 <20`（広いが 18 未検証のまま宣言）か。**推奨=案a**
- 実装時の注意（並行セッション lock 安全・memory 由来）: `packages/react` の workspace 追加は package-lock.json を更新する。並行 DD セッションが lock 更新中でないことを実装開始時に `git status` で確認する

---

## DA批判レビュー記録

### Phase N DA批判レビュー

**DA観点:** （このPhaseで最も壊れやすいポイントは何か？）

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | (具体的に記述) | 高/中/低 | (高/中: 操作→結果) | (どのDA観点で発見したか) | ✅修正済/⏭️別DD/❌不要 |
