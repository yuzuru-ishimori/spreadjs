# DD-005 統合シナリオ 成立記録（integration-evidence）

> Phase 4（統合 E2E・証跡）の成立記録。統合シナリオ 10 項目＋受け入れ基準 AC1〜4 について、対応する自動 E2E
> テスト名・スクリーンショット・Phase 3 headed smoke 参照・**Phase 5 実機で確認する残項目**を対応づける。
>
> **自動分の限界（§11.8 / §20.5）**: E2E は実 WS サーバー＋2 ブラウザーコンテキスト（Alice/Bob）＋**synthetic
> composition**（`compositionstart/update/end` を dispatch）で駆動する。Playwright/Chromium は OS の実 IME を通せない
> ため、これは「状態遷移・追従・#9 レイアウト・共同編集の収束」の実ブラウザー回帰確認であって **実 IME の成立
> （候補ウィンドウ・確定 Enter 実発火順 A/B・ブラウザー差）ではない**。実 IME の判定は Phase 5 実機ゲートで行う。

## テスト構成

- 実行: `npm run test:e2e`（Playwright・`apps/playground/playwright.config.ts`）。
- webServer（2 本を Playwright が起動）:
  1. Vite（playground・`http://localhost:5199`）— 統合ページ `poc-integration.html` を配信。
  2. 実 WS サーバー（`apps/collaboration-server` の `dev:integration`・`http://127.0.0.1:8799`）— **50,000行×200列** の
     integration seed を投入。E2E は非空セルを `SEED_NONEMPTY=3000` に縮小し初期 replay を軽くする（**行数 50,000 は保持**。
     データ密度検証は DD-004/006 担当・統合PoC は機能成立の検証）。
- 2 コンテキスト = Alice / Bob（別ユーザー）。各コンテキストが同一 WS ドキュメントへ join し、ClientSession（唯一の正本）
  → DocumentView → Canvas / IME の**本番配線**で相互反映する。
- 状態の検証: Canvas 値は DOM から読めないため、`window.__integrationTestApi`（main.ts が公開する **読み取り専用の観測**
  ＋ AC4 の構造Op投入）で ClientSession の committed/hash/pending/conflict/presence/editingTarget 等を確認する。操作は
  実 pointerdown（selectCell）・実 Enter（commit）・実スクロール（DOM）・synthetic composition（textarea へ dispatch）で駆動する。

## 受け入れ基準 AC1〜4

| AC | 内容 | 対応 E2E テスト | 主な assert | 証跡 |
|----|------|----------------|-------------|------|
| AC1 | 通常入力と同期（A 入力・確定→SetCells→B 反映→A/B/サーバー hash 一致） | `AC1: 通常入力の同期` | A 確定後 `pendingCount=0`／A・B の `committedCell` が確定値／`committedHash` が A==B／`committedRevision` 一致／`rowCount≥50,000` | `dd005-p4-e2e-ac1-bob-synced.png`（B の Canvas に A の確定値） |
| AC2 | 同一セル競合（中核）: A 変換中→B 確定→A の Canvas=B 値・draft/selection 不変・#9→A 確定で beforeRevision 不一致 reject→Conflict Queue→収束 | `AC2: 同一セル競合` | A の committed=B 値／A の textarea/draft=A の未確定値（#8）／`isComposing=true`／`editingTarget` 不変／`isConflicting=true`／competition badge に B 値／A 確定後 `conflictCount+1`／最終 `committedHash` A==B・A の値は committed に入らない | `dd005-p4-e2e-ac2-alice-conflict.png`（badge=B 値・textarea=A draft を同時表示・#9） |
| AC3 | Canvas 統合: 変換中に縦横スクロール→textarea が同一 RowId/ColumnId へ追従・値/selection 不変 | `AC3: Canvas 統合` | スクロール後 `editingTarget` 不変・display index 不変・textarea `left/top` が変化（追従）・`display=block`（可視）／`value`・`selectionStart/End`・`isComposing` 不変（#8） | `dd005-p4-e2e-ac3-scroll-follow.png`（スクロール後も同一セルへ追従した textarea） |
| AC4 | 構造変更: ①行挿入で編集継続（RowId 安定）②行削除で draft 退避（無効 RowId へ Commit しない） | `AC4-a: 行挿入で編集継続` / `AC4-b: 行削除で draft 退避` | ①挿入後 `rowCount+1`・`rowIndexOf(editRowId)+1`（RowId 追従）・`editingTarget`/`draft`/`isComposing` 不変・`isConflicting=false`（挿入は競合にしない） ②削除後 `divertedCount=1`・`editingTarget=null`・`rowIndexOf=-1`（tombstone）・stray Enter でも `pendingCount=0`・A の draft は committed に入らない | `dd005-p4-e2e-ac4-insert-continue.png` / `dd005-p4-e2e-ac4-delete-divert.png` |

