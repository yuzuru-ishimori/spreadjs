# PoC資産台帳（DD-002〜006 → Stage 1 SDK Alpha）

> **正本**: DD-009（基盤判断DD）Phase 1 の成果物。DD-002〜006（PoC-A〜D＋統合）が生んだ全資産を
> **Adopt / Harden / Rewrite / Discard** に分類し、各資産に「採用方針・抽出先package（論理名）・担当DD・完了条件」を付す。
> **本DDは方針のみを確定**する。実抽出（`packages/*` への実移動）は各担当DD（DD-010〜022）が行い、
> DD-018（Stage 1移行判定）で「Adopt/Harden 対象が `apps/playground` 等に残っていないこと」を機械確認する（S1-1）。
> package論理名の定義・現行 `sheet-*` との対応・rename時期は `package-boundary.md` を正とする（本台帳の「抽出先」列は論理名で記す。実rename は DD-011）。

## 分類語彙の定義

| 分類 | 意味 | 実抽出の扱い |
|------|------|------------|
| **Adopt** | 製品基盤として**ほぼそのまま採用**（軽微な整理のみ）。設計・不変条件は妥当と判断 | 担当DDが package へ移設（大改修なし） |
| **Harden** | 方向性は採用するが**製品品質へ硬化が必要**（境界整理・API固定・不変条件スイート化・型/公開面調整） | 担当DDが硬化しつつ package へ移設 |
| **Rewrite** | 発想・検証結果は活かすが**実装は書き直す**（PoC 用の割り切りが製品に載らない） | 担当DDが仕様参照のうえ再実装 |
| **Discard** | 製品には**載せない**（PoC 専用デモ・旧実装の後継が別にある・計測専用で製品対象外） | 移設しない（`apps/` に残置 or 削除は担当DD判断） |

> 「Discard」は**価値がない**の意ではない。PoC としての役目を終えた／後継資産があるものを指す。CG-1（実機IME trace）等、
> Discard 資産でも**証拠・仕様の出所**として参照し続ける場合は完了条件へ明記する。

## 論理名 ↔ 現行 package 対応（要点・詳細は package-boundary.md §2）

| 論理名（目標） | 現行 | 種別 |
|---|---|---|
| `@nanairo-sheet/types` | `packages/sheet-types` | 内部 |
| `@nanairo-sheet/core` | `packages/sheet-core` | 内部 |
| `@nanairo-sheet/collab` | `packages/sheet-collaboration` | 内部 |
| `@nanairo-sheet/server` | `packages/sheet-server-core` | 内部 |
| `@nanairo-sheet/formula` | `packages/sheet-formula`（Stage 2） | 内部 |
| `@nanairo-sheet/selection` | 新規（playground から抽出） | 内部 |
| `@nanairo-sheet/render` | 新規（playground `pocb/` から抽出） | 内部 |
| `@nanairo-sheet/ime` | 新規（playground `ime/` から抽出） | 内部 |
| `@nanairo-sheet/grid` | 新規（`apps/collaboration-server` 相当なし／統合資産を昇華） | **Facade（Stage 1）** |
| `@nanairo-sheet/server-hono` | `apps/collaboration-server` を昇華 | **Facade（Stage 1）** |
| `@nanairo-sheet/element` | 新規 | Facade（**Stage 2**） |
| `@nanairo-sheet/react` | 新規 | Facade（**Stage 2**） |

> 実 rename（`sheet-*` → 論理名）は **DD-011（基盤実装DD）で判断・実行**する。本台帳では抽出先を論理名で示すが、
> DD-011 の rename 完了までは現行 `sheet-*` 名が有効（判断と実装を分離）。

---

## A. `packages/*`（DD-003/005/006 で製品パッケージとして確立済み）

