# DD-025 React Facade テストシナリオ（Red 起点）

> Phase 2 unit（jsdom・@testing-library/react）と Phase 3 E2E（Playwright・実ブラウザー）の「正解」。
> 前提: DD-024 grid 公開契約（`packages/grid/src/index.ts`）と Phase 1 `react-facade-contract.md` の採用案。
> AC 対応は各見出し末尾に付す。**Human Spec Gate で契約案と同時に合意する。**

## S1 — 初期 render・描画（AC1）〔unit＋E2E #1〕

- 前提: React 19 アプリで `<NanairoSheetView mode="standalone" columnOrder={[...]} initialData={rows} />` を render。同期サーバーは起動しない。
- 操作: mount → 初回描画完了を待つ。
- 期待:
  - container 内に grid（canvas/常駐 textarea）が構築され、行数 = initialData の行数。
  - initialData の指定セル値が表示される。
  - `connectionState()`（handle 経由）が `'standalone'`。
  - error/connection 系イベント（onError/onConnectionChange）が 1 件も呼ばれない。

## S2 — IME 入力 → onCellCommit（AC2）〔E2E #2 synthetic＋Manual Gate 実機〕

- 前提: S1 と同じ standalone render。`onCellCommit` を jest/vi モックで渡す。
- 操作: body セルをダブルクリックで編集開始 → synthetic composition で日本語文字列を入力し Enter 確定。
- 期待:
  - `onCellCommit(changes)` が 1 回呼ばれ、`changes[0]` の rowId/columnId が編集セル・value = 入力文字列・previousValue = 旧値（`GridCellCommitChange` の batch）。
  - グリッド表示が確定値へ更新される。
  - connection 系コールバックは呼ばれない。
  - **Manual Gate**: 実 Chrome の React ハーネスで実 IME（変換候補確定）→ onCellCommit を確認（synthetic と実 IME を混同しない）。

## S3 — callback props 差し替えは非 remount（AC3）〔unit〕

- 前提: S1 render。初回 `onCellCommit={fnA}`。
- 操作: 同一 mount のまま `onCellCommit={fnB}` へ再 render（識別系 props は不変）。次のセル確定を起こす。
- 期待:
  - grid の destroy/mount が発生しない（mount は初回 1 回のみ・subscribe も 1 本のまま）。
  - 確定で呼ばれるのは `fnB`（最新参照）であり `fnA` ではない（内部 ref 保持で stale closure 回避）。

## S4 — ref.setData 再注入・React state 非保持（AC4）〔unit＋E2E #1〕

- 前提: S1 render。`ref` に `NanairoSheetViewHandle` を取得。
- 操作: `ref.current.setData(newData)` を呼ぶ。
- 期待:
  - 表示が newData の行数・セル値へ更新される。
  - コンポーネントは文書データを props/state に保持しない（再 render を伴わずに表示が変わる＝グリッドが唯一の真実源。憲章 §11.2）。

## S5 — StrictMode 二重 mount 耐性（AC5）〔unit＋E2E #3〕

- 前提: `<StrictMode><NanairoSheetView .../></StrictMode>`。
- 操作: dev StrictMode の mount→cleanup→mount を経る（unit は手動で effect 二重発火を模す／E2E は React dev build）。
- 期待:
  - 最終状態で canvas/textarea が重複せず（各 1 セット）、表示・入力が正常。
  - イベント購読が重複しない（1 回の確定で onCellCommit が 1 回だけ）。
  - console error/warn が出ない。

## S6 — unmount → destroy・反復リークなし（AC6）〔E2E #4〕

- 前提: `standalone-lifecycle.spec` 範型で WS/rAF/interval/DOM を計装。
- 操作: mount → ready → unmount → 再 mount を N サイクル反復。
- 期待:
  - 各サイクルで canvas/textarea/stage が生成され、unmount 後は 0。
  - rAF/interval が unmount で 0（単調増加しない）。listener 残留なし。
  - standalone は WS を一切生成しない（openSockets 常に 0）。

## S7 — props 3 分類の変更契約（AC7）〔unit〕

- 前提: S1 render。
- 操作・期待（Phase 1 要確認③ の確定に追随）:
  - **識別系**（例 `columnOrder`）を変更して再 render → grid が destroy→mount（自動 remount）。
  - **初期値系**（例 `initialData`）を変更して再 render → 無視され表示は変わらない＋診断 warn が 1 回（再注入は ref.setData を使う旨）。
  - **callback 系**（S3）→ remount なし差し替え。
