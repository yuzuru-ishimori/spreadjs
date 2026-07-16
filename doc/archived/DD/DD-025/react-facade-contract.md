# DD-025 React Facade 公開契約（react-facade-contract）

> Phase 1 成果物。grid 公開契約（`packages/grid/src/index.ts`・DD-024 確定）の**薄い写像**として
> `@nanairo-sheet/react` の props / callback / ref handle と props 変更時挙動を確定する。
> **Human Spec Gate（要確認①〜④）を通過してから Phase 2 が本文書を「実装の正解」として参照する。**
> 原則: grid の Options/Event を素通しする薄い写像に留め、grid 内部状態を React state へ複製しない（憲章 §11.2）。

## 0. 写像の全体像（3 本の写像）

| grid 公開面 | React Facade への写像 | 方式 |
|-------------|----------------------|------|
| `GridMountOptions`（判別 union） | `NanairoSheetViewProps`（判別 union props） | props（宣言的） |
| `GridEvent`（union） | 個別 callback props ＋ 生 `onEvent` | subscribe 1 本 → 種別分岐 |
| `GridInstance`（handle） | `NanairoSheetViewHandle`（命令 API） | `useImperativeHandle`（ref） |

Facade は effect で `mount()` → `destroy()` を回し、mount 直後に `subscribe()` を 1 本張る（unmount で解除）。
callback props は内部 ref に保持し、最新参照を呼ぶ（差し替えで remount しない）。

---

## 1. props 形状（論点1・**要確認①**）

**採用案 = 案a（フラット判別 union props）**。`mode` を判別子に props 型自体を union にし、standalone props に `serverUrl` を出さない（grid と同じ型排他を props でも維持・§11.2 の利用イメージに合致）。案b（`options` オブジェクト prop 丸ごと）は写像最小だが React 慣行から外れ、部分変更検知が全再 mount に直結するため退ける。

```ts
import type {
  GridStandaloneData, GridCellCommitChange, GridConnectionState,
  GridConflict, GridEvent, GridDiagnosticHook, GridErrorCode,
} from '@nanairo-sheet/grid';

/** 両モード共通 props（描画/レイアウト初期値＋callback＋DOM 属性）。 */
interface NanairoSheetViewCommonProps {
  // --- 初期値系（初回 mount のみ有効・§4 の分類2） ---
  initialColumnWidths?: Readonly<Record<string, number>>;  // grid columnWidths
  initialRowHeights?: Readonly<Record<string, number>>;    // grid rowHeights
  // --- 識別系（mount 固定・変更で remount・§4 の分類1） ---
  wrapColumns?: readonly string[];
  documentId?: string;
  // --- callback 系（ref 保持・差し替えで remount しない・§4 の分類3） ---
  onCellCommit?: (changes: readonly GridCellCommitChange[]) => void;
  onLayout?: (columnWidths: Record<string, number>, rowHeights: Record<string, number>) => void;
  onConnectionChange?: (state: GridConnectionState, pendingCount: number) => void;
  onError?: (error: { phase: 'config' | 'connect' | 'runtime'; code: GridErrorCode; message: string }) => void;
  onEvent?: (event: GridEvent) => void;      // 全種別素通し（診断/将来種別用）
  onDiagnostic?: GridDiagnosticHook;          // grid onDiagnostic に直結
  // --- DOM ホスト ---
  className?: string;
  style?: React.CSSProperties;                // container 要素へ適用
}

/** 単独グリッドモード props（DD-024・standalone）。serverUrl/displayName/clientId を出さない。 */
interface NanairoSheetViewStandaloneProps extends NanairoSheetViewCommonProps {
  mode: 'standalone';
  columnOrder: readonly string[];             // 必須（識別系）
  initialData?: GridStandaloneData;           // 初期値系（初回のみ・再注入は ref.setData）
}

/** 共同編集モード props（mode 省略時は既定 collaboration）。unit まで（実 E2E は既存 12 本で回帰）。 */
interface NanairoSheetViewCollaborationProps extends NanairoSheetViewCommonProps {
  mode?: 'collaboration';
  serverUrl: string;                          // 必須（識別系）
  columnOrder?: readonly string[];            // 省略時は /config 取得
  displayName?: string;
  clientId?: string;
}

type NanairoSheetViewProps =
  | NanairoSheetViewStandaloneProps
  | NanairoSheetViewCollaborationProps;
```