| 資産 | 出所 | 分類 | 採用方針 | 抽出先package | 担当DD | 完了条件 |
|---|---|---|---|---|---|---|
| `packages/sheet-types` | DD-001/003 | **Adopt** | ブランド型・ID・共通イベント・公開型。ゼロ依存の土台としてそのまま採用 | `@nanairo-sheet/types` | DD-011（rename）・DD-010（RowId 型追加） | rename 済＋boundary lint 下で green・公開面確定 |
| `packages/sheet-core` | DD-003 | **Adopt** | 文書モデル・Operation・決定論的適用・正準ハッシュ・validate・protocol。共同編集/描画/数式の共通土台 | `@nanairo-sheet/core` | DD-011（rename）・DD-010（index→RowId が apply/document へ波及）・DD-014（snapshot） | RowId keyed で不変条件スイート green・cross-platform hash 一致維持 |
| `packages/sheet-collaboration`（`message-codec.ts` を除く） | DD-003/005 | **Harden** | ClientSession（楽観適用/rollback/replay・Conflict Queue・transport 抽象）。方向は採用、OCC/reconnect を製品品質へ硬化 | `@nanairo-sheet/collab` | DD-013（OCC）・DD-015（reconnect fault injection） | 共同編集/reconnect 不変条件スイート green・randomized test 収束 |
| `packages/sheet-collaboration/src/message-codec.ts` | DD-005 | **Harden（移設）** | JSON境界 codec（`decodeClientMessage` 等）。server-hono/collab 双方が使うため **core へ移設**（Codex P1・境界文書 §3 codec 注記） | `@nanairo-sheet/core` | DD-011（移設）・DD-013 | core 所有・server-hono が逆流せず復号可（R3 回避） |
| `packages/sheet-server-core` | DD-003/005 | **Harden** | 全順序シーケンサー・権威Room・Presence・snapshot。durable ACK・versioned snapshot を製品化 | `@nanairo-sheet/server` | DD-013・DD-014（CG-3）・DD-011（rename） | durable ACK 定義・snapshot+tail replay 一致・fail-fast |
| `packages/sheet-formula` | DD-006 | **Adopt（Stage 2 起動）** | 数式エンジン一式。ゼロ依存で成立済み。**Stage 1 では Facade に載せない**（Alpha 範囲外） | `@nanairo-sheet/formula` | DD-022（Stage 2） | Stage 2 で replay 決定性・固定ID参照を製品化。Stage 1 中は公開面から除外 |
| `packages/*/src/test-support.ts`（collab/server） | DD-003/005 | **Harden** | テストビルダー・in-process ハーネス。不変条件スイート runner（DD-011）の素材 | 各package サブパス | DD-011 | 常設不変条件スイートから参照可能な形へ整理 |

## B. `apps/playground/src/grid/`（PoC-A・DD-002 最小グリッド）

| 資産 | 分類 | 採用方針 | 抽出先package | 担当DD | 完了条件 |
|---|---|---|---|---|---|
| `grid/geometry.ts` | **Harden** | セル座標幾何（CSS px）。基本ロジックは採用、描画/選択と整理 | `@nanairo-sheet/render`（or `selection`） | DD-012 | render/selection の座標基盤として不変条件テスト green |
| `grid/navigation.ts` | **Harden** | セル移動・選択ナビ。選択モデルとして採用・硬化 | `@nanairo-sheet/selection` | DD-012 | selection package の公開面・不変条件確定 |
| `grid/cell-store.ts` | **Discard** | PoC-A の 20×10 index-keyed 最小ストア。後継＝`pocb/chunk-store`＋DD-010 RowId ストア | —（残置） | DD-010 | 後継ストア成立後に不使用化を確認 |
| `grid/grid-view.ts` | **Discard** | PoC-A の 1-Canvas 全再描画。後継＝`pocb` 2レイヤー描画 | —（残置） | DD-012 | `render` 成立後に不使用化を確認 |

## C. `apps/playground/src/ime/`・`sim/`・`ui/`（PoC-A IME・DD-002）