## 統合シナリオ 10 項目（`doc/plan/phase0-dd-roadmap.md` 正典）

| # | シナリオ | 自動 E2E での成立 | 対応テスト | Phase 5 実機で確認する残 |
|---|---------|-------------------|-----------|------------------------|
| 1 | A が Canvas 上のセルで日本語 IME 変換を開始 | synthetic composition で BeginEdit→Composing（editingTarget＋beforeRevision を凍結） | `AC2` / `AC1` | 実 IME の候補ウィンドウ表示・変換確定操作 |
| 2 | B が同じセルを更新・確定 | B が実 pointerdown 選択＋実タイプ＋実 Enter で commit→server ACK | `AC2`（Bob） | — |
| 3 | A の Canvas へリモート値と競合状態が反映 | A の `committedCell`=B 値・`isConflicting=true`・competition badge に B 値 | `AC2` | 実機での視認（badge/Canvas の同時識別） |
| 4 | A の常駐 textarea と未確定ドラフトは維持 | A の textarea `value`／状態機械 `draft`＝A の未確定値のまま（#8・サーバー値で上書きしない） | `AC2` | 実 IME 変換中の未確定文字列が保持されるか（実機） |
| 5 | A が IME 変換を確定してセルを Commit | synthetic の compositionend→input→確定 Enter→SetCells submit（#7 順序） | `AC2` / `AC1` | 実 IME の確定 Enter **実発火順 A/B**（順序A=isComposing:true のまま／順序B=compositionend 後） |
| 6 | beforeRevision 不一致として競合処理（reject） | 凍結した旧 revision で submit→server `stale-cell-revision`→reject | `AC2` | — |
| 7 | A の入力内容は Conflict Queue に保持 | reject 後 `conflictCount+1`（自分の値を保全） | `AC2` | — |
| 8 | 全クライアントとサーバーの文書状態が収束 | 収束後 `committedHash` A==B・`pendingCount=0`（committed=server 確定＝server とも一致） | `AC1` / `AC2` | — |
| 9 | スクロール中も常駐 textarea が正しいセルへ追従 | 変換中の縦横スクロールで同一 RowId/ColumnId へ追従・値/selection 不変 | `AC3` | 実 IME 変換中の実スクロール追従（候補ウィンドウ含む挙動） |
| 10 | Presence の activeCell・selectionRanges・editingCell が表示 | B の `knownPresences` に A が activeCell/editingCell 付きで届き、overlay に名前タグ＋セル強調を描画 | `Presence` | 実機での複数ユーザー Presence 目視・selectionRanges 範囲選択 |

## Phase 3 headed smoke（主セッション・Playwright MCP・2026-07-12）参照

Phase 4 の自動 E2E に加え、Phase 3 で主セッションが 2 タブ（Alice/Bob・実 WS）で AC2 中核（#9 競合表示・IME draft 保持・
reject→Conflict Queue 収束）と Presence overlay を headed 目視済み。証跡は `dd005-p3-alice-conflict.png`（#9 競合）・
`dd005-p3-alice-presence.png`（Presence）。Phase 2 の headed smoke は `dd005-alice-loaded.png`・`dd005-alice-edit.png`・
`dd005-bob-reflected.png`（50,000行描画・クロスタブ反映）。

## Codex レビュー反映（2026-07-12・xhigh）

