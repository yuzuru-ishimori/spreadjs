# DD-025: React Facade（@nanairo-sheet/react）

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-16 | 2026-07-16 | 完了 | 全Phase完了・Manual Gate実機OK（IME確定→onCellCommit・再注入・再mount正常・console clean） |

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

Human Spec Gate（2026-07-16・ユーザー確認済み）で要確認①〜④を全て推奨案で確定。詳細は `doc/DD/DD-025/react-facade-contract.md`。

- **D-① props 形状 = 案a フラット判別 union props**: `mode` を判別子に props 型自体を union 化。standalone props に `serverUrl` を出さない（型排他を props でも維持）。`columnOrder` は grid 名を踏襲、初期レイアウトは `initialColumnWidths`/`initialRowHeights` に改名して露出（初期値系の意図を名前で示す）。（契約 §1）
- **D-② 命令 API = 案a ref handle**: `useImperativeHandle` で `NanairoSheetViewHandle`（`setData`/`focus`/`connectionState` のみ）。`GridInstance` 本体は出さない。文書データは React state へ複製しない（憲章 §11.2）。（契約 §3）
- **D-③ props 変更契約 = 3 分類・識別系は自動 remount**: 識別系（`mode`/`serverUrl`/`columnOrder`/`wrapColumns`/`documentId`/`displayName`/`clientId`）変更=destroy→mount／初期値系（`initialData`/`initialColumnWidths`/`initialRowHeights`）=初回のみ有効＋以後は無視＋診断 warn／callback 系=ref 差し替えのみ。識別系の配列（columnOrder 等）は**値の浅い比較**で毎 render リテラルを吸収し誤 remount を防ぐ。（契約 §4）
- **D-④ react peer 範囲 = `^19.0.0`**: 検証済み範囲のみ宣言（housing=19.2）。`react-dom` は peer 非対象。18 対応は実需要トリガーで拡張。（契約 §5）
- **D-⑤（付随）配布本体は `.ts`**: `.tsx` を避け `createElement`/jsx-runtime で container を返す。E2E ハーネス（playground consumer 側）のみ `.tsx` 可。（契約 §7）

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
- [x] 📋 **各Phaseのタスク精査・詳細化**（受け入れ基準の検証対応・ファイルパス・変更内容の具体性・🔬タスクの有無を確認）→ 済（各Phaseの触るファイル・🔬タスクは契約 §8/§9 と本タスク一覧で具体化。追加のズレなし）
- [x] 🧪 **テスト設計（Red）**: 主要シナリオ（AC1〜7）を自然言語で `doc/DD/DD-025/scenarios.md` に作成し、Phase 1 の Human Spec Gate で契約案と同時に合意を得る → 済（S1〜S7・AC1〜7全対応）
- [x] 📐 **実装前詳細化トリガー判定**: Phase 2 → **詳細化要**（新規パッケージ・公開 I/F 新設・3ファイル超）／Phase 3/4 → **不要**（既存ハーネス範型踏襲・DX成果物のみ）。**確定**
- [x] 🧑‍⚖️ **Codexレビュー要否判定**: Phase 2+3 → **必須・effort: high**（公開 API 新設。xhigh 昇格条件〔状態機械/protocol/永続化の実質変更〕に非該当）。**確定**
- [x] 😈 **Devil's Advocate調査**: 4点とも契約で対処 → subscribe 重複=mount時1本・unmountで解除＋StrictMode二重mount耐性を S5/E2E#3 で固定（契約 §0/§2）／identity不安定props=識別系配列は**値の浅い比較**で吸収（契約 §4）／`.tsx`配布=**配布本体は `.ts`（createElement/jsx）に留める**（契約 §7）／peer狭域=`^19.0.0`は実需要トリガー拡張・18は検証マトリクス不在のまま宣言しない（契約 §5・要確認④）

### Phase 1: 公開契約設計（Human Spec Gate）
- [x] `doc/DD/DD-025/react-facade-contract.md` を新規作成: 論点 1〜10 の比較・採用案（props union 形状・callback 一覧・ref handle 型・props 3分類契約・peer 範囲・ADR-0022 整理・配布形態・ハーネス配置）と写像表（§0）を記載 → 済
- [x] 要確認①〜④の判断材料（推奨案＋トレードオフ）を同ファイル §1/§3/§4/§5 と末尾まとめ表へ併記 → 済
- [x] 🔬 **機械検証**: 契約案の props/handle 型定義が `npm run typecheck` を通る → Phase 2 で `packages/react` として実体化し green 確認済み
- [x] 👀 **ユーザーレビュー**（Human Spec Gate）→ 2026-07-16 通過。要確認①〜④を全て推奨案で確定（決定事項 D-①〜④）
- [x] 😈 **DA批判レビュー**（DD-026 統合初日に露見しうる点）→ 契約 §4（identity 不安定 props の値比較吸収）・§7（`.tsx` 回避で Vite 変換依存を作らない）・§3（boot 前 handle 呼び no-op）で対処済み。残課題は Phase 3 実機で検証

