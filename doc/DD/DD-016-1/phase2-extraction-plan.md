# DD-016-1 Phase 2: 物理抽出・配線・baseline 縮退 計画（📐 実装前詳細化）

> 親=DD-016 / 子=DD-016-1。Phase 2 の移設単位・依存順・apps 書換え・PoC 標準デモ処遇を確定する。挙動保存（既存 test/E2E/不変条件 green 維持）。

## 1. 依存グラフ（精査結果）

- **`grid/geometry.ts`**（GridLayout/CellPosition/cellKey/cellRect/hitTest/clampCell…）＝**@nanairo-sheet 依存ゼロの純粋グリッド算術**。利用者: `ime/editor-state-machine`＋統合glue（→grid）。**render/selection は未使用**。
- **`grid/navigation.ts`**（keyToDirection/moveActiveCell）＝geometry のみ依存。利用者: `ime/editor-state-machine` のみ。
- **`ime/editor-state-machine.ts`**＝geometry+navigation のみ依存（@nanairo-sheet 非依存）。
- **`pocb/*`**（render 群）: base-layer→{chunk-store,dpi,text-cache,viewport}／overlay-layer→{base-layer,dpi,presence-sim(型 PresenceUser),selection(型 CellRange),viewport}／chunk-store→data-gen(型 GeneratedCell)→prng／viewport・scroll-anchor→{types,axis}。**production 経路（document-view→chunk-store, overlay→PresenceUser/CellRange）が data-gen/presence-sim の型に依存**＝demo と型が絡む。
- **統合glue**（→grid）: integration-editor・ime-editing-session・editor-placement・document-view・session-sync・browser-transport・commit-bridge・presence-adapter・initial-load-metrics・integration/main。collab/core/types/render/selection/ime を使う（全て grid 許可先）。
- **PoC-A 標準デモ**（`apps/playground/src/main.ts`＋grid/grid-view・grid/cell-store・ime/resident-textarea・ime/event-recorder・ui/trace-panel・sim/remote-update-simulator）＝Facade 非使用の単体デモ（DD-002）。geometry へ依存するため geometry 抽出後は apps 残置で R1 化。
- **PoC-B 標準デモ**（`apps/playground/src/pocb/main.ts`＋harness）＝Facade 非使用の単体ベンチ（DD-004）。render 抽出後は apps 残置で R1 化。

## 2. パッケージ別メンバーシップ（依存順: types→core→{selection,ime}→render→collab→grid／server→server-hono）

| package | 許可先 | メンバー（apps からの移設） |
|---|---|---|
| **ime** | core,types | `editor-state-machine.ts`＋**`geometry.ts`**＋**`navigation.ts`**（grid/ から移設）＋各 `.test.ts`（＋CG-1 trace 用 `event-recorder.ts`(+test) を収容） |
| **selection** | core,types | `selection.ts`（pocb/ から）＋`selection.test.ts` |
| **render** | core,types,selection | `base-layer・overlay-layer・viewport・scroll-anchor・dpi・axis・text-cache・render-scheduler・metrics・chunk-store・data-gen・prng・presence-sim`（pocb/ から・production 型を含むため一括）＋各 `.test.ts` |
| **grid**（Facade） | core,types,collab,render,selection,ime | `index.ts`（公開API）＋glue: `integration-editor・ime-editing-session・editor-placement・document-view・session-sync・browser-transport・commit-bridge・presence-adapter・initial-load-metrics`＋新 `mount-controller.ts`（integration/main の配線を昇華）＋`dom-scaffold.ts`（container 内に canvas/scroller/textarea を構築＝D4） |
| **server-hono**（Facade） | server,core,types | `index.ts`（公開API）＋`server.ts` 昇華＋`seed-dataset.ts`＋`ws-frame.ts`（＋`client-session/ws-transport.ts` は collab 依存を精査し collab 依存なら apps 側 or 別処遇＝実装時に確定） |

> geometry/navigation を **ime** へ置くことで **boundary DAG（policy.mjs）は無改変**（ime: core,types のまま・実際は依存ゼロ）。grid は ime を import 可ゆえ glue から GridLayout 等を参照できる。

## 3. PoC-A/PoC-B 標準デモの処遇（**要ユーザー判断**）

抽出で geometry/render が package へ移るため、Facade 非使用の PoC-A/PoC-B **単体デモ**は apps 残置だと内部 package 直 import（R1）になる。選択肢:

- **(a) 削除（推奨）**: PoC-A/PoC-B 単体デモの entry と demo 専用 glue（`apps/playground/src/main.ts`・`pocb/main.ts`・`grid/grid-view.ts`・`grid/cell-store.ts`・`ime/resident-textarea.ts`・`ui/trace-panel.ts`・`sim/remote-update-simulator.ts`・`pocb/harness.ts`＋demo 専用 test）を削除。**再利用資産（editor-state-machine/geometry/navigation/event-recorder/pocb render/selection）とその test は package へ移設**。playground は**統合デモ（Facade 経由）のみ**を残す。→ roadmap S1-1（DD-018 が「apps/playground に primitives 残置なし」を機械確認）と整合・baseline 31 を完全消し込み。PoC-A/B は完了・アーカイブ済（DD-002/004）＝git 履歴に保全。
- **(b) throwaway 再分類**: 単体デモを残し baseline entry を owner=none（PoC 使い捨て・PoC-D と同扱い）へ。デモは残るが baseline に ~2 件（PoC-A main／PoC-B main）が残置＝**AC4「担当31 除去」を緩める**（AC 変更）。

## 4. apps 書換え・baseline 縮退

- `apps/playground`: 統合デモ（現 integration/main.ts）を **`grid.mount()` 一発**へ置換（DOM scaffold は Facade が構築）。残る app コードは Facade のみ import。
- `apps/collaboration-server`: `serve()` を呼ぶ薄い bin へ（server.ts 本体は server-hono へ昇華）。
- `tests/invariants/ime/ime.invariant.test.ts`: import 先を `apps/playground/...` → `@nanairo-sheet/ime`（editor-state-machine/geometry）＋glue は grid の内部 test 参照 or ime へ寄せる（実装時に最小差し替え）。
- `scripts/boundary/baseline.json`: 担当31 を除去（(a) なら 0 件・残 10=PoC-D）。`node scripts/boundary/check.mjs`（new=0）。

## 5. 実装順（buildable を保つ）

1. selection → 2. ime（geometry/navigation/editor-state-machine）→ 3. render → 4. grid glue＋mount → 5. server-hono → 6. apps 書換え → 7. baseline 縮退・invariants import 差し替え → 8. 一括検証（typecheck/lint/test/build/invariants/E2E）→ 9. Codex xhigh。