Phase 2/3/4 統合差分に対する Codex xhigh レビューで 5 findings（P1×3・P2×2）。**4 件を修正・1 件を一部修正＋残を明記**（詳細は DD 本文ログ「Codex レビュー」節）。
- **[P1] reject 後の Canvas 無効化**（session-sync）: `operationRejected` で cell dirty を立て、rejected draft が Canvas に残らないよう修正。
- **[P1] presence-only メッセージで overlay 再描画**（session-sync）: `presenceSnapshot/Delta/Removed` で viewport dirty を立て、他者カーソル/名前タグを即時反映。→ 上記 Presence スクショは**手動 nudge なし**で overlay 表示（修正の実証）。
- **[P2] Navigation Delete の空クリア**（ime-editing-session）: BeginEdit を経ない Commit を `effect.cell` から解決し submit（no-op を解消）。
- **[P2] selectionRanges の E2E 検証**（Presence テスト）: `selectionRanges` をフックで観測・assert に追加。
- **[P1] 行挿入後の active-cell rebase**（一部修正）: **他者へ publish する presence の activeCell/selection は editingTarget（RowId）由来に修正**（#4）。編集セルへの Commit も editingTarget.rowId で正しい。**残**: ローカル選択ハイライトと Enter 移動先が凍結された状態機械の `activeCell`（表示 index）由来で、同時実行の構造Op中はずれる（下記「既知の制約」）。

## 既知の制約（実装挙動・Phase 5 / DD-007 引き継ぎ）

- **同時実行の構造Op中のローカル選択/移動先ドリフト（Codex P1 の残）**: 他クライアントが編集中に行挿入すると、textarea の追従・Commit 先
  （editingTarget.rowId）・他者へ publish する presence は**正しい**が、`src/ime/editor-state-machine` が所有する `activeCell`（表示 index キャッシュ）は
  再ベースされない。このため**自分のローカル選択ハイライト**と **Enter の移動先**が構造Op のシフト分だけずれる。完全な修正は状態機械へ
  activeCell 再ベース API を足す必要があり、**src/ime は本 Phase の凍結対象**（DA #10）ゆえ見送り。**Phase 1 の共同編集 DD へ引き継ぎ**（DD-007 既知制約）。
  中核 AC（Commit 先・draft 保持・RowId 追従・presence）は不変。
- **AC4 行削除時の実 IME composition 中断**（DA #14）: synthetic では制御できるが、実 IME の候補ウィンドウは JS から確実に
  取消せない。draft の**非破棄退避**（divertedDrafts）は保証済み（自動・ユニット・E2E）だが、変換中断の実挙動は Phase 5 実機で観察する。
- **初期 replay コスト**（#6）: E2E は非空 3,000 に縮小して軽量化した。既定 `dev:integration`（非空 100,000・約 18.3MB replay）の
  計測は `initial-load-metrics.md` を参照（node 実 WS join→収束 897ms・browser toFirstOperable ~1.05〜1.56s）。

## Phase 5 実機ゲートで回収する項目（未了・ユーザー手動）

1. **実 IME トレース**（AC6・DD-002 申し送りの正式回収）: **MS IME×Chrome・Google 日本語入力×Chrome の 2 環境**で統合
   シナリオを実行し、指定記録列（keydown Enter／compositionend／beforeinput／input／keyup Enter／isComposing／状態機械 state／
   textarea.value／active RowId／active ColumnId）を `DD-005/traces/` に保存。
2. **確定 Enter 順序 A/B の実機判定**: synthetic は順序 B 前提（compositionend 後に確定 Enter）で駆動している。実機トレースが
   合成リファレンス（`doc/archived/DD/DD-002/traces/synthetic-reference/`）の前提と一致するか最終確認する（不一致なら
   editor-state-machine へ正式に差し戻す＝DD-002 Phase 6 の教訓）。
3. **実 IME の候補ウィンドウ挙動**: AC1/AC2/AC3 の変換中に候補ウィンドウが表示される実機挙動（synthetic では出ない）。
4. **実機スクロール追従**（AC3）・**実機 Presence 目視**（シナリオ 10）・**AC4 削除時の変換中断**（上記既知制約）。