- **型排他**: standalone props リテラルに `serverUrl` を書くと余剰プロパティ検査でコンパイルエラー（grid と同じ静的排他を props 面でも維持）。
- **命名メモ**: 憲章 §11.2 のスケッチは `columns` prop を使うが、grid 公開型は `columnOrder`。**1:1 写像を優先し `columnOrder` を採用**（別名を挟むと写像が薄くなくなる。憲章スケッチは図示用）。初期レイアウトは grid の `columnWidths`/`rowHeights` を「初期値系」の意図が伝わる `initialColumnWidths`/`initialRowHeights` に改名して露出（変更が反映されない契約を名前で示す・§4 分類2）。→ この 2 点は要確認①の一部として確認したい。

## 2. イベントの callback 化（論点2）

grid の `GridEvent`（union）を subscribe 1 本で受け、種別ごとに個別 callback へ分配する。**生 `onEvent` は全種別を素通し**（診断・将来種別の取りこぼし防止）。callback props は内部 ref 保持で最新参照を呼ぶ（S3・差し替えで remount しない）。

| GridEvent.type | 呼ぶ callback | standalone で発火? |
|----------------|---------------|:---:|
| `cell-commit` | `onCellCommit(changes)` | ○（主経路） |
| `layout` | `onLayout(columnWidths, rowHeights)` | ○ |
| `error` | `onError({phase, code, message})` | ○（config/runtime） |
| `connection` | `onConnectionChange(state, pendingCount)` | ×（collab のみ） |
| `pending` | `onConnectionChange(<last state>, pendingCount)`（`<last state>` は **mount 時に `instance.connectionState()` で初期化**し、直近の `connection` で更新・Codex P2） | ×（collab のみ） |
| `rejected` | `onEvent` のみ（conflict は生 event で受ける・Alpha は通知のみ） | ×（collab のみ） |
| `divergence` | `onEvent` のみ | ×（collab のみ） |
| （全種別） | `onEvent(event)` | 常時 |

- `rejected`/`divergence` に専用 callback を作らない理由: Alpha は「競合の通知」保証まで（grid 契約 §5 と同格）で、UI 材料公開は Stage 2。専用 props を今作ると狭い型を後で広げる破壊的変更になりやすい。生 `onEvent` で十分。
- `pending` は state を持たないため直近の接続状態を添えて `onConnectionChange` に集約（別 callback を増やさない）。

## 3. 命令 API（論点3・**要確認②**）

**採用案 = 案a（ref handle）**。`useImperativeHandle` で最小 handle のみ公開し、`GridInstance` そのものは出さない。案b（`data` prop の宣言的再注入）は文書データを React state で持たせる圧＝憲章 §11.2 逆行のため退ける（react-query の取得結果は effect から `ref.setData` で流すのが自然）。

```ts
interface NanairoSheetViewHandle {
  /** 単独グリッドモードの文書丸ごと再注入（grid GridInstance.setData 直結）。collab では no-op＋診断 warn。 */
  setData(data: GridStandaloneData): void;
  /** グリッドへフォーカス（常駐 textarea）。 */
  focus(): void;
  /** 現在の接続状態。 */
  connectionState(): GridConnectionState;
}
```

- 露出しないもの: `GridInstance.subscribe`（Facade が管理）・`GridInstance.destroy`（lifecycle は React が管理）・`documentId`（props 由来のため handle に不要）。handle は「grid にしか出せない命令」だけに絞る。
- mount 前（effect 実行前）に handle メソッドを呼ばれた場合: no-op＋診断 warn（`onDiagnostic` があれば通知）。boot 前 unmount も同様に安全（grid destroy は boot 進行中でも安全＝grid 契約）。