### Phase 2: 実装（Red→Green）
- [x] 📐 **実装前詳細化**（詳細化要）: 触るファイル/関数・シグネチャ・データフロー・エッジケースは `react-facade-contract.md`（§0 写像・§1 props・§3 handle・§4 3分類）で確定済み。エッジケース（boot 前 unmount＝cleanup で destroy／container 未確定＝effect 冒頭 null guard／handle 未 mount＝no-op+warn／callback null＝optional chaining）を実装で処置
- [x] **Red→Green**: `packages/react/src/nanairo-sheet-view.test.ts`（jsdom・@testing-library/react・grid mount をモック）に AC1/2写像/3/4/5/7・unmount destroy の 11 テストを作成 → green
- [x] `packages/react/` workspace 新設: `package.json`（@nanairo-sheet/react・0.1.0-alpha.0・private・deps=@nanairo-sheet/grid・peerDependencies=react ^19.0.0）・`tsconfig.json`（lib DOM・types:[]）。workspaces は既存 `packages/*` glob で自動反映
- [x] `packages/react/src/index.ts` を新規実装: `NanairoSheetView`（forwardRef・effect で mount/destroy・options.onEvent 1 本購読・callback ref 保持・mountKey で自動 remount・初期値系変更 warn）・`NanairoSheetViewHandle`・props 判別 union・`REACT_API_VERSION`・`NanairoSheetViewError`。JSX 不使用（createElement・`.ts` 配布・契約 §7）。grid 公開型を signature 参照するが再エクスポートしない（R7 clean）
- [x] ルート dev 依存追加（react/react-dom/@testing-library/react/jsdom/@types/react/@types/react-dom を devDependencies へ集約・`npm install` 済 78 packages）＋Vitest は per-file `// @vitest-environment jsdom` docblock で jsdom 実行（root vitest.config は node 既定のまま）
- [x] `scripts/boundary/policy.mjs` は `react` を既に Facade 登録（`ALLOWED_DEPS.react=['grid']`）。追加登録不要・baseline 追加 0 を確認
- [x] **Green→Refactor**: 11 テスト全成功。実装は薄い写像に集約（余剰状態なし）
- [x] 🔬 **機械検証**: `npm run typecheck`／`npm run lint`（eslint＋boundary new=0）／`npm run test`（**825 passed**・回帰 0・新規 react 11）→ 全 green
- [x] 😈 **DA批判レビュー**: subscribe 重複=options.onEvent 1 本＋destroy 解放・StrictMode で生存 1・単発発火→callback 1 回を test で固定／effect cleanup 順序=mount effect が destroy を返す・initial-warn effect は instanceRef null guard／identity 不安定 props=mountKey の JSON 値比較で吸収（test で固定）／grid 内部状態の React 複製=**なし**（文書は grid のみ保持・props/state に持たない・setData は ref 委譲）

### Phase 3: E2E検証・Codexレビュー・実機スモーク
- [x] React E2E ハーネスを追加: `apps/playground/react-standalone.html`＋`src/integration/react-main.ts`（**`.ts`**＝createElement・契約 §7／StrictMode 有効・localStorage 保存モック・window.__reactStandalone で E2E 駆動）。playground に react/react-dom/@nanairo-sheet/react を devDeps 追加
- [x] E2E #1〜4 を実装（`apps/playground/e2e/react-facade*.spec.ts`＋`react-facade-helpers.ts`）: #1 表示/初期注入＋ref.setData 再注入（**onCellCommit.previousValue の round-trip で検証**＝公開契約のみ・GridInstance 非露出）／#2 synthetic IME→onCellCommit／#3 StrictMode 二重 mount 正常／#4 mount/unmount 反復リークなし（canvas/textarea/scroller/rAF/WS を外部計装・DD-024 lifecycle を範型）。r0/col-a は grid 既定 geometry から (92,35) を決定的算出
- [x] 🔬 **機械検証**: React E2E **4 green**＋既存 E2E **18 回帰 green**（計 **22 pass**）＋`npm run test` **828 pass**＋`npm run lint:boundary`（new=0）＋typecheck green
- [x] Codexレビュー自動実行（依頼書 `doc/DD/DD-025/codex-review-request.md`→`codex-review-result.md`・effort=high・利用可 0.144.2）
- [x] Codexレビュー指摘への対応: P1×2・P2×2 を**全反映**（到達性×実害で全件正当・低コスト）。詳細は下記ログ＋`codex-review-result.md`
- [x] 🖐️ **Manual Gate（実機スモーク）**: 実機 React ハーネスで日本語IME確定→onCellCommit・ref.setData 再注入・unmount/再mount を確認（ユーザー実施・2026-07-16）→ **OK**（挙動正常・console にエラー/警告なし）
- [x] 😈 **DA批判レビュー**（synthetic E2E と実IMEの乖離）: #2 は synthetic composition＝配線の回帰確認であり実 IME 変換は Manual Gate で補完（scenarios S2 に明記）。jsdom unit は grid を mock＝実描画/実 IME は E2E＋Manual Gate が担保する二段構え

