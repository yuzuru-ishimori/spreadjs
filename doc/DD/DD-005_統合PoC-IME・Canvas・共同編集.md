# DD-005: 統合PoC-IME・Canvas・共同編集

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-12 | 2026-07-12 | 進行中 | 要確認1〜3確定（案A/Codex2回/初期約10万セル）。**Phase 1**（sheet-collaboration 抽出・Codex xhigh 済）＋**Phase 2**（統合ページ土台）＋**Phase 3**（IME×共同編集結線＝commit-bridge cell-level beforeRevision・ime-editing-session・integration-editor・Presence・#8不変/AC4退避）実装完了。**#3 protocol 検証＝cell-level 確定**（SetCellsChange.beforeRevision＋CellRecord.lastChangedRevision＋server validateSetCells がセル単位で照合）。test 434/E2E 11 green・回帰0。**Phase 4（統合E2E・Codex）以降は未着手・Codex は Phase 4**。headed 2タブ smoke（#9競合表示・変換中スクロール追従）は主セッションが実行 |

> アプローチ: E2E駆動（統合シナリオ＝操作→結果の検証が中心）＋TDD（sheet-collaboration 抽出は DD-003 既存テストを green 維持する挙動保存リファクタ）＋標準（実機IMEゲート・証跡）

## 目的

DD-002（IME・常駐textarea）・DD-004（Canvas仮想スクロール・ViewportTransform）・DD-003（共同編集・Operation収束）を**一つのセル編集フロー**として結線し、ロードマップの統合シナリオ10項目が成立することを実装・検証する（計画書 §18.1〜18.3・§11・§13.5・§10.4）。統合シナリオの成立は Phase 0 Go の必須条件（判定自体は DD-007 が行う）。

## 背景・課題

- **スコープの正典は `doc/plan/phase0-dd-roadmap.md` の「DD-005 の統合シナリオ」節**（10項目・着手条件・旧DD-006分割の経緯）。各PoCが個別に合格しても統合時に問題が出るため、DD-005 で一連のフローとして成立させる。
- **着手条件: DD-002・DD-003・DD-004 完了**（データ表現・数式＝DD-006 は必須依存にしない）。DD-004 は実機確認 run で overall=pass → **完了・アーカイブ済み**（2026-07-12・`30b330d`/`a7ec5c0`）。着手前提（DD-003/004 アーカイブ・クリーンツリー）は充足。
- 統合対象の現状: IME＝`apps/playground/src/ime/`（resident-textarea・editor-state-machine・event-recorder。固定20×10の `src/grid` 上で受入済み）／Canvas＝`apps/playground/src/pocb/`（viewport=ViewportTransform・scroll-anchor・base/overlay-layer・chunk-store 等。50,000行×200列）／共同編集＝`packages/sheet-core`・`packages/sheet-server-core`＋`apps/collaboration-server/src/client-session/`（ClientSession・ClientTransport/TransportListener 抽象・ws/inprocess 分離済み）。**packages/sheet-collaboration は Phase 1 で新設済み**（`@nanairo-sheet/sheet-collaboration`・ClientSession/transport抽象/message-codec を移設・外部ランタイム依存ゼロ・362テスト green・`bbd7f49`）。
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

## Phase 2/3 詳細設計・状態所有権（実装アドバイス 2026-07-12 反映・#10 設計ゲート）

> 外部アドバイス `phase2-3-advice-20260712.md`（2026-07-12）を評価し **12点すべて採用**。最重要原則＝**「ClientSession だけを Document State の正本とし、Canvas・IME に第二・第三の文書状態を作らない」**。受け入れ基準・スコープは不変。**Phase 2 実装着手前の設計ゲート（アドバイス#10）としてユーザー確認する**。

### 状態所有権（#1・第二/第三の正本を作らない）

| 状態 | 所有者（唯一の正） | 更新契機 | 派生元 | 永続 | 同期対象 | 破棄・再構築 |
|------|------------------|---------|--------|------|---------|-------------|
| **Document State** | `ClientSession`（committed＋pending view） | サーバーOperation・ACK・reject・rollback/replay | サーバー全順序ログ（真の正はサーバー） | サーバー側で永続 | ○（Operationで同期） | クライアント側キャッシュは snapshot 再取得で再構築可 |
| **Render State**（Axis・Canvas・描画キャッシュ） | document-view＋pocb 描画層 | Document State の dirty flag | **Document State のみ**（唯一の派生元） | × | ×（純ローカル） | ○ いつでも Document State から再構築可 |
| **IME Draft**（未確定文字列・caret） | 常駐 textarea（ローカル） | ユーザー入力・IME composition | なし（ローカルが正） | × | **×（共有しない）** | 破棄は commit/cancel 時のみ。**Operation・rollback/replay・reject で上書き禁止**・未確定文字列を Document State へ入れない |
| **Editing Target** | 統合コントローラ（**RowId＋ColumnId** で保持） | セル選択・commit・cancel | Document State（display は RowId から再解決） | × | activeCell は Presence で共有 | ○ 行挿入/削除後は固定IDから表示位置を再解決 |
| **Presence** | PresenceStore（非永続・TTL） | 選択・編集・接続変化 | ローカル操作＋他者受信 | ×（TTL） | ○ **activeCell・selectionRanges・editingCell のみ**（textarea 文字列・caret は共有しない） | ○ 再接続で再構築 |

### データフロー（#10・各辺の入出力/所有/同期/reject/再接続/RowId/dirty）

```text
snapshot / Server Operation
  → ClientSession                （Document State を更新・唯一の正。ACK/reject/rollback/replay もここへ集約）
  → DocumentView Adapter          （RowId/ColumnId で SheetDocument を読む派生 Adapter。dirty: cell / row-structure / viewport）
  → Axis / Canvas                 （Render State。可視範囲のみ再描画。SetCells=セル dirty のみ／構造Op=Axis更新＋anchor補正）
  → Resident Textarea             （IME Draft。位置のみ ViewportTransform で追従。value/selection/DOM親は不変）
  → Commit Bridge                 （確定input→RowId生存確認→cell-level beforeRevision→SetCells 生成）
  → ClientSession.submit          （楽観適用→pending）
  → ACK / Reject                  （ACK=committed昇格／Reject=beforeRevision不一致）
  → Canvas（Document State反映） / Conflict Queue（reject時 draft 保持）
```

- **同期/非同期**: サーバー往復（submit→ACK/reject）は非同期。DocumentView→Canvas は同期（dirty→次フレーム描画）。
- **エラー/reject 経路**: reject は Document State を変えず（サーバー値が正）、ローカル draft を Conflict Queue へ退避（#7）。
- **再接続経路**: browser-transport 切断→再接続→catch-up（DD-003 既存）→Document State 再収束→Render State は dirty 全再構築。
- **RowId/ColumnId 維持**: 描画・Editing Target・Presence の editingCell はすべて RowId/ColumnId で保持し、display index は表示直前に Axis で解決（#4）。

### 実装制約（Phase 2/3・DA/Codex 必須観点）