| 資産 | 分類 | 採用方針 | 抽出先package | 担当DD | 完了条件 |
|---|---|---|---|---|---|
| `ime/editor-state-machine.ts` | **Adopt** | DOM非依存 IME 状態機械（§11.2〜11.7）。CG-1 の中核。設計そのまま採用 | `@nanairo-sheet/ime` | DD-012（CG-1） | IME 不変条件スイート green・実機 trace 一致 |
| `ime/ime-editing-session.ts`（`integration/`） | **Adopt** | 状態機械の結線（DOM非依存）。integrated パスの中核 | `@nanairo-sheet/ime` / `grid` | DD-012 | IME 不変条件下で green |
| `ime/event-recorder.ts` | **Harden** | 生IMEイベントレコーダー。CG-1 実機 trace 採取の道具。test-support/dev tool として硬化 | `@nanairo-sheet/ime`（test-support） | DD-012 | 実機 trace 採取・再生手順が CG-1 証拠に接続 |
| `ime/resident-textarea.ts` | **Discard**（暫定確定・Q5・DD-012 で再判断） | DD-002 版 DOM adapter。旧 `grid/cell-store`＋activeCell を駆動。**後継＝`integration/integration-editor.ts`（DD-005 版・ClientSession 正本）** | —（残置 or 素材） | DD-012 | 整合パスへ一本化後に不使用化を確認 |
| `sim/remote-update-simulator.ts` | **Harden（test-support）**（暫定確定・Q6・DD-011/DD-012 で再判断） | リモート更新 dev シミュレーター。実サーバー同期成立後は不要だが §11.7 不変条件テストの駆動に流用可 | test-support | DD-011/DD-013 | 不変条件スイートへ吸収 or 実同期テストで代替 |
| `ui/trace-panel.ts` | **Harden（dev tool）**（暫定確定・Q6・DD-012 で再判断） | 実IME trace 採取 UI（CG-1 採取面）。製品ではなく開発ツールとして維持 | dev tool（package外） | DD-012 | CG-1 trace 採取フローに接続 |

## D. `apps/playground/src/integration/`（DD-005 統合＝ClientSession 正本パス）

| 資産 | 分類 | 採用方針 | 抽出先package | 担当DD | 完了条件 |
|---|---|---|---|---|---|
| `integration/integration-editor.ts` | **Harden** | 常駐textarea×状態機械の DOM adapter。`grid` Facade の編集入力面 | `@nanairo-sheet/grid`（内部は `ime`） | DD-012/DD-016 | mount/destroy・配置・IME 不変条件 green |
| `integration/document-view.ts` | **Adopt** | ClientSession→Canvas 読み取りアダプター（第二CellStore を作らない #2） | `@nanairo-sheet/grid`（`render` 連携） | DD-012 | 単一正本原則維持・書込禁止 throw 維持 |
| `integration/commit-bridge.ts` | **Adopt** | draft→SetCells 純関数（cell-level beforeRevision #3/#7） | `@nanairo-sheet/grid` / `collab` glue | DD-012/DD-013 | OCC 不変条件下で green |
| `integration/session-sync.ts` | **Adopt** | transport↔session↔view 結線（session 適用後に描画・#2） | `@nanairo-sheet/grid` | DD-013 | 適用順序保証・catch-up 再収束 green |
| `integration/browser-transport.ts` | **Harden** | ブラウザ native WebSocket transport。`grid`/`server-hono` の client 側 | `@nanairo-sheet/grid`（transport） | DD-013 | reconnect/idempotency 契約に接続 |
| `integration/editor-placement.ts` | **Adopt** | textarea 配置幾何（ViewportTransform）。scroll 追従 AC3 | `@nanairo-sheet/grid` | DD-012 | 配置不変条件テスト green |
| `integration/presence-adapter.ts` | **Adopt（Alpha後拡張 DD-019 起動）** | Presence 変換（RowId/ColumnId→表示index）。Presence は Alpha 必須外 | `@nanairo-sheet/grid`（`server` 連携） | DD-019 | Stage 1 では公開面から除外・DD-019 で起動 |
| `integration/initial-load-metrics.ts` | **Harden（計測ハーネス）**（暫定確定・Q4・DD-012 で再判断） | 初期ロード計測（合否でなく記録）。DD-012 統合性能ゲートの計測に流用可 | 計測ハーネス（package外） | DD-012 | 5万行 scroll/selection 回帰計測に接続 |
| `integration/main.ts` ＋ `poc-integration.html` | **Rewrite（grid Facade素材）**（暫定確定・Q1・DD-016 で再判断） | 統合PoC コントローラ＋統合ページ。**`grid` Facade の実装素材**として発想/結線を活かし書き直し。デモページ自体は Discard | `@nanairo-sheet/grid`（実装素材） | DD-012/DD-016 | Facade `grid` の mount/destroy・Command/Event/Options として再実装 |