### Phase 4: DX成果物
- [x] `doc/quick-start.md` に §4c「React 組み込み（`<NanairoSheetView>`）」を追加（最小手順・ref.setData 再注入・onCellCommit→保存・props 3 分類契約・StrictMode・peer 要件・onDiagnostic 後付け注意）
- [x] `apps/showcase/src/features.json` に `react` エントリ追加（status=available・source=DD-025）＋`ops-maturity` の「React ラッパー」を Alpha 提供済みへ更新（demo は scenarios 未追加のため付けない＝smoke の demo 規則に適合）
- [x] `doc/DOC-MAP.md`: quick-start.md は既載（節追加のみ＝新規 doc なし）／contract・scenarios・codex 記録は DD 添付（対象外）→ **DOC-MAP 変更不要**
- [x] 🔬 **機械検証**: `bash scripts/doc-check.sh` OK＋`npm test` features smoke 6 pass（全体 828 pass 維持）
- [x] 😈 **DA批判レビュー**（Quick Start の React 節）: peer 導入（react は consumer 依存・react-dom 不要）・StrictMode leak-free・remount 契約（3 分類）・onDiagnostic 後付け制約を全て明記。詰まりやすい「初期値系は初回のみ／再注入は ref.setData」を太字で強調済み

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

### 2026-07-16（実装セッション開始）
- ステータス 検討中 → 進行中。Phase 0 精査（4判定確定）＋ Phase 1 成果物を作成:
  - `doc/DD/DD-025/scenarios.md`（S1〜S7・AC1〜7全対応・Red 起点）
  - `doc/DD/DD-025/react-facade-contract.md`（論点1〜10・写像表§0・要確認①〜④の判断材料・末尾まとめ表）
- Phase 0 判定確定: 実装前詳細化=Phase2要/Phase3-4不要／Codex=Phase2+3必須・high／DA調査4点は契約で対処。
- 契約の主な設計判断（推奨・要ゲート確認）: props=フラット判別union（§1）・命令API=ref handle（§3）・props変更=3分類で識別系は自動remount＋識別系配列は値比較で吸収（§4）・peer=react ^19.0.0のみ（§5）・配布本体は`.tsx`回避で`.ts`（§7）・E2Eハーネスはplaygroundへ追加（§8）。
- 命名の追加論点（要確認①に内包）: grid `columnOrder` を踏襲（憲章§11.2スケッチの `columns` は図示用）。初期レイアウトは意図が伝わる `initialColumnWidths`/`initialRowHeights` に改名して露出。
- **Human Spec Gate 起動**: 要確認①〜④＋scenarios を確定してから Phase 2（実装）へ。ここで停止しユーザー確認を取る。
- **Human Spec Gate 通過**（ユーザー確認）: 要確認①〜④を全て推奨案で確定（決定事項 D-①〜⑤）。スコープ変更なしのため Phase 2 実装へ継続（memory: dd-phase-autonomy）。

### 2026-07-16（Phase 2 実装完了）
- lock 安全確認: `git status` クリーン（並行セッションの package-lock/packages 変更なし）→ workspace 追加を実施。Node v22.20.0。
- 新規: `packages/react/{package.json,tsconfig.json,src/index.ts,src/nanairo-sheet-view.test.ts}`。root `package.json` に react/react-dom/@testing-library/react/jsdom/@types を devDeps 集約し `npm install`（+78 packages）。
- 実装ハイライト: options.onEvent 1 本購読で全 GridEvent を受け個別 callback へ分配／callback は ref 保持で差し替え非 remount／mountKey（識別系 JSON）で自動 remount＋配列 identity 吸収／初期値系変更は無視＋診断 warn／ref handle は setData/focus/connectionState のみ。**grid 内部状態を React state へ複製しない**（憲章 §11.2 順守）。
- boundary: `react` は policy に Facade 既登録・`export from '@nanairo-sheet/grid'` を避け grid 公開型は import type で signature 参照のみ（R7 clean）。
- 🔬 機械検証 全 green: typecheck ✅／lint（eslint＋boundary new=0）✅／test **825 passed**（回帰 0・新規 react 11）。
- 残 Phase 3（E2E・Codex high・**Manual Gate=ユーザー実施**）／Phase 4（quick-start React 節・features.json）。