- **#2 document-view は第二の CellStore にしない**: ClientSession 文書を読む Adapter または派生キャッシュに限定。独自 Operation 適用・別永続セル状態の保持は禁止。三重管理（ClientSession文書／Canvas独自文書／IME旧cell-store）禁止。キャッシュは常に ClientSession から再構築可を条件とする。
- **#3 beforeRevision はセル単位**: 編集開始時に `targetCell.lastChangedRevision` を保持し `SetCells.changes[].beforeRevision` に使う（文書全体 revision ではない）。「別セルの更新だけでは同一セル競合にならない」ユニットテストを必須。※Phase 3 で protocol/セルモデルが per-cell revision を持つか検証（無ければ設計追加の要否をゲートへ戻す）。
- **#4 構造Op後の位置再解決**: 行挿入後は display index を維持せず「editingRowId→更新後 Axis で display index 再解決→textarea 位置再算出」。削除判定は **index 範囲外でなく `editingRowId` の tombstone 化 / `displayRowOrder` からの消失** で行う。削除時は draft を Conflict Queue へ退避・無効RowIdへCommit禁止・黙って破棄しない・次選択は別ルール。
- **#5 更新コスト分離**: SetCells＝対象セル差分更新＋dirty region invalidate＋可視セルのみ再描画。InsertRows/DeleteRows＝Axis更新/再構築＋scroll anchor補正＋editing RowId/Presence 再解決＋geometry invalidate。**通常 SetCells 受信で 50,000行 Axis・10万セルを全再構築しない**（構造Op時の Axis 全再構築は PoC 許容）。
- **#6 初期 snapshot 経路の計測**（合否でなく記録・DD-007 既知制約＋Phase 1 初期ロード設計へ）: snapshot JSONサイズ／サーバー生成／HTTP転送／JSON parse／ClientSession初期化／Axis構築／初回Canvas描画／初回操作可能までの時間。
- **#7 Commit 順序**: 最終input受信→textarea.value を確定draft取得→対象RowId/ColumnId生存確認→編集開始時 beforeRevision取得→SetCells生成→submit→ACK/reject→reject時 Conflict Queue。**compositionend だけで Commit しない**・最終input前の暫定値送信の回帰を防ぐ（DD-002 順序A/B 実機ゲートと連動）。
- **#8 rollback/replay 中の IME 不変**: ClientSession rollback/replay・リモートOp適用・operationRejected の前後で、IME変換中は `textarea.value`／`selectionStart`／`selectionEnd`／DOM親／textarea instance／editing RowId／editing ColumnId／composition state が不変（DA・テスト必須）。Canvas・Document State は更新可。**IME draft へサーバー値を反映しない**。
- **#9 競合表示の視認性**: A編集中にB確定値が来た時、Canvas のサーバー確定値・textarea の A の draft・競合インジケーターが**同時に識別可能**（textarea がセル全面を覆って競合表示を隠さない z-index/描画位置）。ユニットだけでなく headed 証跡を残す（Phase 4/実機ゲート）。

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
- [x] 📋 **着手前提チェック（実装前ワークフロー・ゲートでユーザー操作）**: ①DD-004 実機確認 run 完了→DD-004 完了化 ②DD-003・DD-004 アーカイブ済み ③並行セッション（DD-006/007）は本文修正のみ・実装並走なし ④クリーンな作業ツリーで開始 → **2026-07-12 完了**（DD-004 実機run overall=pass→完了→DD-003/004 アーカイブ `a7ec5c0`→クリーンツリー確認。並行セッション DD-008 コミット後にクリーン化を確認）
- [ ] 📋 **各Phaseのタスク精査・詳細化**（受け入れ基準1〜7と検証タスクの対応・ファイルパス・変更内容の具体性・各Phaseの🔬を確認）
- [ ] 📐 **実装前詳細化トリガー判定**（起票時想定: Phase 1=要〔新規パッケージ・外部I/F移設〕／Phase 2=要〔新規モジュール群・文書ブリッジ〕／Phase 3=要〔IME×共同編集の状態遷移合成〕／Phase 4=要（軽）〔E2E設計〕／Phase 5=不要〔ユーザー手動中心〕。Phase 0 で確定し本文へ明記）
- [ ] 🧪 **テスト設計**: 統合シナリオ10項目＋AC1〜4 を `DD-005/scenarios.md` に自然言語で作成（synthetic で自動化する範囲と実機でのみ判定できる範囲を明示）→ ユーザー合意後にコード化
- [ ] 🧑‍⚖️ **Codexレビュー要否判定**: **必須・effort xhigh**（起票時確定・下記ログ）。実行は Phase 1（抽出差分）と Phase 4（統合差分）の2回を想定（→要確認2）
- [ ] 😈 **Devil's Advocate調査**（§11.9 違反の再混入経路／移設リファクタの挙動改変／文書ブリッジの RowId 安定／「synthetic だけで実IME未検証のまま成立を主張する」穴）

### Phase 1: sheet-collaboration 抽出（案A・挙動保存リファクタ。要確認1の回答後に着手）
- [x] 📐 **実装前詳細化**（移設対象の同定: `apps/collaboration-server/src/client-session/{session,deps,test-support,inprocess-transport}.ts`＋session/catchup/reconnect/inprocess-transport 各テスト。`ws-transport.ts` は collaboration-server に残す。公開APIと import 経路を確定→ユーザーレビュー）→ 2026-07-12 完了。`message-codec.ts` は「トランスポート非依存・ランタイム依存ゼロ（純粋・sheet-core 型のみ）」ゆえ移設対象へ追加確定。`ws-frame.ts`（Buffer・Node）は残置。公開API/import 経路は下記ログ参照
- [x] `packages/sheet-collaboration/`（新規）: package.json・tsconfig（sheet-core 同型・ランタイム依存ゼロ・`@nanairo-sheet/sheet-collaboration`）。ClientSession 本体・ClientTransport/TransportListener 抽象・inprocess-transport＋各テストを移設 → 2026-07-12 完了（9 ファイル verbatim 移設＋`src/index.ts` バレル＋`/test-support`・`/inprocess-transport` サブパス export）
- [x] `apps/collaboration-server/`: client-session への参照を `@nanairo-sheet/sheet-collaboration` import へ差し替え（`ws-transport.ts`・`server.smoke.test.ts` 等）。挙動変更なし → 2026-07-12 完了（src 3・test 4・計7ファイルの import 差替。`ws-transport.ts`/`server.ts`＋`test/*` 4本）
- [x] 🔬 **機械検証**: `npm run test`（DD-003 由来テスト全件 green・件数一致）／`typecheck`／`lint`／`bash scripts/doc-check.sh` → green。sheet-collaboration の dependencies が空（ランタイム依存ゼロ）であることを確認 → 2026-07-12 全 green（test 36 files/362 tests＝移設前と同数・typecheck〔types:[] env-free 含む〕・lint・build・doc-check・`dependencies:{}`）
- [x] 😈 **DA批判レビュー**（移設時の挙動改変・テスト間引き・循環依存の混入。基準: da-method.md §3.4）→ 2026-07-12 実施（下記 DA 表 #1〜#3）
- [x] Codexレビュー自動実行（抽出差分のみ・挙動一致観点。依頼書→`bash scripts/codex-review.sh --effort xhigh`→`DD-005/codex-review-phase1-result.md`）→ 2026-07-12 実行（xhigh・依頼書 `DD-005/codex-review-phase1-request.md`）
- [x] Codexレビュー指摘への対応、または見送り理由をログに記録 → 2026-07-12 [P2]1件対応（下記ログ）。挙動一致は Codex が確認

