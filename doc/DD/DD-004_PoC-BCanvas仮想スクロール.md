# DD-004: PoC-BCanvas仮想スクロール

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-11 | 2026-07-11 | 検討中 | 起票のみ。要確認1〜3の回答待ち |

> アプローチ: 標準（計測中心のPoC）＋TDD（Axis・ViewportTransform・scroll anchorのDOM非依存座標ロジック）

## 目的

「50,000行×200列のCanvasグリッドが実用速度で描画・スクロールできるか」を検証するPoC-B（計画書 §18.2）を `apps/playground` に実装し、fps・メモリの実測で合格判定する。Phase 0 No-Go条件「Canvasが50,000行で実用速度」（§18.6）に答え、ADR-011（行スロット＋チャンク化セルストア）の判断材料を作る。

## 背景・課題

- 正典は計画書 `doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md` の **§18.2（実装範囲・合格条件）**。設計は §12（Canvas描画）・§13（仮想スクロール）、目標値は §21（性能目標）。`doc/plan/phase0-dd-roadmap.md` の DD-004（DD-002 の後工程・DD-006 統合シナリオの前提）。
- DD-002 が `apps/playground/src/grid/` に 20×10 固定グリッド土台（geometry/cell-store/navigation/grid-view）を実装済み。ただし現構造は 50,000行×200列では成立しない:
  - `grid-view.ts`: contentSize 全面の Canvas 1枚を確保して毎回全再描画 → 50,000行×28px≒140万px 高はバッキングストア上限・メモリで不可。viewport同サイズCanvas＋可視範囲描画（§13.1）への転換が必要
  - `geometry.ts`: 固定 cellWidth/cellHeight の均等割り計算 → 可変行高・列幅、固定行列、ID基準 anchor を表現できず、Axis構造（§13.2）への置換が必要
  - `cell-store.ts`: `entries()` が非空セル全走査 → 500,000セルで毎フレーム O(n)。可視範囲クエリを持つストアが必要
- 本PoCでリスク R-03（データ密度でメモリ超過）と R-02（座標ずれ。ViewportTransform・DPR・anchor）の判断材料も得る。

## 検討内容

- **仮想スクロール方式は §13.1 をそのまま採用**: ブラウザー標準スクロールの DOM viewport＋内容サイズを表す spacer＋viewport 同サイズ固定 Canvas。scrollTop/Left から可視範囲を計算し可視セルのみ描画。50,000行×標準行高はスクロール座標範囲に収まるため segmented scrolling は不採用。
- **既存 `src/grid/` は変更せず、PoC-B は別エントリーページ＋新モジュール群（`src/pocb/`）で実装**: DD-002 が Phase 6（実機IME受入試験）未完のため、その試験環境（`index.html`・`src/grid|ime|sim|ui/`）を凍結保全する。IME統合（textarea追従を ViewportTransform へ載せる §13.5）は DD-006 統合シナリオで実施。
- **Axis 初期実装は §13.2 の初期候補どおり**: RowId/ColumnId 順序配列＋ID→index Map＋標準サイズ＋疎 override。index↔offset は累積オフセット（prefix sum）キャッシュ＋二分探索。構造変更（挿入・削除・サイズ変更）はキャッシュ再構築で開始し再構築時間を計測、ボトルネックなら Fenwick Tree へ（→要確認3）。Axis API を抽象化し上位へ配列を露出しない。
- **セルストアは行スロット＋チャンク化の最小実装**（ADR-011素材）: 可視範囲クエリを O(可視セル数) で返し、500,000非空セルのメモリ・生成/読取時間を計測。疎/密方式の本格比較は DD-005（PoC-D）が担い、ADR-011 ドラフトは本DDで起こして DD-005 が拡充する。
- **自動E2E（@playwright/test）は導入しない**: 並行セッションの npm install 競合回避に加え、受け入れ基準1〜5 はページ内計測ハーネス（fpsレコーダー・自動スクロールドライバー・メモリサンプリング・結果JSONエクスポート）で自動判定できるため。**新規 npm 依存ゼロ（install 不要）を厳守**。対話目視・スクショは主セッションの Playwright MCP スモークで代替（DD-002 と同運用）。
- **計測は headed の実ブラウザーウィンドウ（Chrome/Edge）で実施**。ヘッドレス・最小化ウィンドウはGPU合成経路が異なるため参考値扱い。可視セル数は §18.2 の 2,000〜4,000 に合わせ、計測モードでは標準セルを縮小（56×22px 目安）しフルウィンドウで確保。メモリは performance.memory（Chromium限定）を基本、DevTools ヒープスナップショットを補助。
- **スコープ外**: IME編集統合（DD-006）／実サーバーPresence（模擬タイマーで代替）／セル結合 §12.7・アクセシビリティ §12.8（描画構造の考慮のみ）／dirty rectangle・tile cache（§12.3「実測で必要なら」に該当した場合のみ導入検討）／CellStore方式比較・数式（DD-005）／製品機能としてのズーム（§12.4）。