### 2026-07-16（Phase 3 E2E・Codex 完了）
- E2E introspection 方針（ユーザー確認）: **公開契約のみで検証**（DD-025 内完結）。GridInstance を隠蔽したまま onCellCommit.previousValue の round-trip で初期注入/再注入を検証。grid 変更なし。
- 新規: `apps/playground/react-standalone.html`・`src/integration/react-main.ts`・`e2e/react-facade{,-helpers,-lifecycle}.ts/spec.ts`。playground に react/react-dom/@nanairo-sheet/react を追加し `npm install`。
- E2E 結果: React 4本＋既存18本＝**22 pass**（回帰0）。Playwright は既存 config（vite :5199＋WS :8799）を流用。
- Codex レビュー（high・effort・API課金なし）: 4指摘、**全反映**（review-findings-triage: 到達性×実害で全件正当・低コスト）。記録 `codex-review-result.md`。
  - **P1a**（callback ref を commit 後に更新）: render 中の ref 代入は Concurrent React（startTransition/Suspense）で未 commit render の callback が現 instance へ漏れる → **`useLayoutEffect` へ移動**。
  - **P1b**（初期文書を毎 render 直列化しない）: `initialData`（数万行）の JSON.stringify を毎 render → 同期停止 → 初期値系の変更検知を**参照比較（Object.is）**に変更。
  - **P2a**（onDiagnostic の後差し替え）: grid は初回 hook を保持 → **最新 ref を読む安定ラッパー**を mount 時に渡す（zero-cost opt-in 維持: mount 時未指定なら undefined）。
  - **P2b**（接続状態キャッシュの mount 初期化）: `lastConnStateRef` を **mount 時 `instance.connectionState()` で初期化**（remount で旧状態を引き継がない・初回 connection 前の pending も正しい）。
  - 修正を固定する unit を 3 本追加（同一参照 initialData 非warn・onDiagnostic 差し替え最新反映・未指定→undefined）→ react unit **14 本**。
- Codex 修正後の再検証: typecheck ✅／lint（boundary new=0）✅／`npm test` **828 pass**／React E2E **4 pass** 全 green。
- **Manual Gate 依頼中**（実機スモーク・正味約10分・ユーザー実施）。Phase 4（DX 成果物）を並行で進める。

### 2026-07-16（Phase 4 DX 完了）
- `doc/quick-start.md` §4c React 節追加／`apps/showcase/src/features.json` に `react`（available・DD-025）追加＋`ops-maturity` 更新。
- 機械検証: doc-check OK・features smoke 6 pass・typecheck/lint（boundary new=0）・`npm test` **828 pass** 全 green。
- **残るは Manual Gate（実機 IME スモーク・ユーザー実施）のみ**。完了後にステータスを完了へ。実機手順:
  1. `bash scripts/dev-start.sh`（または `cd apps/playground && npm run dev`）で Vite 起動。
  2. ブラウザーで `http://localhost:5885/react-standalone.html`（dev-start 時）を開く。
  3. r0/col-a セルをダブルクリック→**日本語 IME で変換確定**→ステータスバーの cell-commit 件数が増える（onCellCommit 発火）。
  4. DevTools Console で `__reactStandalone.reinject({rows:[{rowId:'r0',cells:{'col-a':'再注入'}}]})` → 表示が変わる（ref.setData）。
  5. `__reactStandalone.unmount()` → `__reactStandalone.mount()` を数回 → 描画が正常・重複や残留がない（StrictMode/leak）。

### 2026-07-16（Manual Gate 実機OK → 完了）
- 実機 React ハーネス（http://localhost:5885/react-standalone.html）で確認 → **挙動正常・console にエラー/警告が一切出ない**（StrictMode 含む）。
- 全 Phase 完了・全 AC 充足。ステータス **完了**。アーカイブへ。

---

## DA批判レビュー記録

### Phase N DA批判レビュー

**DA観点:** （このPhaseで最も壊れやすいポイントは何か？）

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | (具体的に記述) | 高/中/低 | (高/中: 操作→結果) | (どのDA観点で発見したか) | ✅修正済/⏭️別DD/❌不要 |