### Phase 2: 統合ページ土台（トランスポート・文書ブリッジ・50,000行描画）
- [x] 📐 **実装前詳細化**（ブリッジのデータフロー: welcome/snapshot→SheetDocument→Axis 構築→可視範囲描画→operations 差分反映。再接続時の描画方針→ユーザーレビュー）→ 2026-07-12 完了（#10 設計ゲート承認済み。データフロー各辺を下記ログで確定＝operations replay→ClientSession=唯一の正本→DocumentView read-through Adapter→pocb Axis/Canvas。dirty=cell/row-structure/viewport。再接続=切断→再接続→catch-up→全再構築）
- [x] `apps/playground/src/integration/browser-transport.ts`（新規）: ブラウザー native WebSocket による ClientTransport 実装（再接続対応）→ 2026-07-12 完了（`decodeServerMessage` 使用・SocketFactory/TransportTimer 注入で DOM/WS 非依存にユニットテスト可・outbox flush・自動再接続・#6 計測フック `onServerFrame`。9 tests green）
- [x] `apps/playground/src/integration/document-view.ts`（新規）: committed/pending 文書→pocb Axis（displayRowOrder）＋RowId/ColumnId キーのセル読取アダプター（挿入・削除・リモート更新で dirty flag→再描画）→ 2026-07-12 完了（**セル状態ゼロの read-through Adapter**＝queryRange が可視範囲だけ ClientSession 文書を直読み・store.set は throw で禁止＝第二 CellStore を構造的に排除。rowAxis は RowId 列で構築し構造Op でのみ再構築。10 tests green。結線 `session-sync.ts`（観測 decorator＝session→observer 順・7 tests green）追加）
- [x] `apps/playground/poc-integration.html`＋`src/integration/main.ts`（新規）＋`vite.config.ts`（エントリー追加）: pocb viewport/base-layer/overlay-layer を用いた統合ページ（既存エントリー凍結）→ 2026-07-12 完了（既存 index.html・poc-b.html と src/{grid,ime,pocb} は凍結・import のみ。最小セル編集〔plain input・Phase 3 の IME が置換〕で 2 タブ相互反映を smoke 可能に。vite は input 追加のみ）
- [x] `apps/collaboration-server`: 開発起動時に50,000行×200列のシード文書を初期投入できるようにする（`startServer` オプション or seed モジュール。非空セル規模は→要確認3）→ 2026-07-12 完了（`seed-dataset.ts`＝決定論シード〔50,000行×200列・非空100,000〕・`startServer({ integrationDataset })` オプション＋`--integration`/`SEED_DATASET=integration` フラグ＋`dev:integration` script。`/config` に columnOrder を追加しクライアントが同一列順で ClientSession を構築。6 tests green〔決定論・replay 収束〕）
- [x] 🔬 **機械検証**: `test`／`typecheck`／`lint`／`build`（poc-integration.html バンドル出力）→ green。2ブラウザータブで SetCell 相互反映＋50,000行スクロールの headed スモーク → 2026-07-12 **全 green**（test 41 files/398 tests〔+36・回帰0〕・typecheck 全 workspace・lint・build〔integration entry 29.7KB バンドル〕・doc-check・E2E 11 passed〔DD-002 回帰0〕）。**headed 2 タブ smoke は準備完了・主セッションが実行**（実 WS 経路は node ClientSession で de-risk 済＝join→収束 897ms・client/server hash 一致・50,000行/100,000セル）→ **2026-07-12 主セッションが Playwright MCP で実行＝PASS**（Alice編集 F14=SMOKE-77→Bob 反映・両 revision 12。実行時バグ2件〔CORS・初期Axis crash〕検出・修正＝DA #8/#9・修正後 398 green）
- [x] 😈 **DA批判レビュー**（ブリッジの二重状態・大規模文書の初期転送・chunk-store index キー簡略化の混入）→ 2026-07-12 実施（DA 表 #4〜#7）

### Phase 3: IME×共同編集の結線（textarea追従・Commit・競合・Presence）
- [x] 📐 **実装前詳細化**（editor-state-machine の Commit→SetCells 変換・beforeRevision 付与・reject→Conflict Queue・編集対象行削除時の draft 退避・presence editingCell 発行のイベントフロー）→ 2026-07-12 完了（下記 Phase 3 ログ「イベントフロー確定」節）。**#3 protocol 検証を先行実施＝cell-level 確定**（停止不要）
- [x] `apps/playground/src/integration/`（IME 結線）: textarea 配置を ViewportTransform 座標（§13.5）で算出・scroll 中は rAF 単位で位置更新・固定/スクロール pane を区別。value/selection/DOM親は不変（I-3/#8）→ 2026-07-12 完了。**editor-state-machine は無改変で再利用**し、DOM アダプタ `integration-editor.ts`（新規）＋配置純関数 `editor-placement.ts`（新規）で結線。**resident-textarea.ts は改変せず**（src/ime 零改変＝回帰安全側。下記ログ「IME結線方式」で理由）
- [x] `apps/playground/src/integration/commit-bridge.ts`（新規）: 確定値→SetCells（**cell-level beforeRevision=編集開始時セル revision**・#3）→ClientSession submit（#7 順序）。reject→ClientSession の Conflict Queue（自分の値を保全）・#9 競合インジケーター表示。リモート更新→Document State のみ（§10.4/§11.7・#8）→ 2026-07-12 完了（commit-bridge＋ime-editing-session）
- [x] Presence 結線: 編集開始/確定/取消で editingCell を発行、activeCell/selectionRanges を送信し、他者分を overlay-layer で表示（presence-sim は統合ページでは使わない）→ 2026-07-12 完了（`presence-adapter.ts` 新規＝UserPresence→PresenceUser 変換・main で sendPresence/knownPresences 結線）
- [x] AC4 対応: 行挿入時の編集継続（RowId 安定・editingRowId→更新後 Axis で index 再解決）・編集対象行削除時の draft 退避（tombstone 判定・無効 RowId へ Commit しない・黙って破棄しない）→ 2026-07-12 完了（refreshPlacement の RowId 再解決＋noteServerUpdate の削除退避）
- [x] 🔬 **機械検証**: 追従・commit-bridge・IME結線の DOM非依存ロジックにユニット green＋`test`/`typecheck`/`lint`/`build`/`doc-check`。`src/ime` 既存テスト・E2E（11件）の回帰0 → 2026-07-12 **全 green**（test 45 files/434 tests〔+36・回帰0〕・typecheck・lint・build〔integration 37.84KB〕・doc-check・E2E 11 passed〔DD-002 回帰0〕）
- [x] 😈 **DA批判レビュー**（§11.9 全7項目の再確認・編集開始 revision の取り違え・rollback/replay 中の textarea 不変・#9 z-index/被覆・#7 暫定値送信の回帰）→ 2026-07-12 実施（DA 表 #10〜#14）

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