## 4. props 変更時の挙動契約（論点4・**要確認③**）

**採用案 = 3 分類（自動 remount）**。React の宣言的モデルと整合し、DD-026 の画面切替（documentId/columnOrder 差し替え）に追随できる。対案（識別系変更をエラー扱い＝fail-fast）は宣言的モデルと噛み合わず退ける。

| 分類 | 対象 props | 変更時の挙動 |
|------|-----------|-------------|
| **1. 識別系**（mount 固定） | `mode` / `serverUrl` / `columnOrder` / `wrapColumns` / `documentId` / `displayName` / `clientId` | **自動 remount**（destroy → mount）。表示は再構築。編集中の未確定入力は失われる（診断 info） |
| **2. 初期値系** | `initialData` / `initialColumnWidths` / `initialRowHeights` | **初回 mount のみ有効**。以後の変更は**無視＋診断 warn**（「再注入は ref.setData、レイアウトは onLayout→次回 mount」を案内） |
| **3. callback 系** | `onCellCommit` / `onLayout` / `onConnectionChange` / `onError` / `onEvent` / `onDiagnostic` | **remount なし**で内部 ref 差し替え（次イベントから新参照）。`className`/`style` は container へ即反映（remount 不要） |

- **identity 不安定 props の罠（DA・要確認③関連）**: 識別系に配列/オブジェクト（`columnOrder`/`wrapColumns`）を含むため、**毎 render 新規リテラルを渡すと意図せぬ remount**が起きる。remount 判定は「参照 === 比較」ではなく**値の浅い比較**（識別系のみを JSON 直列化した `mountKey`＝`columnOrder`/`wrapColumns` は要素列、スカラは値）で行い、利用側の毎 render リテラルを吸収する。Quick Start に「識別系は安定参照が理想だが、Facade が値比較で吸収する」と明記。
- remount は effect の依存配列に「識別系の値比較キー（mountKey）」を入れて駆動（React の再 mount ではなく Facade 内 destroy→mount）。
- **初期値系の変更検知は参照比較のみ**（Codex P1）: `initialData` は数万行になりうるため mountKey のような JSON 直列化を**しない**。3 つの初期値系 props（`initialData`/`initialColumnWidths`/`initialRowHeights`）の**参照（Object.is）**を mount 時スナップショットと比較し、参照が変われば「変更＝無視＋warn」。利用側が同一オブジェクトを保持すれば毎 render のコストはゼロ。
- **callback ref は commit 後（useLayoutEffect）に更新**（Codex P1）: 最新 callback/props/onDiagnostic の ref 反映は render 中ではなく `useLayoutEffect` で行う。Concurrent React（startTransition/Suspense）で**未 commit の render** が共有 ref を汚し、現行 grid のイベントが破棄された render の callback を呼ぶのを防ぐ。

## 5. peer dependency 範囲（論点6・**要確認④**）

**採用案 = 案a（`react: "^19.0.0"`）**。検証済み範囲のみ宣言する（housing=React 19.2）。18 対応は実需要（例 DD-030 ReadyCrew の stack 確定）をトリガーに拡張＝推測で広げない。`react-dom` は peer に含めない（render は利用側・Facade は jsx-runtime のみ使用）。

```jsonc
// packages/react/package.json（抜粋）
{
  "name": "@nanairo-sheet/react",
  "version": "0.1.0-alpha.0",
  "private": true,
  "dependencies": { "@nanairo-sheet/grid": "*" },   // 内部 Facade のみ（R1）
  "peerDependencies": { "react": "^19.0.0" }         // react-dom は含めない
}
```

