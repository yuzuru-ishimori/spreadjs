# Codex レビュー依頼 — DD-016-1「Facade実装・物理抽出」（effort: xhigh）

## 目的・スコープ

Stage 1 SDK Alpha の公開面をコード確定する。①主要 Facade（`@nanairo-sheet/grid`・`@nanairo-sheet/server-hono`）の公開 API を Experimental 0.x で固定、②ime/selection/render の物理抽出＋Facade 配線＋boundary baseline 縮退（担当31）、③apps を Facade 経由へ書換え。**挙動保存**（描画・IME・同期挙動を変えない）が最重要制約。

正典: `doc/plan/phase1-dd-roadmap.md`（§4/§6/§7）・境界文書 `doc/archived/DD/DD-009/package-boundary.md` §4/§5・`doc/DD/DD-016-1/phase1-api-design.md`（公開API設計）・`doc/DD/DD-016-1/phase2-extraction-plan.md`（抽出計画）。

## 確定した公開 API（ユーザー承認済 2026-07-14・D1〜D5）

- **grid**: `mount(target:{container},options):GridInstance`（sync 返却・boot は内部非同期）。`GridInstance`＝`documentId/connectionState()/subscribe()→unsubscribe/focus()/destroy()`。`GridEvent`＝connection/pending/rejected/divergence/error（内部 `SessionEvent` を写像・R7）。`GridConflict`＝operationId/reason/code のサマリのみ（D3）。columnOrder は未指定なら /config 自動取得（D1）。
- **server-hono**: `serve(options?):Promise<ServerInstance>`（async・D2）。`ServerInstance`＝port/url/documentId/connectionCount()/stop()。内部 `SnapshotData`/`RecoveryReport`/restoreFrom/integrationDataset は非公開（R7）。

## 主な変更（すべて未コミット作業ツリー）

1. **新規内部 package**: `selection`（pocb/selection）・`ime`（editor-state-machine＋geometry＋navigation＋event-recorder）・`render`（pocb/* の描画群）。geometry/navigation は **ime 内**へ置き boundary DAG（policy.mjs）は無改変（ime は core/types のみ許可・実際は依存ゼロ）。
2. **grid Facade 実装**: 統合 glue（integration-editor・ime-editing-session・document-view・session-sync・browser-transport・commit-bridge・presence-adapter・editor-placement・initial-load-metrics）を grid/src へ移設し、`mount-controller.ts`（旧 integration/main.ts の配線を昇華）＋`dom-scaffold.ts`（container 内に Canvas/scroller/textarea 構築）＋`index.ts`（公開API）＋`test-support.ts`（E2E introspection・boundary 除外）＋`internal.ts`（debugRegistry WeakMap）を新設。
3. **server-hono Facade 実装＋collaboration-server 昇華**: apps/collaboration-server を server-hono へ全面移設（server.ts/seed-dataset/ws-frame＋テスト群）。WS クライアントテストトランスポート（旧 ws-transport.ts）は `test-support.ts`（boundary 除外・collab 依存可）へ。apps/collaboration-server は削除。
4. **apps 書換え**: playground の統合デモ（integration/main.ts）を grid.mount() 一発の consumer へ。**PoC-A/B 標準デモ**（main.ts・pocb/main.ts・grid-view・cell-store・resident-textarea・trace-panel・sim・harness＋対応 E2E spec 3本）を削除（ユーザー承認済・再利用資産と test は package へ移設・git 履歴に保全・roadmap S1-1 と整合）。
5. **boundary baseline 縮退**: 担当31 除去（41→10、残 10=PoC-D throwaway）。new=0。
6. **boundary tooling 精緻化（要精査）**: `scripts/boundary/check.mjs` の **R7 検査を Facade の公開エントリ（src/index.ts）のみに限定**（従来は全 facade ファイルを検査＝glue の内部型 export を誤検出）。R7 の意図＝「公開シグネチャの非漏洩」に一致させた変更。`tests/contract/facade-surface.test.ts` に **公開 .d.ts の内部 package specifier 走査**（R7 型漏洩0）を追加。

## 重点的に見てほしい観点

1. **R7 の正しさ**: (a) check.mjs を src/index.ts 限定にした変更は妥当か（glue を facade package 内に置く設計上、公開面＝index.ts のみ検査が正しいか／抜け穴はないか）。(b) contract test の .d.ts 走査は内部型漏洩を確実に捕捉するか（grid/server-hono 公開宣言に内部 package 型が無いことの検証として十分か）。
2. **挙動保存**: mount-controller.ts は旧 integration/main.ts と等価か（rAF ループ・構造Op anchor 補正・tick/heartbeat・pointer/scroll/dblclick・observer→GridEvent 写像で挙動が変わっていないか）。抽出で DOM 親・focus 順・イベント発火順が変わり IME/E2E が「たまたま green」になっていないか。
3. **resource leak（AC2）**: `GridInstance.destroy()` が RAF/interval/listener(AbortController)/ResizeObserver/WS(browserTransport.close)/textarea(editor.destroy)/scaffold を漏れなく解放するか。boot 進行中の destroy は安全か（destroyed フラグ）。再mountで leak しないか。
4. **公開 API 設計**: GridEvent の SessionEvent 写像（特に rejected→GridConflict サマリ化）で consumer がエラー原因を特定できなくならないか。mount 同期返却＋boot 非同期の contract は健全か。serve async 化は妥当か。
5. **DAG/抽出の妥当性**: geometry/navigation を ime へ置いた判断（render/selection が未使用ゆえ DAG 無改変）に見落としはないか。server-hono の test-support（collab 依存）を boundary 除外で扱う判断は妥当か。

## 実施済み検証

- `npm run test` = **720 pass**（selection3/ime89/render89/grid71/server-hono28＋既存＋invariants）。
- `npm run test:e2e` = **8 pass**（integration-scenario 6・reconnect-headed 1・reload-bootstrap 1＝Facade 経由の実ブラウザー統合）。
- `npm run typecheck`（13 workspace）・`npm run lint`（eslint＋boundary new=0）・`npm run build` green。
- contract R7 .d.ts 走査 green（grid/server-hono 公開宣言に内部 package 型なし）。

findings は仕様一致・R7・挙動保存・resource leak・API 健全性を優先で。到達性×実害で仕分けるため、再現手順（操作→結果）付きで報告してほしい。