## E. `apps/playground/src/pocb/`（PoC-B Canvas・DD-004）

| 資産 | 分類 | 採用方針 | 抽出先package | 担当DD | 完了条件 |
|---|---|---|---|---|---|
| `pocb/base-layer.ts`・`overlay-layer.ts` | **Harden** | Canvas 2レイヤー描画（§12）。製品描画基盤として硬化 | `@nanairo-sheet/render` | DD-012 | 5万行描画・キャッシュの回帰ゲート green |
| `pocb/viewport.ts`・`scroll-anchor.ts`・`dpi.ts`・`axis.ts` | **Harden** | 仮想スクロール・アンカー・高DPI・Axis。描画基盤の一部 | `@nanairo-sheet/render` | DD-012 | scroll/selection 統合性能ゲート green |
| `pocb/text-cache.ts`・`render-scheduler.ts` | **Harden** | テキスト計測キャッシュ・描画スケジューラ。性能予算の要 | `@nanairo-sheet/render` | DD-012 | Canvas 描画キャッシュ回帰計測に接続 |
| `pocb/selection.ts` | **Harden** | 選択モデル（範囲）。`grid/navigation` と統合 | `@nanairo-sheet/selection` | DD-012 | selection package として不変条件 green |
| `pocb/chunk-store.ts` | **Harden** | チャンク化セルストア（ADR-0011）。**index→RowId 移行は DD-010** | `@nanairo-sheet/core`/`collab`（文書表現） | DD-010（CG-2） | RowId keyed・serialization・replay 整合 green |
| `pocb/data-gen.ts`・`prng.ts` | **Harden（test-support・正本）**（暫定確定・Q7・DD-011 で再判断） | 決定論データ生成・PRNG。テスト/計測の共通土台。**この2つを決定論生成の正本**とし、`pocd-bench` 側の重複はこれへ寄せて一意化 | test-support（正本） | DD-011 | 決定論生成の正本を1本化（`pocd-bench` の重複を参照へ置換） |
| `pocb/metrics.ts` | **Harden（計測ハーネス）**（暫定確定・Q4・DD-012 で再判断） | 描画計測。性能回帰ゲートに流用可 | 計測ハーネス（package外） | DD-012 | 性能回帰計測に接続 |
| `pocb/presence-sim.ts` | **Discard** | Presence シミュレーター。後継＝`integration/presence-adapter`（実サーバー Presence） | —（残置） | DD-019 | 実 Presence 成立後に不使用化 |
| `pocb/harness.ts`・`pocb/main.ts` ＋ `poc-b.html` | **Discard** | PoC-B デモページ制御。検証用デモ | —（残置） | — | 描画抽出（DD-012）後にデモとして残置/削除 |

## F. `apps/collaboration-server/`（DD-005 WSアダプター）