### 要確認（ユーザー判断待ち・実装開始前に確定）

1. **参照端末**: §21 は「業務標準クラス 4〜8コアCPU・16GB RAM・内蔵GPU（具体機種は Phase 0 開始前に決める）」。現状の実行環境（本機 Windows 11＋Chrome/Edge）を参照端末として合格判定してよいか。
2. **Presence 計測人数**: §18.2/§21 どおり 20人固定でよいか（人数を振った感度計測はしない前提）。
3. **Axis 初期実装**: 順序配列＋ID→index Map＋標準サイズ＋疎 override で開始し、計測でボトルネックが出た場合のみ Fenwick Tree へ切替、でよいか（§13.2 初期候補準拠）。

## 決定事項

（起票時点の方針。要確認1〜3 の回答で確定させる）

- レイヤーは §12.1 の Base/Overlay 2枚分離: base=セル背景・文字・罫線・ヘッダー、overlay=選択・Presence・ドラッグガイド。Presence・選択変更で全セル再描画しない。
- 描画更新は §12.3 の RenderScheduler: dirty flags（geometry/cells/selection/presence/full）→ rAF 集約 → 可視範囲計算 → 必要レイヤーのみ描画。初期実装は可視範囲全描画。
- 固定行・固定列は §12.2 の4象限 clip region を 1 Canvas 内で描画。座標変換は ViewportTransform に集約し、描画・ヒットテスト・overlay（将来は textarea 位置）で同一実装を使う。ヒットテストは Axis prefix sum を使い DOM を探索しない（§12.6）。
- 高DPI は §12.4: バッキングストア=CSSサイズ×devicePixelRatio、描画座標は CSS px 統一、1px 罫線は device pixel へ snap、DPR変更・resize を監視して再確保。
- 文字描画は §12.5: font×文字列×列幅キーの measureText キャッシュ、同一フレームで再測定しない、セル clip ではみ出し防止。
- overscan は §13.3: 縦=画面高0.5〜1.0倍・横=数列（計測でチューニング）。高速スクロール中の文字簡略化（適応モード）は基準未達時のみ導入。
- scroll anchor は §13.4 の ScrollAnchor（rowId＋offsetWithinRow・columnId＋offsetWithinColumn）を保持し、行高変更・行挿入後に scrollTop/Left を補正して画面を跳ばさない。
- RowId/ColumnId は既存依存 `@nanairo-sheet/sheet-types` のブランド型を使用。**sheet-core 等 packages/* へ新規依存しない**（DD-003 が別セッションで作成中。PoC-B は playground 内の CellStore で計測する）。
- データ生成は決定論（シード付きPRNG）: 50,000行×200列・非空500,000セル（§21基準）、数値/短文/日本語/長文の混在で測定キャッシュと clip に実運用相当の負荷を与える。仕様詳細は添付 `DD-004/measurement-spec.md` へ分離。
- 成果物（ロードマップ「DD化の原則」3）: 計測レポート `DD-004/measurement-report.md`（fps・メモリ実測値・scroll anchor検証・合否）、ADRドラフト `doc/adr/0011-row-slot-chunked-cell-store.md`（`doc/DOC-MAP.md` 更新含む）、Phase 1 へ引き継ぐ設計注意事項。

## 受け入れ基準

計画書 §18.2 合格条件をそのまま使う（#1〜5）。計測条件: 参照端末〔要確認1〕・headed実ウィンドウ・可視2,000〜4,000セル・非空500,000セル・Presence 20人有効。

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | 自動スクロールドライバーで通常速度スクロール → 95%フレームが33ms未満 | Phase 5 計測ハーネス（rAF間隔p95・結果JSON） |
| 2 | スクロール停止中に全可視セルを base 再描画 → 8〜12ms以内（目標値） | Phase 5 計測（強制full再描画N回の平均・p95） |
| 3 | セルを pointerdown → 選択枠が overlay に表示されるまで50ms未満 | Phase 5 計測（Event.timeStamp→overlay描画完了） |
| 4 | 10分連続スクロール → メモリ（usedJSHeapSize）が単調増加しない | Phase 5 ドライバー＋10秒間隔サンプリングの傾向判定 |
| 5 | 50,000行の末尾付近で可視域上方の行高変更・行挿入 → 画面が跳ばない（anchor維持） | Phase 4 ユニット＋Phase 5 ドライバー検証・目視 |
| 6 | §18.2 実装範囲（可変行高列幅・固定行列4象限・選択ドラッグ・Presence20人・高DPI）が動作する | Phase 3/4 機械検証＋スクショエビデンス |
| 7 | 計測レポート・ADR-011ドラフト・Phase 1引き継ぎ事項が文書化される | Phase 5 成果物タスク＋`doc-check.sh` エラー0 |

## タスク一覧

### Phase 0: 事前精査
- [ ] 📋 **各Phaseのタスク精査・詳細化**（受け入れ基準1〜7と各Phase検証タスクの対応・ファイルパス明記・変更内容の具体性を確認）
- [ ] 📐 **実装前詳細化トリガー判定**（各Phaseごと。新規モジュール群＋性能特性が核心のため全Phase「要」想定。判定結果 `Phase N → 要/不要` を本文へ明記）
- [ ] 🧪 **テスト設計（Red）**: Axis・ViewportTransform・scroll anchor の境界シナリオ（先頭/末尾・固定境界・override混在・挿入/削除後のoffset・DPR）を `DD-004/scenarios.md` に自然言語で作成（本DDの承認ゲートで方針合意済みの範囲は自動継続ルールで進行）
- [ ] 🧑‍⚖️ **Codexレビュー要否判定**（起票時暫定: 必須・effort high〔下記ログ〕。Phase 0 で確定し本文へ明記）
- [ ] 😈 **Devil's Advocate調査**（このアプローチの欠点・他の選択肢・将来壊れやすい点。特に「計測ハーネスが実利用と乖離する」「PoC簡略化がADR-011判断を歪める」リスク）

### Phase 1: Axis・ViewportTransform（DOM非依存座標基盤・TDD）
- [ ] 📐 **実装前詳細化**（Phase 0 判定に従い、モジュール境界・シグネチャ・データフローを本文へ）
- [ ] **Red→Green**: `apps/playground/src/pocb/{axis,viewport}.test.ts`（新規）へ scenarios.md をコード化 → 実装で green 化
- [ ] `apps/playground/src/pocb/axis.ts`（新規）: 順序配列＋ID→index Map＋標準サイズ＋疎override。index↔pixel offset（累積オフセット＋二分探索）・ID↔index・行高/列幅変更・挿入/削除（キャッシュ再構築＋再構築時間計測フック）。配列を上位へ露出しないAPI（§13.2）
- [ ] `apps/playground/src/pocb/viewport.ts`（新規）: ViewportTransform — scrollTop/Left・固定行列数・viewportサイズから4象限pane（§12.2）ごとの可視範囲（overscan §13.3込み）・セル矩形・point→cellヒットテスト（§12.6）を算出
- [ ] 🔬 **機械検証**: playground の `npm run test` / `typecheck` / `lint` → green（既存 grid/ime テストの回帰0）
- [ ] 😈 **DA批判レビュー**（基準: da-method.md §3.4）

### Phase 2: 大規模データ・チャンク化ストア・PoC-Bページ土台
- [ ] `apps/playground/src/pocb/data-gen.ts`（新規）: シード付きPRNGで 50,000×200・非空500,000セルを決定論生成（内容混在・生成時間と件数を返す）＋ユニットテスト（件数・再現性）
- [ ] `apps/playground/src/pocb/chunk-store.ts`（新規）: 行スロット＋チャンク化セルストア最小実装（可視範囲クエリ・非空件数・メモリ概算フック。ADR-011素材）＋ユニットテスト。既存 `src/grid/cell-store.ts` は変更しない
- [ ] `apps/playground/poc-b.html`＋`apps/playground/src/pocb/main.ts`（新規）: DOM viewport＋spacer＋viewport同サイズCanvas（§13.1）。scroll→rAF→可視範囲のみ base 描画の初回動作（この時点は1レイヤー・全象限なしで可）
- [ ] `apps/playground/vite.config.ts`（新規）: build のマルチエントリー（index.html＋poc-b.html。dev は設定不要・新規npm依存なし）
- [ ] 🔬 **機械検証**: `test` / `typecheck` / `lint` / `build` → green。dev で 50,000行×200列をスクロールし表示崩れなし（目視は主セッション委譲可）
- [ ] 😈 **DA批判レビュー**（spacer高さ・スクロール座標の桁あふれ・チャンク境界の読み漏れ）

### Phase 3: Base/Overlay分離・固定行列4象限・高DPI・文字測定キャッシュ・選択・Presence
- [ ] `apps/playground/src/pocb/render-scheduler.ts`（新規）: dirty flags（geometry/cells/selection/presence/full §12.3）＋rAF集約＋base/overlay描画回数カウンタ（検証用）
- [ ] `apps/playground/src/pocb/base-layer.ts`（新規）: 4象限clip描画（§12.2）・罫線device pixel snap（§12.4）・measureTextキャッシュ（§12.5）・セルclip
- [ ] `apps/playground/src/pocb/overlay-layer.ts`（新規）: 選択枠・ドラッグ範囲・Presence表示（他者activeCell枠＋selection＋名前タグ・colorKey）
- [ ] `apps/playground/src/pocb/presence-sim.ts`（新規）: 20人の模擬Presence（タイマーで activeCell/selection を random walk。人数は設定可〔要確認2〕）
- [ ] `apps/playground/src/pocb/main.ts`（拡張）: overlay canvas 追加（§12.1）・DPR/resize監視で両canvas再確保（§12.4）・固定行/列数の切替UI・pointerdown/drag→ヒットテスト→選択（overlayのみinvalidate）
- [ ] 🔬 **機械検証**: `test` / `typecheck` / `lint` → green。Presence更新・選択変更の連続中に base 描画カウンタが増えないことを計測UIで確認
- [ ] 📸 **エビデンス**: 固定行列＋選択＋Presence 20人＋高DPI罫線のスクショを `DD-004/` へ（主セッション Playwright MCP または手動）
- [ ] 😈 **DA批判レビュー**（4象限の境界1px・DPR切替時のずれ・overlayとbaseの座標一致）

### Phase 4: 可変行高・列幅・行挿入・scroll anchor
- [ ] `apps/playground/src/pocb/main.ts`＋デバッグUI（拡張）: 行高・列幅の変更操作（個別指定＋ランダム多数override投入）と行挿入/削除（可視域上方への一括挿入含む）→ Axis更新・spacerサイズ更新・再構築時間の記録
- [ ] `apps/playground/src/pocb/scroll-anchor.ts`（新規）: ScrollAnchor 保持（§13.4）と構造変更後の scrollTop/Left 補正＋補正計算のユニットテスト（scenarios.md 対応分）
- [ ] 🔬 **機械検証**: `test` → green。末尾付近表示中に上方の行高変更・1,000行挿入をしても可視内容が維持される（anchor補正ログと目視）
- [ ] 😈 **DA批判レビュー**（挿入直後の offset キャッシュ不整合・anchor行自体が削除された場合の挙動）

### Phase 5: 計測ハーネス・合格判定・ADR-011ドラフト・引き継ぎ・Codexレビュー
- [ ] `apps/playground/src/pocb/metrics.ts`＋計測UI（新規）: fpsレコーダー（rAF間隔・p95/最悪値）・停止中full再描画計測・pointer→選択枠遅延計測・メモリサンプリング（performance.memory）・自動スクロールドライバー（速度指定・10分往復）・結果JSONエクスポート
- [ ] `doc/DD/DD-004/measurement-spec.md`（新規・添付）: データ生成仕様・計測手順・計測条件（端末/ブラウザー/ウィンドウ/可視セル数）。50行超のため本体から分離（guides.md §6）
- [ ] 計測実施 → `doc/DD/DD-004/measurement-report.md`（新規・添付）: 受け入れ基準1〜5の実測値・合否・ボトルネック分析（未達時は §12.3 dirty rect／§13.2 Fenwick 等の対策を適用し再計測）
- [ ] `doc/adr/0011-row-slot-chunked-cell-store.md`（新規・ドラフト）: 背景・選択肢・PoC計測結果・決定案・再検討条件（DD-005 の疎/密比較で拡充予定）。`doc/DOC-MAP.md` へ ADR セクションを追加
- [ ] Phase 1 へ引き継ぐ設計注意事項（packages/sheet-renderer-canvas 化の分割線・PoCで簡略化した点）を measurement-report 末尾へ記録
- [ ] 🔬 **機械検証**: `test` / `typecheck` / `lint` / `build` → green、`bash scripts/doc-check.sh` → エラー0
- [ ] 😈 **DA批判レビュー**（計測値の再現性・合否判定の根拠がJSON/レポートから追えるか）
- [ ] Codexレビュー自動実行（依頼書 `DD-004/codex-review-request.md`〔対象は本DDの apps/playground 差分のみ・DD-002/003 の差分は対象外と明記〕→ `bash scripts/codex-review.sh` → `DD-004/codex-review-result.md`）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録

## ログ

### 2026-07-11
- DD作成（`doc/plan/phase0-dd-roadmap.md` DD-004。同ファイルの状態を「未起票」→「検討中」へ更新）
- Codex CLI 利用可否チェック: 利用可（codex-cli 0.144.0-alpha.4）→ 起票時暫定判定: **必須**〔TDD対象（Axis/anchor）＋新規モジュール群＋性能特性が核心〕・effort **high**〔xhighトリガー非該当〕。実行は Phase 5 で全差分1回（DD-002 と同運用・サブスク枠節約）
- Playwright MCP: 起票エージェントからは利用可否を確認できず。実装Phase開始時に確認し、不可なら📸は手動キャプチャで代替（DD-002 と同運用）
- 要確認1〜3（参照端末の確定／Presence計測人数20人固定／Axis初期実装は順序配列＋Mapで開始）を「検討内容」に記載。ユーザー回答後に決定事項へ反映する
- 並行セッション制約: DD-003 実行中のため `packages/**`・`apps/collaboration-server/**`・`doc/DD/DD-003*` に不介入・`git` 不実行。本DDの実装セッションでも DD-003 完了までは同制約を維持する（新規 npm install もしない）

---

## DA批判レビュー記録

> 手順・品質フィルター・再チェック条件は `doc/da-method.md` を参照。

### 共通DA観点（全Phase必須）

**計測の妥当性**（計測ハーネス自身が描画コストを歪めていないか・headed実ウィンドウ以外の値を合否に使っていないか）と、**PoC-A試験環境の不介入**（`index.html`・`src/grid|ime|sim|ui/`＝DD-002 Phase 6 の実機受入環境を変更しない）を毎Phaseで確認する。

| # | Phase | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------|-------------------|--------|----------------------|--------|------|
