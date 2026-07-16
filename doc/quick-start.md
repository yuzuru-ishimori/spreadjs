# Quick Start — @nanairo-sheet Alpha（社内SDK・Stage 1）

新規 consumer が `@nanairo-sheet/grid`（Canvas 描画・共同編集グリッド）と `@nanairo-sheet/server-hono`（同期サーバー）を
組み込み、**serve → mount → 日本語入力**まで到達するための最小手順。実証済み経路は `consumer-app/`（vanilla TS）で、
`bash scripts/consumer-app.sh` が本手順を機械再現する。

> ⚠️ Experimental `0.x`（ADR-0015）。長期後方互換は非保証。破壊的変更は `CHANGELOG.md` に記録する。

## 前提条件

- **Node.js 22 以上**（`engines.node: ">=22"`）。
- **Tier 1 対応環境のみ**: Windows Chrome / Edge（Chromium）。他 OS / ブラウザは対象外・非検証（ADR-0015 D2・CG-4）。
- **TS ビルド環境が必須**: 配布は **TS ソース配布**（`main: ./src/index.ts`）。consumer は TS を透過コンパイルできる
  バンドラ（**vite** 等）を用意すること（dist ビルド配布は Stage 2）。

## 1. 配布成果物の取得（pack tarball closure）

private registry は使わない（決定事項A）。SDK 提供側で配布成果物を生成する:

```bash
bash scripts/release/build-release.sh      # typecheck/lint/test → release/ に 9 tarball＋manifest.json
```

`release/manifest.json` に版数・sha256・生成コミット・channel（`alpha`）と install コマンドが記録される。

## 2. install（配布 closure 全 9 tarball を同時に）

`@nanairo-sheet/*` は private・未 publish のため、Facade2（grid・server-hono）＋内部7（core・types・collab・render・
selection・ime・server）＝**9 tarball を同時 install** する（1 つでも欠けると module 解決に失敗する）。
`manifest.json` の `install` フィールドをそのまま使う:

```bash
cd <your-consumer>
npm install --no-save --install-links \
  nanairo-sheet-grid-0.1.0-alpha.0.tgz nanairo-sheet-server-hono-0.1.0-alpha.0.tgz \
  nanairo-sheet-core-0.1.0-alpha.0.tgz nanairo-sheet-types-0.1.0-alpha.0.tgz \
  nanairo-sheet-collab-0.1.0-alpha.0.tgz nanairo-sheet-render-0.1.0-alpha.0.tgz \
  nanairo-sheet-selection-0.1.0-alpha.0.tgz nanairo-sheet-ime-0.1.0-alpha.0.tgz \
  nanairo-sheet-server-0.1.0-alpha.0.tgz
```

> consumer は**公開 Facade だけ**を import する（内部 package・`@nanairo-sheet/*/test-support`・source path 直接参照は禁止＝S1-3）。

## 3. serve（同期サーバー）

```ts
import { serve } from '@nanairo-sheet/server-hono';

const server = await serve({
  port: 8790,
  // onDiagnostic は opt-in（既定無出力）。障害切り分け時のみ渡す。
  onDiagnostic: (e) => console.debug('[server]', e.code, e.message),
});
// server.url / server.documentId / server.connectionCount() / await server.stop()
```

## 4. mount（グリッド）と日本語入力

**size 済みの container**（幅・高さを持つ要素）へ mount する。`serverUrl` は必須。

```ts
import { mount, GRID_API_VERSION } from '@nanairo-sheet/grid';
import type { GridEvent } from '@nanairo-sheet/grid';

const container = document.getElementById('app') as HTMLElement; // 幅・高さを CSS で確保しておく

const grid = mount(
  { container },
  {
    serverUrl: 'http://127.0.0.1:8790',
    displayName: 'alice',
    onEvent: (event: GridEvent) => {
      // connection / pending / rejected / divergence / error
      if (event.type === 'error') {
        console.error(`[grid] ${event.code} (${event.phase}): ${event.message}`);
      }
    },
    // debug logging hook（opt-in・既定無出力）
    onDiagnostic: (d) => console.debug('[grid]', d.level, d.code, d.message),
  },
);
grid.focus(); // 常駐 textarea へフォーカス → セルをクリック/ダブルクリックし日本語 IME で入力
// 破棄: grid.destroy();（route 遷移・再表示。再 mount で leak しない）
```