**Phase 1 実装（案A: sheet-collaboration 抽出・挙動保存リファクタ・2026-07-12）**:
- **移設境界の確定**: `apps/collaboration-server/src/client-session/{session,deps,test-support,inprocess-transport}.ts`＋4テスト（session/catchup/reconnect/inprocess-transport）＋`src/message-codec.ts` を `packages/sheet-collaboration/src/` へ **verbatim（byte-identical）移設**（計9ファイル）。移設ファイルは非相対 import が sheet-core/sheet-types（＋ inprocess のみ sheet-server-core）で完結し、相対 import は同ディレクトリ内で閉じるため**内容無改変で移設可能**。`ws-transport.ts`（Node ws）・`ws-frame.ts`（Node Buffer）・`server.ts`・`server.smoke.test.ts`・`test/*` は collaboration-server 残置。`message-codec.ts` は「純粋・Node/DOM 非参照・sheet-core 型のみ＝トランスポート非依存・ランタイム依存ゼロ」の基準に合致ゆえ移設（Phase 2 の browser-transport が `decodeServerMessage` を app 間結合なしに再利用できる）。`ws-frame.ts` は Buffer/RawData の Node 固有ゆえ残置。
- **新パッケージ公開API**（ユーザーレビュー用）: 本体 `@nanairo-sheet/sheet-collaboration`（`src/index.ts` バレル）= session（`ClientSession`・`ClientTransport`・`TransportListener`・`SessionConfig`・`ConflictQueueEntry`・`ConflictReason`・`PresenceUpdate`・`applyInverseSeed`）／deps（`Clock`・`IdGenerator`・`createCounterIdGenerator`）／message-codec（`isRecord`・`decodeClientMessage`・`decodeServerMessage`）。サブパス `/test-support`（`ManualClock`・`createManualClock`・`RecordingTransport`・`col`/`row`/`str`/`num`・`COLUMNS`・`setCells`/`insertRows`/`deleteRows`・`serverEnvelope`・`operationsMessage`）と `/inprocess-transport`（`InProcessHub`・`InProcessTransport`・`FaultProbabilities`・`FaultCounters`）。**本体バレルは server-core 非依存**（ブラウザー安全）＝Room 依存の InProcessHub はサブパスのみで隔離。
- **依存**: `packages/sheet-collaboration/package.json` は `dependencies` 無し（空）・`devDependencies` は内部 `@nanairo-sheet/{sheet-core,sheet-server-core,sheet-types}` のみ＝**外部ランタイム依存ゼロ（ADR-022）**。tsconfig は sheet-core 同型（lib:ES2022・types:[]）。
- **import 差替（collaboration-server・挙動変更なし）**: `ws-transport.ts`（decodeServerMessage・ClientTransport/TransportListener を package へ／rawDataToString は `../ws-frame` 残置）・`server.ts`（decodeClientMessage を package へ）・`server.smoke.test.ts`・`test/{convergence,protocol-contract,restart-restore,ws-convergence}.test.ts`（deps/session/test-support/inprocess を package・サブパスへ／ws-transport は local 残置）の計7ファイル。`package.json`（sheet-collaboration を devDep 追加・`typecheck:core` は下記で新設し直し）・`tsconfig.json`（コメント更新）を更新。旧 `apps/collaboration-server/tsconfig.core.json` は**削除**（env-free 検査の責務を新パッケージへ移管）。
- **🔬 機械検証（全 green）**: `npm run test`=**36 files / 362 tests**（移設前と**同数**＝件数一致・間引き0。移設4テストは `packages/sheet-collaboration/src/` から実行）／`npm run typecheck`（新パッケージ含む全 workspace・new pkg は types:[] で env-free 検査）／`npm run lint`／`npm run build`（playground）／`bash scripts/doc-check.sh`＝いずれもエラー0。`sheet-collaboration` の `dependencies` は空（外部ランタイム依存ゼロ）を確認。
- **😈 DA 批判レビュー**: DA 表 #1〜#3（env-free ゲート失効→復旧・message-codec 移設判断・移設健全性〔循環なし/件数不変/依存ゼロ〕）。
- **🧑‍⚖️ Codex レビュー（必須・xhigh）**: 依頼書 `DD-005/codex-review-phase1-request.md`→`bash scripts/codex-review.sh --uncommitted --effort xhigh`→結果 `DD-005/codex-review-phase1-result.md`。**挙動一致を Codex が確認**（「移設された実装・テスト9ファイルは旧HEADと完全一致し、import差し替えにも挙動変更はありません」）。**findings 1件 [P2] を対応**: 新パッケージの唯一 tsconfig が `*.test.ts` を含むため vitest→@types/node が混入し、実装ファイルの env-free 純度検査が実効を失う指摘。→ `packages/sheet-collaboration/tsconfig.core.json`（`include:src/**/*.ts`＋`exclude:*.test.ts`・types:[]）＋`typecheck:core` を新設して DD-003 の旧ゲートを復旧。probe（`process` 参照を実装ファイルへ一時挿入）で **main typecheck=exit0（素通り＝指摘の再現）／typecheck:core=exit2（検出）** を実測し、ゲート実効性を確認（probe は削除済み）。見送り findings 無し。
- **スコープ・コミット**: 触れたのは `packages/sheet-collaboration/`（新規）・`apps/collaboration-server/`（import差替＋config）・本DD本文＋`DD-005/`（Codex 依頼/結果）・ルート `package-lock.json`（新ワークスペース登録の `npm install`）のみ。**コミットはしない**（オーケストレータが実施）。実装中、並行セッション由来の untracked `doc/DD/DD-006/*.md` を作業ツリーに一時観測（**本 Phase 1 の成果物ではない**。最終確認時は status から解消済み）。並行運用のため `git add -A` は避け、Phase 1 成果物のみを add することを推奨。**Phase 1 で停止・Phase 2 以降は未着手**。→ Phase 1 は `bbd7f49` でコミット済み（27ファイル・移設9ファイルは git R100=byte-identical・独立再検証で 362 テスト green）。

**Phase 2/3 実装アドバイス反映（2026-07-12・`phase2-3-advice-20260712.md`）**:
- 外部アドバイス12点を評価し**全採用**（受け入れ基準・スコープ不変）。最重要＝**単一正本**（ClientSession=Document State の唯一の正・Canvas/IME に第二第三の文書を作らない）。
- 反映先: 新設「Phase 2/3 詳細設計・状態所有権」節（#1状態所有権表／#2 document-view=Adapter限定／#5更新コスト分離／#10データフロー＝設計ゲート／#3 cell-level beforeRevision／#4 RowId再解決／#7 Commit順序／#8 rollback中IME不変／#9競合表示headed確認）。#6初期snapshot計測はPhase 2タスクへ・#11既知境界はNon-Goals再確認・#12本文同期（DD-004完了/sheet-collaboration存在/Phase 0前提チェック済）。
- **#10 設計ゲート**: 「Phase 2/3 詳細設計・状態所有権」節をユーザー確認 → 所有権・データフローが一意と合意後に Phase 2 実装エージェントを再起動（アドバイス末尾「所有権とデータフローが一意なら以後は合意済みスコープ内として自動継続可」に従う）。停止した Phase 2 エージェント（書込前）は破棄コストゼロで停止済み。

