# DD-025 React Facade（@nanairo-sheet/react） — Codex レビュー依頼

## 背景・目的

React アプリから Nanairo Sheet を使う公開面 `@nanairo-sheet/react`（`<NanairoSheetView>`）を新設する DD。grid Facade（`@nanairo-sheet/grid`・DD-024 で判別 union の `GridMountOptions`・`cell-commit` イベント・`GridInstance.setData` を確定済み）の **薄い写像** に徹し、**グリッド内部状態を React state へ複製しない**（憲章 §11.2）。最初の実 consumer は housing-e-kintai-next（React 19.2・DD-026）。

## ユーザー合意済みの決定（Human Spec Gate 通過・変更不可）

- **D-① props = 案a フラット判別 union**: `mode` を判別子に props 型自体を union 化。standalone props に `serverUrl` を出さない（型排他を props でも維持）。`columnOrder` は grid 名を踏襲、初期レイアウトは `initialColumnWidths`/`initialRowHeights` に改名して露出。
- **D-② 命令 API = 案a ref handle**: `useImperativeHandle` で `setData`/`focus`/`connectionState` のみ公開。`GridInstance` 本体は出さない。
- **D-③ props 変更 = 3 分類・識別系は自動 remount**: 識別系（mode/serverUrl/columnOrder/wrapColumns/documentId/displayName/clientId）変更=destroy→mount／初期値系（initialData/initialColumnWidths/initialRowHeights）=初回のみ有効＋以後は無視＋診断 warn／callback 系=ref 差し替えのみ。識別系の配列は**値の浅い比較（JSON 直列化キー）で毎 render 新規リテラルを吸収**。
- **D-④ react peer = `^19.0.0`**（react-dom は peer 非対象）。
- **D-⑤ 配布本体は `.ts`**（`.tsx` を避け createElement で container を返す・Vite 変換依存を作らない）。

契約の正本: `doc/DD/DD-025/react-facade-contract.md`。シナリオ: `doc/DD/DD-025/scenarios.md`。

## 最重要レビュー観点（優先順）

1. **StrictMode 二重 mount / lifecycle の leak-free 性**（最重要）: `useEffect`（deps=[mountKey]）で `mount()`→cleanup で `destroy()`。StrictMode（dev）の mount→cleanup→mount で購読重複・canvas/textarea 残留・grid instance leak が無いか。effect の cleanup 順序と `instanceRef` の null 管理は正しいか。
2. **識別系の remount 判定（mountKey）**: `mountKeyOf` の JSON 直列化が「識別系のみ」を過不足なく含むか。配列（columnOrder/wrapColumns）を毎 render 新規リテラルで渡しても値同一なら remount しない一方、値が変われば確実に remount するか。誤って初期値系・callback 系を含めて過剰 remount していないか。
3. **callback 差し替えの stale closure 回避**: `callbacksRef` を毎 render 更新し、`options.onEvent` 1 本の購読から最新参照を呼ぶ設計。差し替えで remount しない一方、常に最新 callback が呼ばれるか。`pending` イベントに直近 connection state を補う `lastConnStateRef` の扱い。
4. **React state 複製の不在（憲章 §11.2）**: 文書データ・レイアウト・接続状態を React state/props に保持していないか。再注入は ref.setData 一択で、コンポーネントが値を持たない設計になっているか。
5. **event→callback 写像の正しさ**: GridEvent 全種別（cell-commit/layout/error/connection/pending/rejected/divergence）の分配。rejected/divergence を専用 callback にせず `onEvent` 素通しに留めた判断（Alpha は通知まで）は妥当か。
6. **初期値系変更の無視＋warn**: `initialKeyOf`/`mountedInitialKeyRef` による「remount 時は warn せず、mount 固定後の変更のみ warn」判定に、effect 実行順序起因の誤検知・warn 漏れが無いか。
7. **境界（R7）・型排他**: 公開シグネチャに grid 内部型を出さず（grid 公開型の参照のみ・再エクスポートしない）、standalone props リテラルに serverUrl を書くとコンパイルエラーになる型排他が効くか。
8. **E2E の妥当性**: GridInstance を隠蔽したまま、onCellCommit.previousValue の round-trip と固定座標クリック（r0/col-a=（92,35））で初期注入/再注入の landed を検証する手法に穴が無いか。synthetic composition と実 IME の乖離（Manual Gate で補完）。

## 変更ファイル

- `packages/react/package.json`（新規・name=@nanairo-sheet/react・peerDependencies=react ^19.0.0・deps=@nanairo-sheet/grid）
- `packages/react/tsconfig.json`（新規）
- `packages/react/src/index.ts`（新規・`NanairoSheetView`/`NanairoSheetViewHandle`/props 判別 union/写像/remount/warn）
- `packages/react/src/nanairo-sheet-view.test.ts`（新規・jsdom・grid mount モック・11 テスト）
- `package.json`（root・react/react-dom/@testing-library/react/jsdom/@types を devDependencies へ集約）
- E2E: `apps/playground/{react-standalone.html, src/integration/react-main.ts, e2e/react-facade-helpers.ts, e2e/react-facade.spec.ts, e2e/react-facade-lifecycle.spec.ts}`・`apps/playground/package.json`（react/react-dom/@nanairo-sheet/react 追加）

## 機械検証状況

typecheck ✅ / lint（eslint＋lint:boundary 新規境界違反 0・react は policy に Facade 既登録）✅ / `npm test` **825 pass**（既存 814＋新規 react 11）／playground E2E **22 pass**（既存 18＋新規 React 4）。

## 責務境界（roadmap §6・憲章 §11.2）

React Facade は lifecycle と props/event 変換のみを担当。認証・保存・サーバー状態管理（react-query/zustand 等）は全面的に利用側（DD-026）。grid 内部状態を React state へ複製しない。
