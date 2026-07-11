# DD-005: 統合PoC-IME・Canvas・共同編集

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-12 | 2026-07-12 | 検討中 | 起票済み・要確認1〜3確定（案A/Codex2回/初期約10万セル）。着手条件=DD-002・003・004完了。実装前にクリーンアップ先行（DD-004実機run→DD-003/004アーカイブ）→その後Phase 1着手 |

> アプローチ: E2E駆動（統合シナリオ＝操作→結果の検証が中心）＋TDD（sheet-collaboration 抽出は DD-003 既存テストを green 維持する挙動保存リファクタ）＋標準（実機IMEゲート・証跡）

## 目的

DD-002（IME・常駐textarea）・DD-004（Canvas仮想スクロール・ViewportTransform）・DD-003（共同編集・Operation収束）を**一つのセル編集フロー**として結線し、ロードマップの統合シナリオ10項目が成立することを実装・検証する（計画書 §18.1〜18.3・§11・§13.5・§10.4）。統合シナリオの成立は Phase 0 Go の必須条件（判定自体は DD-007 が行う）。

## 背景・課題

- **スコープの正典は `doc/plan/phase0-dd-roadmap.md` の「DD-005 の統合シナリオ」節**（10項目・着手条件・旧DD-006分割の経緯）。各PoCが個別に合格しても統合時に問題が出るため、DD-005 で一連のフローとして成立させる。
- **着手条件: DD-002・DD-003・DD-004 完了**（データ表現・数式＝DD-006 は必須依存にしない）。現状 DD-004 は確認待ち（ユーザー実機確認 run 残）。
- 統合対象の現状: IME＝`apps/playground/src/ime/`（resident-textarea・editor-state-machine・event-recorder。固定20×10の `src/grid` 上で受入済み）／Canvas＝`apps/playground/src/pocb/`（viewport=ViewportTransform・scroll-anchor・base/overlay-layer・chunk-store 等。50,000行×200列）／共同編集＝`packages/sheet-core`・`packages/sheet-server-core`＋`apps/collaboration-server/src/client-session/`（ClientSession・ClientTransport/TransportListener 抽象・ws/inprocess 分離済み）。**packages/sheet-collaboration は未存在**。
- **textarea 追従は DD-004 の ViewportTransform（§13.5）へ載せ替える**。DD-002 の固定20×10 `src/grid` は統合対象にしない。
- **DD-002 の申し送り（DA #11）**: 実機受入は合格したが、確定Enterの発火順（順序A=isComposing:true のまま確定／順序B=compositionend 後）の実機観察が未記録 → 本DDの実機ゲートで正式回収する。
- 本DDは playground（Canvas/IME）＋collaboration-server（共同編集）＋packages 境界を横断する **Phase 0 で最も衝突しやすいDD**。

## 検討内容