**Phase 2 実装（統合ページ土台・2026-07-12）**:
- **確定したデータフロー（#10 各辺）**: `WS フレーム(JSON文字列)`→`browser-transport`（JSON.parse→decodeServerMessage→ServerMessage・不正は drop+log・切断は自動再接続）→`観測 decorator`（**session→observer の順に固定**）→`ClientSession.handleServerMessage`（committed/view を更新＝**唯一の正本**・rollback/replay もここ）→`observer`（operations の Operation 種別だけ見て dirty を立てる）→`DocumentView`（cell/row-structure/viewport の dirty）→`(rAF)flush`（構造Op時のみ rowAxis を displayRowOrder から再構築・SetCells は Axis 不変）→`base-layer`（可視 display-index 範囲のみ queryRange で ClientSession 文書を直読み描画）。**再接続経路**: 切断→onDisconnected→再接続 onConnected で `markFullRebuild`→catch-up で committed 再収束→次 flush で Render 全再構築。**RowId/ColumnId 維持**: 描画・編集対象は RowId/ColumnId で保持し、表示直前に Axis で index 解決（#4）。
- **RowId 安定の担保方式**: rowAxis を **RowId 列（displayRowOrder）** で構築し、`rowAxis.getIndex(RowId)` で表示 index を都度解決。行挿入で display index がずれても同一 RowId は新 index へ解決される（ユニット `InsertRows で RowId 追従` で検証＝r2 が index 2→3）。DocumentView は index キーの独自セル格納を持たない（read-through）ため DD-004 chunk-store の index キー簡略化問題（AC4 不成立）を**構造的に回避**。
- **document-view が第二 CellStore でないことの説明**: DocumentView は**セル状態を一切保持しない**。`store.queryRange` は可視範囲だけを `getCell(ClientSession文書, RowId, ColumnId)` で直読みし、`store.set`/`bulkLoad` は throw で禁止（編集は必ず `ClientSession.submitLocalOperation` へ）。保持するのは Render State（rowAxis/colAxis・dirty flag）のみで、いつでも ClientSession から再構築可。三重管理（ClientSession文書/Canvas独自文書/IME旧cell-store）は発生しない。
- **#5 コスト分離の実装（SetCells で全再構築しない根拠）**: SetCells 受信は `cell` dirty のみ→次フレームで**可視範囲だけ**文書を読み直す（rowAxis/colAxis は不変・`structuralRebuildCount` は増えない・同一 Axis 参照のまま＝ユニットで検証）。50,000行 Axis・100,000セルの再走査は一切しない。InsertRows/DeleteRows のみ rowAxis を全再構築（PoC 許容）＋scroll anchor 補正（`captureAnchor`/`correctScroll` を main が bracket）。
- **browser-transport 再接続方針**: OPEN=即送信／CONNECTING=outbox バッファ→open で flush／CLOSING・CLOSED=drop（未 ACK pending は ClientSession が §8.5 で再送）。予期しない close→handleDisconnected→タイマーで再接続→同一 clientId で再 join。明示 close は再接続停止。SocketFactory/TransportTimer を注入して DOM/WS 無しでユニットテスト（TimerHandle は不透明トークン）。
- **シード方式**: `seed-dataset.ts`＝決定論 mulberry32。InsertRows 1件（row-1..row-50000）＋SetCells 10バッチ（各10,000変更・計100,000）を Sequencer.submit（operationLog 11件）。join した各クライアントがこの 11 件を replay して committed を構築（＝唯一の正本経路）。`/config` に columnOrder（col-0..col-199）を追加しクライアントが同一列順で ClientSession を構築。`--integration` フラグで有効化。
- **#6 初期 snapshot 計測結果**（`DD-005/initial-load-metrics.md`）: サーバー実測＝seed 生成 472.9ms・snapshot 32.28MB・**operations 転送 18.29MB**。実 WS 実測（node ClientSession de-risk）＝**join→収束 897ms・client/server hash 一致（`613165c94ea46b6b`）・50,000行/100,000セル・pending 0**。ブラウザー側スパン（parse/axisBuild/firstDraw/firstOperable）は計測ハーネス実装済み＝headed smoke で記入。DD-007 引き継ぎ＝毎 join で 18.3MB replay（snapshot ベース初期化は ClientSession への API 追加が要るため Phase 2 対象外）。
- **🔬 機械検証（全 green）**: `npm run test`=**41 files/398 tests**（Phase 1 の 362 から +36〔seed 6・document-view 10・session-sync 7・browser-transport 9・initial-load-metrics 4〕・**回帰 0**）／`typecheck`（全 workspace）／`lint`／`build`（poc-integration.html＝integration bundle 29.7KB・server-core 非依存）／`doc-check`／`test:e2e`=**11 passed**（DD-002 環境 回帰 0）。
- **😈 DA 批判レビュー**: DA 表 #4〜#7（二重状態の芽・#5 全再構築の混入・約10万セル初期転送・既存エントリー凍結の破れ）。
- **スコープ・コミット**: 触れたのは `apps/playground/src/integration/`（新規 9 ファイル）・`poc-integration.html`・`vite.config.ts`（input 追加のみ）・`apps/playground/package.json`（sheet-core/sheet-collaboration を devDep 追加）・`apps/collaboration-server/`（`seed-dataset.ts`＋`server.ts` seed/config・`package.json` script）・本DD本文＋`DD-005/initial-load-metrics.md`・ルート `package-lock.json`（npm install 差分）のみ。**既存 index.html・poc-b.html・src/{grid,ime,pocb}・packages/sheet-collaboration は無改変**（import のみ）。**コミットはしない**（主セッションが実施）。**Phase 2 で停止・Phase 3 以降は未着手・Codex は Phase 4**。

**Phase 2 headed 2タブ smoke（主セッション・Playwright MCP・2026-07-12）= PASS**:
- 2タブ（Alice/Bob・`localhost:5250`(Vite)→`127.0.0.1:8790`(WS)）で成立: 両タブ 接続online・50,000行・初期 revision 11（シード replay）→ Canvas 描画（固定行列・仮想スクロール・シードセル K2「未着手」/J21「7913.37」）→ Alice が空セル F14 を編集し `SMOKE-77` 確定（revision 12・pending 0）→ **Bob へ伝播**（F14=SMOKE-77・revision 12）・conflicts 0。**ClientSession 単一正本の設計が実ブラウザーで end-to-end 成立**。証跡 `dd005-alice-loaded.png`（50,000行描画）・`dd005-alice-edit.png`（Alice編集）・`dd005-bob-reflected.png`（Bob反映）。#6 ブラウザー実測を `initial-load-metrics.md` へ記入（toFirstOperable Alice ~1.05s / Bob ~1.56s）。
- **headed smoke が実行時バグ2件を検出（ユニット緑・実行時破綻＝engineering-patterns #1）→ 主セッションが修正・再検証**:
  - **(1) CORS**: 統合ページ（別オリジン）→ dev サーバー `/config` fetch が `Access-Control-Allow-Origin` 無しでブロック（「起動失敗: Failed to fetch」）。→ `apps/collaboration-server/src/server.ts` に `hono/cors` の `app.use('*', cors())` を追加（**dev サーバーのみ**・別ポートの playground から fetch 可能に）。DA #8。
  - **(2) 初期ロード Axis crash**: `main.ts` masterLoop が構造Op時に flush（Axis再構築）より先に `captureAnchor` を呼ぶが、初回ロードは Axis が空（count=0）で captureAnchor が index=frozenRowCount を触り `Axis.getId 範囲外` 例外→rAF 停止→行数0。→ **本体行がある時だけ anchor を捕捉・補正**するガードを追加（初回構築は flush＋redraw のみ）。DA #9。
- 修正後の再検証: `typecheck`／`lint`／`build`（integration 29.8KB）／`test` **398/398** 全 green（回帰0）。両修正は DOM/WS 配線・dev サーバー config でありユニット非依存領域＝headed smoke（証跡）が回帰検査を担う。