- **セル編集**: セルをクリック（アクティブ化）またはダブルクリック（編集開始）し、日本語 IME で変換・確定。
- **共同編集**: 同じ `serverUrl` へ別 client を mount すると変更が相互反映される。
- **接続状態**: `grid.connectionState()`（`online`/`offline`/`stopped`）または `onEvent` の `connection` イベント。

## 4b. 単独グリッドモード（サーバー不要・DD-024）

共同編集サーバーを立てられない場合（バックエンドが Node 以外・単独入力画面）は **単独グリッドモード**で mount する。
`mode: 'standalone'` を渡すと同期サーバー無しで動作し、**確定値の保存は利用側アプリの責務**（認証・保存・DB 書き込みは全面的に利用側）。
SDK は確定通知（`cell-commit` イベント）と再注入（`setData`）の契約だけを提供する。

```ts
import { mount } from '@nanairo-sheet/grid';
import type { GridEvent, GridStandaloneData } from '@nanairo-sheet/grid';

const container = document.getElementById('app') as HTMLElement;

// 初期データ（例: 利用側 API から取得した行）。値は文字列で渡す（数値/日付は自動解釈）。
const initialData: GridStandaloneData = {
  rows: [
    { rowId: 'r1', cells: { 'col-a': '田中', 'col-b': '120000' } },
    { rowId: 'r2', cells: { 'col-a': '鈴木' } },
  ],
};

const grid = mount(
  { container },
  {
    mode: 'standalone',
    columnOrder: ['col-a', 'col-b', 'col-c'], // 単独モードは /config が無いので必須
    initialData,
    onEvent: (event: GridEvent) => {
      if (event.type === 'cell-commit') {
        // 確定値を利用側 API へ保存する（通知のみ＝grid は書き戻さない）。
        for (const c of event.changes) {
          void fetch('/api/cells', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rowId: c.rowId, columnId: c.columnId, value: c.value }),
          });
          // 保存失敗時は grid.setData(...) で見た目を元へ戻す（利用側の判断）。
        }
      }
    },
  },
);
grid.focus();

// 非同期取得（react-query 等）でデータが届いたら再注入する。
async function reload(): Promise<void> {
  const rows = await fetch('/api/rows').then((r) => r.json());
  grid.setData({ rows });
}
```

- **保存の責務境界**: cell-commit は**通知のみ**。認証・保存・失敗時のロールバック表示は利用側が持つ（`grid.setData` で再注入して復元）。
- **接続状態**: 単独モードの `grid.connectionState()` は `'standalone'` を返す（`connection`/`pending`/`rejected`/`divergence` は発火しない）。
- **fail-fast**: `mode:'standalone'` に `serverUrl`/`displayName`/`clientId` を混在させると `error`（`standalone-options-conflict`）、`columnOrder` 未指定/空は `standalone-options-invalid`。
- **F5 復元**: cell-commit を利用側で保存し、次回 mount の `initialData` として戻せばリロードで値が復元される。

## 4c. React 組み込み（`<NanairoSheetView>`・DD-025）

React アプリには `@nanairo-sheet/react` の **`<NanairoSheetView>`** コンポーネントで組み込む。Facade は lifecycle と
props/イベント変換だけを担い、**グリッドの内部状態を React state へ複製しない**（憲章 §11.2）。文書データは grid が唯一の
真実源で、非同期取得の反映は **ref（`setData`）** で流す（react-query 等）。

- **peer 依存**: `react ^19`（consumer が用意する。`react-dom` は不要＝Facade は render を行わない）。install 時は
  配布 closure に `@nanairo-sheet/react` を加える（`react` は consumer 自身の依存）。