- **要確認1（筆頭・アーキ判断）: 共同編集クライアント（ClientSession）の持ち出し方**
  - **案A（推奨）**: `packages/sheet-collaboration` を新設し、ClientSession のトランスポート非依存部（session・Conflict Queue・プロトコル依存の `client-session/` 一式）を抽出・移設。`apps/collaboration-server` は Node ws トランスポート、`apps/playground` はブラウザー native WebSocket トランスポートを実装。既に ClientTransport/TransportListener 抽象と ws/inprocess の分離があるため**移設中心**で済み、ADR-022（packages/* ランタイム依存ゼロ）とも整合。**DD-003 の全テストを移設後も green に保ち、リファクタ前後の挙動一致を保証**する。
  - 案B: 統合ページから既存 `apps/collaboration-server/src/client-session/` を直接参照。短期は速いが、app 間の内部ソース参照が Phase 1 の負債になる。
  - 本DDは案Aを推奨としてタスクを構成する（最終決定はゲートでユーザー）。案Bの場合は Phase 1 を「相対参照の配線＋負債を DD-007 既知制約へ記録」に差し替える。
- **統合ページは新エントリー `apps/playground/poc-integration.html`＋`src/integration/`**（pocb と同方式）。既存受入環境（`index.html`＝DD-002／`poc-b.html`＝DD-004）は凍結。ただし `src/ime/` は配置座標プロバイダーの注入化など**最小変更を許容**（既存テスト・E2Eで回帰を守る）。`src/grid/` は変更しない。
- **文書の正はサーバー文書（sheet-core SheetDocument）**: ClientSession の committed/pending 文書を描画の源にし、displayRowOrder→pocb Axis／セル読取アダプター（**RowId/ColumnId キー**）で結線する。pocb `chunk-store` の index キー簡略化（DD-004 DA #3 既知）をそのまま使うと AC4（行挿入追従）が成立しないため、統合ブリッジ側で RowId 安定を担保する。
- **検証は三層**: (a) 自動＝移設した DD-003 テスト＋統合E2E（synthetic composition＋実WSサーバー・2クライアント）。(b) headed 目視（主セッション Playwright）。(c) **実機IMEゲート（ユーザー手動・2環境・トレース必須）**。synthetic は実IMEの代替にならない（§11.8/§20.5）。
- **実IMEトレースの必須化（DD-002 申し送りの正式回収）**: 最低2環境（**Microsoft IME×Chrome・Google日本語入力×Chrome**）で統合シナリオを実行しトレースを保存。Edge は挙動差が観測された場合のみ追加採取。記録列: keydown Enter／compositionend／beforeinput／input／keyup Enter／isComposing／状態機械state／textarea.value／active RowId／active ColumnId。保存先 `doc/DD/DD-005/traces/`（実機用。SYNTHETIC＝`doc/archived/DD/DD-002/traces/synthetic-reference/` と分離）。
- **性能の再判定はしない**: fps 等の合否は DD-004 で判定済み。統合ページでは機能成立を検証し、明らかな劣化のみDAで観察・記録する。

## 決定事項

**要確認の確定（2026-07-12 仕様確認ゲート）**:
- **要確認1（アーキ判断）= 案A（`packages/sheet-collaboration` 抽出）で確定**。Phase 1 を案Aで実装（挙動保存リファクタ・DD-003 全テスト green 維持・ADR-022 整合）。
- **要確認2 = Codexレビューは Phase 1（抽出差分）＋ Phase 4（統合差分）の2回**で確定。
- **要確認3 = 統合ページ初期データは 50,000行×200列・非空セル約10万**で確定（密度・メモリの密検証は DD-004/DD-006 の担当）。

- 受け入れ基準は「統合シナリオ10項目」＋外部レビューで確定した AC1〜4＋実IMEトレース＋挙動一致保証で構成する（2026-07-12 ChatGPTレビュー指摘5・6反映）。
- **DD-003 の既知境界を本DDで隠さない**（指摘7）: client→server 方向の submitOperation 欠落時の完全な sequence 再整列は未実装で、DD-003 収束試験のフォールト方向は主に server→client に限定されている。**本DDでは解消しない**（下記「対象外」）。統合PoC成功を「全ネットワーク障害に対応済み」とは表現しない。
- リモート更新・競合の挙動は §10.4/§11.7 準拠: リモート値は Document State へ・編集中 textarea/draft/selection は不変・競合はインジケーター表示と Conflict Queue 保持まで（解決UIは Phase 1）。
- **実装前ワークフロー（ゲートでユーザー操作。指摘1〜3）**: ①DD-004 実機確認 run→完了化 ②DD-003・DD-004 のアーカイブ ③実装中の並行セッション（DD-006/007）は本文修正のみ・実装並走なし ④クリーンな作業ツリーで開始——を満たしてから実装に入る（Phase 0 着手前提チェック）。

### 統合シナリオ（`doc/plan/phase0-dd-roadmap.md` 正典・10項目）

1. 利用者AがCanvas上のセルで日本語IME変換を開始する
2. 利用者Bが同じセルを更新・確定する
3. AのCanvasへリモート値と競合状態が反映される
4. Aの常駐textareaと未確定ドラフトは維持される
5. AがIME変換を確定してセルをCommitする
6. beforeRevision不一致として競合処理（reject）される
7. Aの入力内容はConflict Queueに保持される
8. 全クライアントとサーバーの文書状態が最終的に収束する
9. スクロール中も常駐textareaが正しいセルへ追従する（ViewportTransform・§13.5）
10. PresenceのactiveCell・selectionRanges・editingCellが正しく表示される

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | 統合シナリオ10項目（上記）が一連のセル編集フローとして成立し、項目別の証跡が残る | Phase 4 統合E2E＋Phase 5 実機ゲート＋`DD-005/integration-evidence.md` |
| 2 | **AC1 通常入力と同期**: Aが50,000行Canvas上のセルを選択→日本語入力・確定→SetCellsがサーバーへ送信→Bへ反映→A/B/サーバーの文書hash一致 | Phase 4 E2E（synthetic）＋Phase 5 実機 |
| 3 | **AC2 同一セル競合（Phase 0中核）**: Aが実IMEで変換開始→Bが同セルを更新・確定→AのCanvasにBの確定値が反映され textarea/draft/selection は不変→Aが確定→beforeRevision不一致でreject→Aの入力はConflict Queueへ・Bの値はDocument Stateに維持→全体hash一致 | Phase 4 E2E（synthetic）＋Phase 5 実機（実IME） |
| 4 | **AC3 Canvas統合**: 変換中に縦横スクロール→textareaが同じRowId/ColumnIdのセルへ追従→値・selection・DOM親は不変→固定行列境界をまたいでも位置ずれなし | Phase 3 ユニット＋Phase 4 E2E＋Phase 5 実機 |
| 5 | **AC4 構造変更**: ①A編集中にBが編集セルより上へ行挿入→Aは同じRowIdのセルを編集継続 ②A編集中にBが編集対象行を削除→textarea draftを破棄せずConflict Queueへ退避・無効セルへCommitしない | Phase 3 ユニット＋Phase 4 E2E |
| 6 | **実IMEトレース**: 2環境（MS IME×Chrome・Google日本語入力×Chrome）で統合シナリオを実行し、指定記録列のトレースを `DD-005/traces/` に保存。確定Enter順序A/Bを判定・記録し、合成リファレンス（`doc/archived/DD/DD-002/traces/synthetic-reference/`）の前提が実機トレースと一致するか最終確認する | Phase 5 実機ゲート（ユーザー手動） |
| 7 | 案A採用時: 移設後も DD-003 由来の全テストが green（挙動保存リファクタの保証）・packages/* のランタイム依存ゼロ維持 | Phase 1 🔬機械検証 |

## 対象外（Non-Goals）

- **DD-003 既知境界の解消**: client→server 方向（submitOperation 欠落）の完全な sequence 再整列は未実装のまま（DD-003 の収束試験はフォールト方向を主に server→client に限定）。本DDでは解消せず、**DD-007 の既知制約一覧へ記載**し、**Phase 1 の共同編集DDで対応**する。統合PoCの成功を「全ネットワーク障害に対応済み」とは表現しない。
- 競合解決ダイアログUI（保持・インジケーター表示まで。解決操作は Phase 1）／数式・データ表現（DD-006）／Undo・コピー&ペースト／認証・認可（§8.7）／macOS・Firefox／DD-004 性能合否の再計測。

## タスク一覧

### Phase 0: 事前精査＋着手前提チェック
- [ ] 📋 **着手前提チェック（実装前ワークフロー・ゲートでユーザー操作）**: ①DD-004 実機確認 run 完了→DD-004 完了化 ②DD-003・DD-004 アーカイブ済み ③並行セッション（DD-006/007）は本文修正のみ・実装並走なし ④クリーンな作業ツリーで開始
- [ ] 📋 **各Phaseのタスク精査・詳細化**（受け入れ基準1〜7と検証タスクの対応・ファイルパス・変更内容の具体性・各Phaseの🔬を確認）
- [ ] 📐 **実装前詳細化トリガー判定**（起票時想定: Phase 1=要〔新規パッケージ・外部I/F移設〕／Phase 2=要〔新規モジュール群・文書ブリッジ〕／Phase 3=要〔IME×共同編集の状態遷移合成〕／Phase 4=要（軽）〔E2E設計〕／Phase 5=不要〔ユーザー手動中心〕。Phase 0 で確定し本文へ明記）
- [ ] 🧪 **テスト設計**: 統合シナリオ10項目＋AC1〜4 を `DD-005/scenarios.md` に自然言語で作成（synthetic で自動化する範囲と実機でのみ判定できる範囲を明示）→ ユーザー合意後にコード化
- [ ] 🧑‍⚖️ **Codexレビュー要否判定**: **必須・effort xhigh**（起票時確定・下記ログ）。実行は Phase 1（抽出差分）と Phase 4（統合差分）の2回を想定（→要確認2）
- [ ] 😈 **Devil's Advocate調査**（§11.9 違反の再混入経路／移設リファクタの挙動改変／文書ブリッジの RowId 安定／「synthetic だけで実IME未検証のまま成立を主張する」穴）

### Phase 1: sheet-collaboration 抽出（案A・挙動保存リファクタ。要確認1の回答後に着手）
- [ ] 📐 **実装前詳細化**（移設対象の同定: `apps/collaboration-server/src/client-session/{session,deps,test-support,inprocess-transport}.ts`＋session/catchup/reconnect/inprocess-transport 各テスト。`ws-transport.ts` は collaboration-server に残す。公開APIと import 経路を確定→ユーザーレビュー）
- [ ] `packages/sheet-collaboration/`（新規）: package.json・tsconfig（sheet-core 同型・ランタイム依存ゼロ・`@nanairo-sheet/sheet-collaboration`）。ClientSession 本体・ClientTransport/TransportListener 抽象・inprocess-transport＋各テストを移設
- [ ] `apps/collaboration-server/`: client-session への参照を `@nanairo-sheet/sheet-collaboration` import へ差し替え（`ws-transport.ts`・`server.smoke.test.ts` 等）。挙動変更なし
- [ ] 🔬 **機械検証**: `npm run test`（DD-003 由来テスト全件 green・件数一致）／`typecheck`／`lint`／`bash scripts/doc-check.sh` → green。sheet-collaboration の dependencies が空（ランタイム依存ゼロ）であることを確認
- [ ] 😈 **DA批判レビュー**（移設時の挙動改変・テスト間引き・循環依存の混入。基準: da-method.md §3.4）
- [ ] Codexレビュー自動実行（抽出差分のみ・挙動一致観点。依頼書→`bash scripts/codex-review.sh --effort xhigh`→`DD-005/codex-review-phase1-result.md`）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録

### Phase 2: 統合ページ土台（トランスポート・文書ブリッジ・50,000行描画）
- [ ] 📐 **実装前詳細化**（ブリッジのデータフロー: welcome/snapshot→SheetDocument→Axis 構築→可視範囲描画→operations 差分反映。再接続時の描画方針→ユーザーレビュー）
- [ ] `apps/playground/src/integration/browser-transport.ts`（新規）: ブラウザー native WebSocket による ClientTransport 実装（再接続対応）
- [ ] `apps/playground/src/integration/document-view.ts`（新規）: committed/pending 文書→pocb Axis（displayRowOrder）＋RowId/ColumnId キーのセル読取アダプター（挿入・削除・リモート更新で dirty flag→再描画）
- [ ] `apps/playground/poc-integration.html`＋`src/integration/main.ts`（新規）＋`vite.config.ts`（エントリー追加）: pocb viewport/base-layer/overlay-layer を用いた統合ページ（既存エントリー凍結）
- [ ] `apps/collaboration-server`: 開発起動時に50,000行×200列のシード文書を初期投入できるようにする（`startServer` オプション or seed モジュール。非空セル規模は→要確認3）
- [ ] 🔬 **機械検証**: `test`／`typecheck`／`lint`／`build`（poc-integration.html バンドル出力）→ green。2ブラウザータブで SetCell 相互反映＋50,000行スクロールの headed スモーク
- [ ] 😈 **DA批判レビュー**（ブリッジの二重状態・大規模文書の初期転送・chunk-store index キー簡略化の混入）

### Phase 3: IME×共同編集の結線（textarea追従・Commit・競合・Presence）
- [ ] 📐 **実装前詳細化**（editor-state-machine の Commit→SetCells Command 変換・beforeRevision 付与・reject→Conflict Queue・編集対象行削除時の draft 退避・presence editingCell 発行のイベントフロー→ユーザーレビュー）
- [ ] `apps/playground/src/integration/`＋`src/ime/resident-textarea.ts`（最小変更）: textarea 配置を ViewportTransform 座標（§13.5）で算出・scroll 中は rAF 単位で位置更新・固定領域とスクロール領域の pane を区別。value/selection/DOM親は不変（I-3）
- [ ] `apps/playground/src/integration/commit-bridge.ts`（新規）: 確定値→SetCells（beforeRevision=編集開始時 revision）→ClientSession submit。reject→Conflict Queue 保持・競合インジケーター表示。リモート更新→Document State のみ（§10.4/§11.7）
- [ ] Presence 結線: 編集開始/確定/取消で editingCell を発行、activeCell/selectionRanges を送信し、他者分を overlay-layer で表示（presence-sim は統合ページでは使わない）
- [ ] AC4 対応: 行挿入時の編集継続（RowId 安定）・編集対象行削除時の draft 退避（無効セルへ Commit しない）
- [ ] 🔬 **機械検証**: 追従・document-view・commit-bridge のユニットテスト green＋`typecheck`／`lint`。`src/ime` 既存テスト・E2E の回帰0
- [ ] 😈 **DA批判レビュー**（§11.9 全7項目の再確認・編集開始 revision の取り違え・rollback/replay 中の textarea 不変）

### Phase 4: 統合E2E・証跡・Codexレビュー
- [ ] `apps/playground/e2e/integration-scenario.spec.ts`（新規）: 統合シナリオ10項目＋AC1〜4 の自動分（synthetic composition＋実WSサーバー起動・2クライアント。実IMEの代替でない旨をコメント明記）
- [ ] `DD-005/integration-evidence.md`（新規）: シナリオ項目別の成立記録（対応テスト名・トレース・📸参照）
- [ ] 📸 **エビデンス**: 競合状態（A編集中×B確定値反映・インジケーター）・Presence 表示・スクロール追従のキャプチャ（`DD-005/` 配置）
- [ ] 🔬 **機械検証**: `npm run test`／`test:e2e`／`typecheck`／`lint`／`build`／`bash scripts/doc-check.sh` → 全 green
- [ ] 😈 **DA批判レビュー**（E2Eが「テストのための実装」に依存していないか・証跡から第三者が成立を追えるか）
- [ ] Codexレビュー自動実行（統合差分。依頼書→`bash scripts/codex-review.sh --effort xhigh`→`DD-005/codex-review-result.md`）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録

### Phase 5: 実機IMEゲート（ユーザー手動）★統合シナリオの最終判定
- [ ] `DD-005/manual-integration-test-guide.md`（新規）: 統合シナリオ10項目＋AC1〜3 の実機手順書（A/B 2クライアント操作・記録列・トレース保存手順）
- [ ] ユーザー実機試験: **MS IME×Chrome・Google日本語入力×Chrome の2環境**で統合シナリオを実行（Edge は挙動差が観測された場合のみ追加）。トレースを `DD-005/traces/` へ保存
- [ ] トレース分析: 記録列（keydown Enter／compositionend／beforeinput／input／keyup Enter／isComposing／状態機械state／textarea.value／RowId／ColumnId）で**確定Enter順序A/Bを判定・記録**し、合成リファレンスの前提と一致するか最終確認（不一致なら editor-state-machine へ正式に差し戻す＝DD-002 Phase 6 の教訓）
- [ ] 合否判定・証跡整理（`DD-005/integration-evidence.md` 更新・DD-007 への引き継ぎ事項〔既知の制約含む〕を記録）
- [ ] 🔬 **機械検証**: 全体 `test`／`test:e2e`／`typecheck`／`lint`／`bash scripts/doc-check.sh` の最終 green 確認
- [ ] 😈 **DA批判レビュー**（申告のみクローズの再発防止＝トレース実ファイルの存在確認・順序A/B記録の有無）

## 要確認

1. **共同編集クライアントの持ち出し方（筆頭・アーキ判断）**: 案A=`packages/sheet-collaboration` 新設（**推奨**。移設中心・DD-003 全テスト green 維持・ADR-022 整合）／案B=統合ページから既存 client-session を直接参照（短期は速いが Phase 1 負債）。
2. **Codexレビューの回数**: Phase 1（抽出・挙動一致観点）＋Phase 4（統合）の計2回を推奨（レビュー観点が異なるため）。サブスク枠優先なら Phase 4 の1回に集約可。
3. **統合ページの初期データ規模**: 50,000行×200列は維持（AC1 の前提）。非空セルは初期スナップショット転送（JSON）を考慮して**10万セル程度への縮小を推奨**（500kセルの密度・メモリ検証は DD-004/DD-006 の担当。統合PoCは機能成立の検証）。

## ログ

### 2026-07-12
- DD作成（`doc/plan/phase0-dd-roadmap.md` DD-005 行に対応。番号は予約済み採番=DD-005 固定）
- Codex CLI 利用可否チェック: 利用可（codex-cli 0.144.0-alpha.4）→ **必須・effort xhigh**（必須シグナル複合: IME状態機械×rollback/replay の複雑な状態遷移の合成＋並行処理・トランスポート境界＋packages 新設=外部I/F変更。かつ起票指示で xhigh 推奨の明示あり）
- Playwright MCP: 起票エージェントからは利用可否を確認できず。実装Phase開始時に確認し、不可なら📸は手動キャプチャで代替（DD-002/004 と同運用）
- **ChatGPTレビュー(2026-07-12)を chatgpt-review-20260712.md に記録・反映**（7指摘: 1〜3=実装前ワークフロー〔ゲートでユーザー操作・受け入れ基準には含めない〕・4=要確認1 案A/B・5=AC1〜4 追加・6=実IMEトレース必須化・7=DD-003 既知境界の対象外明記）
- DD-002 申し送り（確定Enter順序A/B 実機未記録=DD-002 DA #11）の回収を受け入れ基準6・Phase 5 に組込。実機トレース保存先 `DD-005/traces/` を用意（SYNTHETIC と分離）
- 要確認1〜3 を記載。ユーザー回答後に「決定事項」へ反映する
- **仕様確認ゲート（dd-auto Step 2・2026-07-12）**: 要確認1=**案A**（sheet-collaboration 抽出）・2=**Codex 2回**（Phase 1＋4）・3=**初期約10万セル**で確定。実装前ワークフローは**「クリーンアップ先行」**（DD-004 実機run→DD-003/004 アーカイブ→DD-INDEX 再生成→Phase 1）を選択。本起票をスコープ指定でコミット

---

## DA批判レビュー記録

> 手順・品質フィルター・再チェック条件は `doc/da-method.md` を参照。

### 共通DA観点（全Phase必須）

**§11.9 禁止事項の再混入**（統合結線は DD-002 単体実装より再発しやすい）と、**移設・結線での挙動改変**（DD-003 資産は挙動保存が原則。DD-002/004 の受入環境＝`index.html`・`poc-b.html`・`src/grid/` の凍結維持）を毎Phaseで確認する。

| # | Phase | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------|-------------------|--------|----------------------|--------|------|