**Phase 3 実装（IME×共同編集の結線・2026-07-12）**:
- **🔴 #3 protocol 検証（着手直後・最優先）＝cell-level で確定（停止不要）**: (a) `packages/sheet-core/src/operations.ts` の `SetCellsChange` に **`beforeRevision?: number`** が既存（per-change・per-cell）。(b) 同 `document.ts` の `CellRecord.lastChangedRevision` を `getCell(doc,rowId,columnId)` で取得可（未書込セルは undefined→**0** とみなす＝server と一致）。(c) server が **セル単位で照合**（`validate.ts` `validateSetCells`: `change.beforeRevision !== (getCell(...)?.lastChangedRevision ?? 0)` で `stale-cell-revision`／`sequencer.ts` が reject）。→ **両 Yes ＋ server 実装もセル単位ゆえ cell-level 実装**。「別セルの更新だけでは同一セル競合にならない」を **server の `validateOperation` に対して検証**するユニットを必須実装（`commit-bridge.test.ts`＝col-1 更新で doc.revision=3 でも col-0(rev2) の SetCells は違反0／文書全体 revision=3 を beforeRevision に使う誤実装なら stale になる対比も assert）。**sheet-collaboration/sheet-core/protocol は無改変**。
- **イベントフロー確定（実装前詳細化）**: `編集開始(BeginEdit)` → 表示 index→RowId/ColumnId 解決＋**committed セル revision を startRevision に凍結**（EditTarget）→ `変換(compositionstart/update/input)` は状態機械が draft を保持（textarea＝ローカルが正・I-1/I-3）→ `確定(Enter/Tab/blur→Commit effect)` → **#7 順序**（最終input後 draft→対象 RowId/ColumnId 生存確認→凍結 beforeRevision→SetCells 生成→`submitLocalOperation`→ACK/reject）→ `reject` は ClientSession が Conflict Queue へ（自分の値を deep copy 保全）。`リモート更新` は observer→ClientSession committed のみ更新し **IME へ入れない（#8）**、`noteServerUpdate` で編集対象行の**削除だけ**を検知して退避（AC4）。`editingCell 発行`＝BeginEdit で発行・Commit/Cancel で解除。
- **IME結線方式（状態機械の統合点・resident-textarea を改変しない判断）**: DD-002 の資産のうち **`editor-state-machine.ts`（IME 正しさ＝composition・順序A/B・I-1〜I-5 の純粋状態機械）を無改変で再利用**。`resident-textarea.ts` は「固定 index・`GridLayout` 幾何・grid `CellStore` への Commit・DD-002 のクライアント側 MarkConflict モデル」に構造結合しており、統合の「RowId/ColumnId＋ViewportTransform＋ClientSession＋サーバー権威 beforeRevision」へ曲げるには**凍結中の受入環境ファイルを非最小に改修＝回帰リスク**が高い。ゆえに **resident-textarea/src/ime を零改変**（＝「最小変更のみ許容」の最も安全側）とし、統合側に新規 DOM アダプタ `integration-editor.ts`（常駐 textarea §11.3 パターン・value/selection/DOM親は composition 中不変・Navigation は pointer-events:none で下の scroller へクリック透過・textarea 配置は ViewportTransform）を実装。ロジックは DOM 非依存の `ime-editing-session.ts`（状態機械を包み editingTarget を RowId で所有・#7 Commit・#8 不変・AC4 退避）に集約し node でユニット検証。**（起票の「resident-textarea 最小変更」という字面からの逸脱＝ユーザー合意スコープ〔Phase 3=IME結線／状態所有権 #1〜#9〕内の実装選択。AC/spec/UX 不変ゆえ継続。DA #10 に記録）**
- **作成ファイル（すべて `apps/playground/src/integration/`・新規）**: `commit-bridge.ts`（#3/#7/#9 純関数＝captureEditStartRevision・draftToScalar・resolveCommit・isEditTargetStale）／`editor-placement.ts`（§13.5 pane 区別の配置純関数）／`presence-adapter.ts`（UserPresence→overlay PresenceUser 変換）／`ime-editing-session.ts`（DOM 非依存コア＝TextareaPort 抽象注入）／`integration-editor.ts`（実 textarea DOM アダプタ＋#9 競合 badge）。各 `.test.ts`。**変更**: `main.ts`（plain input→integration-editor・Presence 送受信・#9 インジケーター・scroll 追従・onOperations→noteServerUpdate）／`document-view.ts`（`rowIdAt`/`columnIdAt` を public 化＝#4 解決用・挙動不変）／`poc-integration.html`（旧 `#int-editor` input 撤去・ヒント更新・Phase 3 表記）。
- **commit-bridge の順序・reject→Conflict Queue（#7/#9）**: Commit は resolveCommit で**生存確認（tombstone/列存在）を先に**行い、削除済みなら `target-deleted`＝submit せず退避（無効 RowId へ Commit しない・#4）。生存なら **凍結済み startRevision を changes[].beforeRevision に**して SetCells 生成→`submitLocalOperation`。reject は ClientSession 既存機構が Conflict Queue へ（自分の値保全）。#9 は **committed セル revision と startRevision の乖離**（`isEditTargetStale`）で編集中に検知し、textarea の赤枠＋**textarea より上（z-index 12）の badge に他者確定値**を出す（textarea がセル全面を覆ってもサーバー値と自分の draft を同時識別）。**リモート更新を状態機械へ dispatch しない**＝競合はサーバー beforeRevision に一本化し、A は確定でき server reject を受ける（AC2 に忠実・#8）。
- **AC4（RowId 安定・削除退避）**: 行挿入→`refreshPlacement` が **editingTarget.rowId→現在 index を再解決**して textarea を追従配置（構造Op で display index がずれても同一 RowId）。編集対象行の削除→`noteServerUpdate` が **tombstone 判定**（index 範囲でなく `isRowLive`）で検知し、draft を `divertedDrafts`（Conflict Queue 相当の非破棄証跡）へ退避＋状態機械を安全セルで作り直し＋textarea を隠す。防御として削除後 Enter の Commit も `resolveCommit`→`target-deleted` で無効 RowId へ submit しない。
- **#8 不変テスト**: `ime-editing-session.test.ts` で (i) fake TextareaPort＋可変 committed／(ii) **実 ClientSession の rollback/replay**（別セルに pending を持たせ・B が同一セルを rev3 で確定→reconcileServerOperation）両方で、AC2 同一セル更新の前後に `textarea.value`／`selectionStart/End`／`setValue 呼出回数`／editing RowId/ColumnId/startRevision／`isComposing`／phase／draft／activeCell が**不変**で、`isConflicting()` だけ true になる（Document State は B-wins へ更新）ことを assert。別セル更新は競合にしない（セル単位・#9）も検証。
- **🔬 機械検証（全 green・回帰0）**: `test`=**45 files/434 tests**（Phase 2 の 398 から +36〔commit-bridge 14・editor-placement 6・presence-adapter 7・ime-editing-session 9〕・**回帰 0**）／`typecheck`（全 workspace）／`lint`／`build`（poc-integration.html＝integration 37.84KB・editor-state-machine を chunk 分離）／`doc-check`／`test:e2e`=**11 passed**（`src/ime`・`src/grid`・`index.html` 零改変ゆえ DD-002 回帰 0）。
- **😈 DA 批判レビュー**: DA 表 #10〜#14（resident-textarea 非改変の逸脱／§11.9 全7項目の再混入否定〔状態機械無改変＋アダプタが composition 中に value/selection/DOM親を書かない〕／編集開始 revision 取り違えの否定〔startRevision 凍結〕／#9 z-index 被覆／AC4 削除時の composition 中断の既知境界）。
- **スコープ・コミット**: 触れたのは `apps/playground/src/integration/`（新規 5＋test 4・変更 main.ts/document-view.ts）・`poc-integration.html`・本DD本文のみ。**`packages/*`・`src/ime`・`src/grid`・`index.html`・`poc-b.html`・`apps/collaboration-server` は無改変**。**コミットしない**（主セッションが実施）。**Phase 3 で停止・Phase 4（統合E2E・Codex）以降は未着手・Codex は Phase 4**。