```tsx
import { useRef, useEffect } from 'react';
import { NanairoSheetView } from '@nanairo-sheet/react';
import type { NanairoSheetViewHandle } from '@nanairo-sheet/react';
import type { GridCellCommitChange, GridStandaloneData } from '@nanairo-sheet/grid';

export function OrderGrid() {
  const ref = useRef<NanairoSheetViewHandle>(null);

  // 非同期取得（例: react-query の結果）を effect から再注入する（React state に文書を持たせない）。
  useEffect(() => {
    void fetch('/api/rows')
      .then((r) => r.json() as Promise<GridStandaloneData>)
      .then((data) => ref.current?.setData(data));
  }, []);

  const handleCommit = (changes: readonly GridCellCommitChange[]) => {
    for (const c of changes) {
      void fetch('/api/cells', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rowId: c.rowId, columnId: c.columnId, value: c.value }),
      });
      // 保存失敗時は ref.current?.setData(...) で見た目を戻す（利用側の判断）。
    }
  };

  // 親（#nsheet-host）は幅・高さを CSS で確保しておく（style で container を埋める）。
  return (
    <div id="nsheet-host" style={{ position: 'relative', width: '100%', height: '600px' }}>
      <NanairoSheetView
        ref={ref}
        mode="standalone"
        columnOrder={['col-a', 'col-b', 'col-c']}
        onCellCommit={handleCommit}
        style={{ position: 'absolute', inset: 0 }}
      />
    </div>
  );
}
```

- **props の変更契約（3 分類）**:
  - **識別系**（`mode`/`serverUrl`/`columnOrder`/`wrapColumns`/`documentId`/`displayName`/`clientId`）の変更は
    **自動 remount**（destroy→mount）。配列（`columnOrder` 等）は**値**で比較するので、毎 render 新しい配列リテラルを
    渡しても内容が同じなら remount しない（安定参照が理想だが Facade が吸収する）。
  - **初期値系**（`initialData`/`initialColumnWidths`/`initialRowHeights`）は**初回 mount のみ**有効。mount 後の変更は
    無視され診断 warn が出る。**データ再注入は `ref.setData`**、レイアウト保存は `onLayout`→次回 mount の初期値へ。
  - **callback 系**（`onCellCommit`/`onLayout`/`onConnectionChange`/`onError`/`onEvent`/`onDiagnostic`）は
    remount せず最新参照へ差し替わる（毎 render 新しい関数を渡してよい）。
- **命令 API（ref）**: `setData(data)`（standalone 再注入）／`focus()`／`connectionState()`。`GridInstance` 本体は出さない。
- **共同編集モード**: `mode="collaboration"`（省略時の既定）＋`serverUrl` を渡す。standalone props に `serverUrl` を
  書くと**型エラー**（型で排他）。
- **StrictMode**: `<StrictMode>` 配下の二重 mount/cleanup でもリークしない（内部で mount↔destroy が対で走る）。
- **診断 hook の注意**: `onDiagnostic` は**mount 時に渡していれば**後から差し替え可（最新が呼ばれる）。mount 時に未指定で
  後から付ける場合のみ再 mount（識別系変更）が要る（既定無出力＝性能影響ゼロを保つための仕様）。

## 5. エラーコード・診断

- `GridEvent` の `error` / `rejected` は**安定した公開コード**を持つ（`GRID_ERROR_CODES` / `GRID_CONFLICT_CODES`）。
  一覧と意味は **`doc/DD/DD-017/error-codes.md`**。
- `onDiagnostic`（grid・server-hono とも opt-in・既定無出力）で boot/接続/競合/起動停止の診断ログを採取できる。

## 参考

- 実証アプリ: `consumer-app/`（`consumer-app/README.md`）と `bash scripts/consumer-app.sh`。
- 版・破壊的変更: `CHANGELOG.md`。成熟度・対応環境: `doc/adr/0015-stage1-api-maturity-and-tier1-support.md`。