| 資産 | 分類 | 採用方針 | 抽出先package | 担当DD | 完了条件 |
|---|---|---|---|---|---|
| `server.ts`（Hono+node-server+ws） | **Harden** | 実WSサーバーアダプター。**`server-hono` Facade の中核**（Stage 1 最小経路） | `@nanairo-sheet/server-hono` | DD-016/DD-017 | Facade export・接続lifecycle・heartbeat/TTL・再現build |
| `client-session/ws-transport.ts` | **Harden** | Node ws client transport。共同編集/reconnect テストと server-hono client 側 | `@nanairo-sheet/server-hono`（or collab test） | DD-013/DD-015 | reconnect/idempotency 契約テスト green |
| `ws-frame.ts` | **Adopt** | WS フレームヘルパー | `@nanairo-sheet/server-hono` | DD-016 | Facade 内部util として移設 |
| `seed-dataset.ts` | **Discard** | 開発用 seed データ | —（dev tool） | — | 製品には載せない |
| `server.smoke.test.ts` | **Harden** | WS smoke。contract test 骨格（DD-011）の素材 | contract test | DD-011/DD-016 | API contract test へ昇格 |
| `test/protocol-contract.test.ts` | **Harden** | protocol contract 検証。**API contract test 骨格の中核素材**（§2.3 公開API不変条件） | contract test | DD-011/DD-013 | protocol/schema version・破壊的変更検出の contract test へ昇格 |
| `test/convergence.test.ts`（＋`test/doc-compare.ts`） | **Harden** | 収束（server order↔client hash 一致）検証。共同編集不変条件スイートの素材 | 不変条件スイート | DD-011/DD-013 | randomized 収束テストとして常設スイート化 |
| `test/restart-restore.test.ts` | **Harden** | サーバー再起動→snapshot+log 復旧検証。CG-3 の素材 | 不変条件スイート | DD-011/DD-014（CG-3） | versioned snapshot 復元一致テストへ昇格 |
| `test/ws-convergence.smoke.test.ts` | **Harden** | 実WS 2クライアント収束 smoke。consumer harness/統合テストの素材 | consumer harness | DD-011/DD-016 | 独立 consumer 上の収束 e2e へ再構成 |

## G. `apps/playground/e2e/`（Playwright E2E・DD-002/005）

| 資産 | 分類 | 採用方針 | 抽出先package | 担当DD | 完了条件 |
|---|---|---|---|---|---|
| `e2e/synthetic-composition.spec.ts`・`basic-operations.spec.ts`・`regression.spec.ts`・`integration-scenario.spec.ts`（＋helpers） | **Harden** | IME/統合の E2E。consumer harness（DD-011）・Facade 統合テスト（DD-016）の素材。**synthetic と実IME を混同しない**注記を維持 | consumer harness / grid e2e | DD-011/DD-016 | 独立 consumer 上の E2E として再構成 |

## H. `apps/pocd-bench/`・`apps/pocd-browser-bench/`（PoC-D 計測・DD-006）

> ADR-0022 で「計測ツールは製品パッケージ対象外」と明記済み。ただし DD-012（5万行 scroll/selection 性能回帰ゲート）と
> CG-6（精密メモリ計測）は**計測ハーネスの再利用**が有効なため、Discard（製品）か Adopt（計測ハーネスとして維持）かを要確認とする。

| 資産 | 分類 | 採用方針 | 抽出先package | 担当DD | 完了条件 |
|---|---|---|---|---|---|
| `apps/pocd-bench/*`（CellStore 4実装比較・bench・replay計測） | **Adopt（perf harness・製品外）**（暫定確定・Q2・DD-012 で再判断） | 製品には載せない（ADR-0022）。DD-012 の性能回帰ゲート・DD-010 の replay 整合計測の**計測ハーネスとして維持**。内蔵 data-gen は Q7 の正本（`pocb/data-gen`）へ寄せる | 計測ハーネス（`apps/` 残置） | DD-010/DD-012 | 性能回帰ゲートの計測手順に接続・data-gen を正本参照へ置換 |
| `apps/pocd-browser-bench/*`（500k セル browser 実測・`performance.memory`） | **Adopt（CG-6 harness・製品外）**（暫定確定・Q3・DD-012 で再判断） | 製品外。**CG-6 精密メモリ計測**の実測ページとして維持（`performance.memory` 封鎖回避） | 計測ハーネス（`apps/` 残置） | DD-012（CG-6） | CG-6 解除証拠の計測に接続 |

---