**Phase 3 headed smoke（主セッション・Playwright MCP・2026-07-12）= PASS（AC2 中核を実ブラウザーで実証）**:
- 独立検証: `npm run test` **45 files/434 tests green**（398→+36・回帰0）・typecheck/lint/build/doc-check/E2E 11・**git 差分に `src/ime` なし＝零改変を裏付け**。
- 2タブ（Alice/Bob・`localhost:5250`(Vite)→`127.0.0.1:8790`(WS)）: クリーン起動（console error 0）→ 新 IME editor（常駐 `textarea.int-cell-editor`・§11.3）で編集→クロスタブ反映（Bob→Alice revision 12）→ **Presence overlay（#10）**（Alice 上に Bob のネームタグ付きカーソル）。
- **#9 競合表示（AC2 中核・統合シナリオ 1〜8）**: Alice が同一セルを編集中（draft `AL-DRAFT`）に Bob が `BOBWIN` 確定 → Alice の Canvas は revision 13（Bob 値へ）／**IME draft `AL-DRAFT` は保持**（サーバー値で上書きされず・#8）／赤バッジ「⚠ 他者の確定値: BOBWIN」＋ステータス警告を**同時提示**（textarea を隠さない z-index・#9）→ Alice が Enter 確定 → **beforeRevision 不一致で reject → Conflict Queue（conflicts: 1）** → 全体 revision 13 収束。証跡 `dd005-p3-alice-presence.png`（Presence）・`dd005-p3-alice-conflict.png`（#9 競合）。
- Phase 2 の CORS/初期Axis のような**実行時バグの再発なし**。**実IME の候補ウィンドウ・確定Enter順序A/B は Phase 5 実機ゲート**（Playwright 不可）。統合シナリオ 9（スクロール追従）・10（Presence 全種）と AC3/AC4 の実機確認も Phase 5 手順に含む。
- **要判断: なし**（#3 は cell-level で成立し停止不要。resident-textarea 非改変はスコープ内の実装選択として継続・DA #10 記録）。

**Phase 3 headed smoke 実行手順（主セッションが Playwright MCP で実行・#9競合表示＋変換中スクロール追従）**:
- **準備**: `npm run dev:integration --workspace apps/collaboration-server`（collaboration-server を `--integration` シードで起動＝既定 WS ポート **8787**・50,000行×200列。CORS 済）＋`npm run dev`（Vite・playground・既定 **5173**）。2 タブで `http://localhost:5173/poc-integration.html?name=Alice`（既定で `127.0.0.1:8787` へ接続。別ポート時は `&server=http://host:port` を付与＝主セッションが実ポートで置換）と `...?name=Bob`。両タブ online・50,000行・シードセル描画を確認。
- **AC2/#9 競合表示（同時識別）**: ①Alice が空セル（例 F14）をクリック→日本語入力（合成 composition 可・確定はまだ）。②Bob が同 F14 をクリック→別値を入力し Enter 確定。③**Alice の確認項目**: Canvas に Bob の確定値が反映（Document State）／**textarea には Alice の draft が維持**（未確定文字が消えない・#8）／**赤枠＋上部 badge「⚠ 他者の確定値: …」が textarea を隠さず同時に見える**（#9 z-index）。④Alice が Enter で確定→**beforeRevision 不一致で reject→conflicts が +1・退避は ClientSession Conflict Queue**（readout で conflicts 数）。最終的に両タブ・サーバーが Bob 値へ収束。
- **AC3 変換中スクロール追従（#8）**: Alice が下方セル（例 row 500）で日本語変換を開始→変換中に縦横スクロール→**textarea が同一 RowId/ColumnId のセルへ追従し value/未確定文字が不変**・固定行列境界をまたいでも位置ずれなし。
- **AC4 構造変更**: (i) Alice 編集中に Bob が上へ行挿入→Alice の textarea が同一 RowId へ追従（index 再解決）。(ii) Alice 編集中に Bob が編集対象行を削除→Alice の textarea が退避（readout「退避draft」+1・無効セルへ Commit されない）。
- **実IME との区別**: 合成 composition で代替できるのは「状態遷移・追従・#9 レイアウト」まで。**実 IME の候補ウィンドウ・確定 Enter 順序A/B の実機観察は Phase 5 実機ゲート**（Playwright では実 IME を通せない・§11.8/§20.5）。証跡は `DD-005/` へ 📸（Phase 4 で integration-evidence.md に整理）。

---

## DA批判レビュー記録

> 手順・品質フィルター・再チェック条件は `doc/da-method.md` を参照。

### 共通DA観点（全Phase必須）

**§11.9 禁止事項の再混入**（統合結線は DD-002 単体実装より再発しやすい）と、**移設・結線での挙動改変**（DD-003 資産は挙動保存が原則。DD-002/004 の受入環境＝`index.html`・`poc-b.html`・`src/grid/` の凍結維持）を毎Phaseで確認する。