- **onDiagnostic の後差し替え**（Codex P2）: callback 系（remount なし差し替え）だが grid の `createDiagnosticSink` は zero-cost opt-in（hook 未指定なら診断を生成しない）。両立のため **mount 時に onDiagnostic があれば最新 ref を読む安定ラッパー**を grid へ渡す（A→B 差し替えは反映）。mount 時に未指定なら undefined を渡し zero-cost を維持する（**未指定→後付けは remount が必要**＝Quick Start に明記）。

## 6. ADR-0022（ゼロランタイム依存）整合（論点7）

- コア原則は不変: `packages/grid` 系は依存ゼロを維持。React Facade の `react` は **peerDependencies**（利用側が既に持つホスト環境の宣言）であり `dependencies` 追加ではない。ADR-0022 の「ランタイム依存を増やさない」に反しない。
- 対応: 本 contract にこの整理を記載（済）。ADR-0022 へ「Facade パッケージは host 環境を peer 宣言してよい（dependencies は増やさない）」の例外注記を追記するかは Phase 2 で判断（Status 更新は別途）。

## 7. 配布形態・consumer ビルド（論点8）

- 現行方式踏襲: TS ソース配布・`private`・dist ビルド切替は DD-031。
- **`.tsx` を避け `.ts` に留める**: エントリは `createElement`/jsx-runtime 呼び出しで実装し `packages/react/src/index.ts` とする（`.tsx` は pack tarball 経由で consumer バンドラ変換前提になり DD-026 Vite consumer の変換設定に依存が漏れる）。JSX 構文糖は使わず `React.createElement`（または `jsx`）で container `<div>` を 1 枚返すだけ＝薄い Facade に十分。
- `main`/`types` は `./src/index.ts`。consumer（Vite）は workspace 経由で TS を直接読む（grid と同方式）。

## 8. テスト/E2E ハーネス配置（論点9）

- **unit**: root へ dev 依存集約（`react`/`react-dom`/`@testing-library/react`/`jsdom`）。`packages/react` の Vitest を `environment: 'jsdom'` で実行（`packages/react/vitest.config.ts`）。
- **E2E**: **`apps/playground` に React ハーネスエントリを追加**（新規 app workspace を作らない＝最小・DD-024 `standalone.html` 先例に倣う）。`apps/playground/react-standalone.html` ＋ `src/integration/react-main.tsx`（StrictMode 有効・localStorage 保存モックで onCellCommit→保存→F5 復元を実演）。E2E は `apps/playground/e2e/react-facade*.spec.ts`。
  - 注: E2E ハーネスのエントリのみ `.tsx` 可（playground consumer 側であり配布物ではない）。配布パッケージ本体（§7）は `.ts` に留める。

## 9. boundary lint（論点10）

- `packages/react` を Facade として `scripts/boundary/` に登録（R1〜R7 検査対象・baseline 追加 0）。
- import は `@nanairo-sheet/grid` のみ（内部 core/collab/render/… 直 import 禁止）。公開シグネチャ（props/handle/callback 型）に内部型を出さない（R7）＝grid 公開型（`GridStandaloneData` 等）と Facade 自前型のみ。

---

## 要確認まとめ（Human Spec Gate）

| # | 論点 | 推奨 | 対案 |
|---|------|------|------|
| ① | props 形状 | **案a フラット判別 union props**（`columnOrder` は grid 名を踏襲・初期レイアウトは `initial*` 改名） | 案b `options` オブジェクト prop 丸ごと |
| ② | 命令 API | **案a ref handle**（`setData`/`focus`/`connectionState` のみ） | 案b `data` prop 宣言的再注入 |
| ③ | props 変更契約 | **3 分類・識別系は自動 remount**（識別系配列は値比較で吸収） | 識別系変更を fail-fast エラー |
| ④ | react peer 範囲 | **`^19.0.0`**（react-dom は peer 非対象） | `>=18 <20` |

いずれも推奨は grid 契約（DD-024）との 1:1 写像・§11.2・DD-026(housing 19.2) を根拠にする。