## 際どい分類 Q1〜Q7（暫定確定・各抽出担当DDで再判断可）

> **ステータス: 暫定確定**（ユーザー決定 2026-07-12 =「暫定推奨で確定・各抽出担当DDで見直す」）。
> Adopt/Harden/Discard の境界が割れる資産は、下表の**暫定推奨を本分類として確定**し台帳本体へ反映済み。
> 各行の「再判断DD」が抽出時に実データ（計測結果・実装知見）を見て**分類を見直してよい**（DD-009 で永久固定しない）。
> 再判断で分類が変わった場合は、その担当DDが本台帳の該当行と本表を更新する。

| # | 資産 | 確定分類（暫定） | 対立候補 | 判断根拠（暫定選択の理由） | 再判断DD（見直しの契機） |
|---|---|---|---|---|---|
| Q1 | `integration/main.ts`＋`poc-integration.html`（playground 統合ページ） | **Rewrite（grid素材）** | Discard | 結線・IME×共同編集の設計は Facade `grid` の設計図として価値が高い。ページ自体は PoC デモ | **DD-016**（Facade/実consumer統合＝grid 設計時）。main.ts を仕様参照するか白紙設計かを判断 |
| Q2 | `apps/pocd-bench`（CellStore 計測CLI） | **Adopt（perf harness・製品外）** | Discard | DD-012 5万行ゲート・DD-010 replay 計測で再利用価値。ADR-0022 で製品外明記 | **DD-012**（5万行 scroll/selection 性能回帰ゲート構築時）。流用 or 計測作り直しを判断 |
| Q3 | `apps/pocd-browser-bench`（browser メモリ計測） | **Adopt（CG-6 harness・製品外）** | Discard | CG-6 精密メモリ計測の実測面として直接使える | **DD-012**（CG-6 精密メモリ計測時）。流用 or 作り直しを判断 |
| Q4 | `initial-load-metrics.ts`・`pocb/metrics.ts`（計測ハーネス） | **Harden（計測ハーネス）** | Discard | 性能回帰ゲート（§2.3 L4）に流用可。計測は「製品コード」ではない | **DD-012**（統合性能回帰ゲート構築時）。test-support か package外 harness か位置づけ確定 |
| Q5 | `ime/resident-textarea.ts`（DD-002 版 DOM adapter） | **Discard** | Harden | DD-005 `integration-editor` が後継。standalone 版固有ロジックの要否は抽出時に確認 | **DD-012**（単一利用者IME縦切りDD）。integration-editor へ一本化後に不使用化確認 |
| Q6 | `sim/remote-update-simulator.ts`・`ui/trace-panel.ts`（dev tools） | **Harden（test-support/dev）** | Discard | §11.7 不変条件テスト駆動・CG-1 trace 採取に有用 | **DD-011**（不変条件スイート runner へ吸収）／**DD-012**（trace-panel を CG-1 trace 採取フローへ） |
| Q7 | `pocb/data-gen.ts`・`prng.ts`（正本）↔ `apps/pocd-bench` data-gen（重複） | **Harden（正本一意化）** | 片方 Discard | 決定論生成が2箇所に重複。テスト再現性の正本を1本化。**暫定正本＝`pocb/data-gen`＋`prng`**（render/統合/計測から広く参照される側）、`pocd-bench` の重複はこれへ寄せる | **DD-011**（test-support 整備時）。正本の最終確定と重複解消を実施 |

## 機械検証（AC1 / タスク Phase 1 🔬）

- 分類セル（Adopt/Harden/Rewrite/Discard を含む行）が全資産行に存在し、分類が空欄・保留表記のセルが 0。
- 検証コマンド（A〜H の資産表を対象・本節は分類方法論のため除外）:
  `grep -cE '(Adopt|Harden|Rewrite|Discard)' doc/DD/DD-009/poc-asset-ledger.md` が資産行数以上（実測 60+ 件）。
  各資産行はいずれかの分類語彙を必ず含む（要確認行は「暫定＋対立候補」の両方を明記）。
</content>