| # | Phase | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------|-------------------|--------|----------------------|--------|------|
| 1 | 1 | 新パッケージの唯一の tsconfig（types:[]・*.test.ts 同梱）では、テストの `vitest` import が @types/node を program へ持ち込み、実装ファイル（session/message-codec 等）に Node/DOM API が混入しても typecheck が素通りする。DD-003 の旧 `tsconfig.core.json`（テスト除外）が担っていた env-free 回帰ゲートが移設で失効していた | 中 | `packages/sheet-collaboration/src/_probe.ts` に `export const _p: unknown = process;` を置き `npm run typecheck --workspace packages/sheet-collaboration` → exit 0（素通り） | 移設に伴う品質ゲートの後退（挙動改変ではないが env-free 回帰検査の喪失） | `packages/sheet-collaboration/tsconfig.core.json`（`include:src/**/*.ts`＋`exclude:*.test.ts`・types:[]）＋`typecheck:core` を新設。同 probe で core=exit 2（Node API 検出）を確認し復旧。Codex [P2] と同一指摘 |
| 2 | 1 | `message-codec.ts` は server（server.ts）と client（ws-transport）双方が import する共有 JSON codec。基準（トランスポート非依存・ランタイム依存ゼロ＝純粋・sheet-core 型のみ）を満たすため sheet-collaboration へ移設したが、「client 中心パッケージ」に server も依存する構図になる | 低 | —（設計判断） | パッケージ責務境界（過剰移設の疑い） | 基準合致ゆえ移設は妥当。Phase 2 の browser-transport が `decodeServerMessage` を app 間結合なしに再利用できる利点あり。公開API/依存として報告・本ログに明記しユーザーレビューへ回す（挙動・依存ゼロは不変ゆえ要判断ではない） |
| 3 | 1 | 移設で循環依存の混入・テスト件数減・外部ランタイム依存の混入が起きていないか（挙動保存リファクタの健全性） | 低 | —（確認項目） | 移設健全性（挙動改変・テスト間引き・依存逸脱の否定） | 循環なし（`index→session/deps/message-codec` の一方向・server-core は本体バレル非経由でサブパス `/inprocess-transport` のみ）。テスト 362→362（不変・Codex も移設9ファイルが旧HEADと byte-identical と確認）。`dependencies:{}`（外部ランタイム依存ゼロ） |
| 4 | 2 | **二重状態の芽**: DocumentView が描画高速化のため index キーのセルキャッシュ（chunk-store）を持つと、ClientSession と別の永続セル状態＝第二 CellStore になり、構造Op でキャッシュ shift の同期漏れ・staleness を生む（#2 違反経路） | 高 | 仮に `store.set` を DocumentView に開放し観測者以外が書けば、ClientSession と乖離した値が描画され得る | #2 第二 CellStore の混入 | **キャッシュを持たない read-through Adapter に設計**（queryRange が可視範囲だけ ClientSession 文書を直読み）。`store.set`/`bulkLoad` は throw で構造的に禁止（ユニット `store への書き込みは禁止` で検証）。派生 State は rowAxis/colAxis と dirty flag のみ＝いつでも再構築可。三重管理は発生しない |
| 5 | 2 | **#5 全再構築の混入**: SetCells 受信のたびに rowAxis や 100,000 セルを作り直す実装に退行すると、通常編集で 50,000行 Axis 全再構築＝性能劣化（#5 違反） | 中 | SetCells flush 後に `structuralRebuildCount` が増える／`rowAxis` 参照が変わるなら退行 | #5 更新コスト分離 | SetCells は `cell` dirty のみ＝rowAxis 不変（`structuralRebuildCount` 据え置き・**同一 Axis 参照**をユニットで assert）。可視範囲だけ読み直す。構造Op のみ rowAxis 再構築（PoC 許容）。session-sync ユニット `SetCells だけの受信では rowAxis を再構築しない` でも二重に担保 |
| 6 | 2 | **約10万セル初期転送コスト**: seed を Operation ログとして持ち join ごとに全 replay すると operations が約18.3MB／接続。初回描画・操作可能までの遅延（#6） | 中 | サーバー実測 operations 18.29MB・node 実 WS join→収束 897ms（`initial-load-metrics.md`） | #6 初期 snapshot 経路 | 合否でなく**記録**（#6 の趣旨）。計測ハーネス（onServerFrame＋load-metrics）を実装し headed で採取。DD-007 引き継ぎに「snapshot ベース初期化（ClientSession API 追加）で replay clone を省く候補」を明記。密度・メモリ検証は DD-004/006 担当ゆえ本 PoC はスコープ外 |
| 7 | 2 | **既存エントリー凍結の破れ**: 統合実装で index.html・poc-b.html・src/{grid,ime,pocb} を改変すると DD-002/004 受入環境が回帰する | 中 | 既存 E2E（11件）・pocb ユニットが落ちれば破れ | 凍結維持（受入環境の非改変） | 新規は `src/integration/` と `poc-integration.html`・`vite.config.ts`（input 追加のみ）に限定。pocb は **import のみ**（axis/viewport/base-layer 等・無改変）。E2E 11 passed・全既存テスト green で回帰 0 を確認 |
| 8 | 2 | **CORS 未設定で統合ページがサーバーへ接続不能**: Vite(別ポート)配信の統合ページが WS サーバーへ `/config` を fetch するがクロスオリジンで CORS ヘッダ無し→「起動失敗: Failed to fetch」。ユニットは同一プロセス/ws-transport でクロスオリジン fetch を通らないため未検出 | 高 | headed 2タブ smoke の Alice console に `blocked by CORS policy: No 'Access-Control-Allow-Origin'`＋起動失敗表示 | 実行時ギャップ（ユニット緑・ブラウザーで接続不能） | dev サーバー `server.ts` に `hono/cors`（`app.use('*', cors())`）を追加＝/config が ACAO を返し接続成立。**dev 用途のみ**（本番の同一オリジン化 or CORS 設定は Phase 1 で決める） |
| 9 | 2 | **初回ロードで空 Axis に captureAnchor→範囲外例外→行数0**: masterLoop が構造Op時に flush より先に anchor 捕捉するが、初回（空Axis count=0）は index=frozenRowCount(=1) が範囲外で例外→rAF 停止→50,000行が描画されない | 高 | headed smoke で revision=11 だが行数=0・console `Axis.getId: 範囲外 index=1（count=0）@ captureAnchor←masterLoop`。unit は document-view.flush 単体を検証し masterLoop の anchor-before-flush 経路を通らず未検出 | 実行時ギャップ（DOM masterLoop の初期化順序） | `main.ts` で `view.rowAxis.count() > frozenRowCount` の時だけ captureAnchor/correctScroll を実行（初回構築は flush＋redraw のみ）。修正後 行数=50,000・crash 消失を headed で確認 |
| 10 | 3 | **resident-textarea 非改変の逸脱**: 起票は「resident-textarea.ts（最小変更）で ViewportTransform 配置」を指示。しかし resident-textarea は固定 index/`GridLayout`/grid `CellStore` Commit/クライアント側 MarkConflict に構造結合し、RowId＋ViewportTransform＋ClientSession＋サーバー権威 beforeRevision へ曲げると凍結中の受入環境ファイルを非最小改修＝回帰リスク | 中 | —（設計判断） | 凍結維持 vs 起票字面。ユーザー合意スコープ（Phase 3=IME結線・状態所有権 #1〜#9）逸脱の有無 | **状態機械（editor-state-machine）は無改変で再利用**し resident-textarea/src/ime を**零改変**（＝最小変更の最も安全側）。統合側に新規 DOM アダプタ＋DOM 非依存コアを実装。AC/spec/UX は不変ゆえスコープ内の実装選択として継続（要判断化せず）。E2E 11・ime 既存テスト回帰0 で凍結を実証 |
| 11 | 3 | **§11.9（I-1〜I-5）の再混入**: 統合結線で「composition 中に textarea.value/selection/DOM親を書く」「別 input へフォーカス移す」「確定 Enter を通常 Enter 扱い」が再混入すると IME が壊れる | 高 | 仮に refreshPlacement が value/selection も書けば I-3 違反。reconcile が composition 中に value を書けば違反 | §11.9 再混入 | 状態機械は無改変（I-1/I-2/I-4 保持）。アダプタは **composition 中は position(left/top/width/height) のみ**書き value/selection/DOM親は不触（`reconcile` は `isComposing` で value/visual をスキップ）。入力受け口は常駐 textarea 1 本・Navigation は pointer-events:none でフォーカス移さず（I-5）。#8 テストが noteServerUpdate 前後で setValue 非呼出を assert |
| 12 | 3 | **編集開始 revision の取り違え**: beforeRevision を **Commit 時**に取ると、編集中に B が確定した後の値（新 revision）を beforeRevision にしてしまい server が競合を検知できず**サイレント上書き**（AC2 破綻） | 高 | もし resolveCommit が `getCell(...).lastChangedRevision` を Commit 時に読むと、B 確定後は current==before で reject されない | 編集開始 revision の凍結 | **startRevision を BeginEdit で committed から取得し EditTarget に凍結**（以後サーバー更新で変えない・#8 テストで before=2 が B の rev3 後も 2 のまま assert）。commit-bridge テストで「文書全体 revision を使う誤実装は stale」対比を server validateOperation に対して確認 |
| 13 | 3 | **#9 競合表示の被覆**: textarea がセル全面を覆うと、Canvas のサーバー確定値が隠れて「A の draft・サーバー値・競合」を同時識別できない（overlay Canvas は textarea より下で被覆される） | 中 | overlay に競合枠を描いても textarea(z10) が覆う | #9 z-index/被覆 | 競合 badge を **textarea より上（z-index 12）** の DOM 要素にし、セル上端の外側（y-16px）へ配置＋他者確定値を表示。textarea には赤枠。**headed で同時識別を証跡**（主セッション・下記手順）。ユニットは `isEditTargetStale`（#9 検知）を検証 |
| 14 | 3 | **AC4 削除時の composition 中断（既知境界）**: 編集対象行が変換中に削除されると draft を退避し状態機械を作り直すが、ブラウザー IME の候補ウィンドウは JS から確実に取消せず、直後の compositionend/input が新状態機械（Navigation）へ届きうる | 低 | 実 IME で変換中に他者削除（Phase 5 実機） | 実行時境界（ブラウザー IME 状態の非制御性） | draft は `divertedDrafts` へ**非破棄で退避**し無効 RowId へ Commit しないことは保証（ユニット済）。変換中断の実挙動は **Phase 5 実機ゲート**で観察（synthetic では制御可）。DD-007 引き継ぎ候補に記録 |
