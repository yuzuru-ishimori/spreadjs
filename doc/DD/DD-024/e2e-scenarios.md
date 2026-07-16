# DD-024 単独グリッドモード E2E シナリオ

> Phase 3 E2E の「正解」。決定①〜③・contract を前提に自然言語で記述（前提条件→操作→期待結果）。
> 配置: `apps/playground/e2e/standalone.spec.ts`（Facade を workspace 経由で使う軽量ハーネス。共同編集サーバー不要）。
> `standalone.html` + `standalone-main.ts`（playground の単独モード consumer）を対象にする。
> AC5 の再mountリークは `standalone-lifecycle.spec.ts`（instrumentation で WS/rAF/interval/DOM を外部観測）。

## E2E #1 — 単独 mount・初期注入（AC1・AC2）

- 前提: 同期サーバーを一切起動しない。`standalone.html` を開く（mode='standalone'・columnOrder 指定・initialData で数行）。
- 操作: ページロード → grid の初回描画完了を待つ（debug `ready()`）。
- 期待:
  - グリッドが描画され、行数 = initialData の行数。
  - initialData の指定セル値が表示される（debug `displayCell`）。
  - `connectionState()` が `'standalone'`。
  - error/connection/pending/divergence イベントが 1 件も発火していない（consumer が記録した events を確認）。
  - mount 後に `setData` で別データを再注入 → 新しい行数・セル値へ更新される（決定③ 再注入）。

## E2E #2 — IME 入力 → cell-commit（AC3）

- 前提: #1 と同じ standalone ページ。
- 操作: body セルをダブルクリックで編集開始 → synthetic composition で日本語文字列を入力し Enter 確定（consumer-app helpers の composeCommit 同型）。
- 期待:
  - `cell-commit` イベントが 1 件発火し、changes[0] の rowId/columnId が編集セル、value = 入力文字列、previousValue = 旧値。
  - グリッド表示が確定値へ更新される（debug `displayCell`）。
  - connection 系イベントは発火しない。

## E2E #3 — 保存 → F5 復元（AC4）

- 前提: standalone consumer が cell-commit を localStorage（利用側 API のモック）へ保存し、次回ロード時 initialData として再注入する実装。
- 操作: セルへ値を入力・確定（cell-commit 保存）→ ページ reload（F5 相当）。
- 期待: reload 後、保存した値が initialData 経由で復元表示される（利用側保存 → 復元の round-trip）。

## E2E #4 — destroy → 再mount リーク（AC5）

- 前提: `standalone-lifecycle.spec.ts`。WS/rAF/interval/DOM を addInitScript で計装。
- 操作: mount → ready → destroy → 再mount を N サイクル反復。
- 期待:
  - 各サイクルで canvas=2・textarea=1・stage=1、destroy 後は 0。
  - rAF ループ・interval が destroy で 0 になり、単調増加しない。
  - standalone は WS を一切生成しない（openSockets 常に 0・totalSockets 0）。

## AC6（共同編集専用面の off・fail-fast）

- unit（mount-controller/options 検証）でカバー: standalone に serverUrl 混在 → config error（standalone-options-conflict）。columnOrder 空 → standalone-options-invalid。standalone で connection 系イベント非発火。
</content>
