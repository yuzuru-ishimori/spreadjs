# DD-007 Phase 0 Go/No-Go 判定材料一式（go-nogo-package）

> **状態: 記入済み（DD-007 Phase 1・2026-07-12）**。着手条件（DD-002〜DD-006 全完了）成立後、各DD本体・計測レポート・試験証跡・ADRドラフトを出典として集約した。
> **§7 の判定欄・DD本体の決定事項は空欄のまま**であり、Go/条件付きGo/No-Go の判定は**ユーザー判定ゲート（Phase 2）**で行う。エージェントは材料の集約・§18.6基準との対照・所見整理までとし、判定はしていない。
>
> 正典: 計画書 §18.6（Go/No-Go基準）・§21（性能SLO）・§22（リスク）、`doc/DD/DD-007_Phase0GoNoGo判定.md`、製品憲章 `doc/product/nanairo_sheet_product_charter_v1.md`。
> 集約方法: DD-002/003/004/005（`doc/archived/DD/`）・DD-006（`doc/DD/DD-006/`）・ADRドラフト（`doc/adr/`）・計画書 §18 の一次資料を突合。数値が出典間で食い違う箇所は隠さず**⚠️注記**する。

## 証拠レベルの定義

| レベル | 証拠 |
|---|---|
| A | 自動試験で再現可能。raw結果・seedあり |
| B | headed実測。JSON・スクリーンショット・環境情報あり |
| C | ユーザー手動確認。詳細記録またはトレースあり |
| D | 申告のみ、または証跡なし |
| E | 未実施 |

> **Hard Gate 合格の証拠要件**: Hard Gate（未達ならNo-Go の項目。§7参照）を **D または E だけで合格にする場合は、合格とみなさず「残存リスク」または「条件付きGo」として扱う**。

---

## §1 PoC-A〜D 合格条件×実測値の対照表

> PoC↔DD 対応: PoC-A=DD-002（§18.1・6条件）／PoC-B=DD-004（§18.2・5条件）／PoC-C=DD-003（§18.3・5条件）／PoC-D=DD-006（§18.4・5条件）。判定欄は各DDが記録した結果を転記し、証拠レベルを併記する（Hard Gate としての強さの評価は §7）。

### PoC-A（DD-002・日本語IME・§18.1）

> **重要**: 各条件は「(a) 自動/synthetic層＝合成イベントで状態機械ロジックを検証（実IMEではない）」と「(b) §18.1が要求する実機受入（実IME判定）」の二層。(b) は全条件ともユーザー口頭申告のみが根拠で、実機トレース・記入済み記録・実IME📸は**ゼロ件**（`doc/archived/DD/DD-002/traces/phase6-acceptance/` は `.gitkeep` のみ）。合成参照README（`…/synthetic-reference/README.md` L10-13）が「R-01 の核心は合成トレースでは判定できない、実機でのみ現れる」と明記。

| # | 合格条件（§18.1・計画書 L1615-1620） | 実測値・結果 | 判定 | 証拠レベル | 出典 |
|---|---|---|---|---|---|
| A-1 | 各対象環境で50回連続入力し、先頭文字欠落0件 | 直接カバーする自動試験なし（実機のみ判定可）。4環境の実機試験は「実施した」との申告（口頭「全部OK」）だが、記録・トレースは未保存 | 合格（申告） | **D**（実機申告）／トレース・観察記録は**E**（→A-6） | `DD-002本文` L150-153, L263 |
| A-2 | IME確定Enterによる誤移動0件 | 状態機械が順序A/B両方をコード化・E2E `synthetic-composition` 2件green（合成）。**実発火順A/Bは未観察・未記録** | 合格（申告） | **A**（合成）／**D**（実機）・実発火順**E** | `DD-002本文` L116, L153, L253 |
| A-3 | 矢印／Enter／Tab移動後の再入力成功率100% | E2E `basic-operations` 7件green（ASCII・F2再オープンで値検証） | 合格（申告） | **A**（ASCII）／**D**（実機） | `DD-002本文` L252 |
| A-4 | 変換中のCanvas再描画で文字消失0件 | headed目視スモーク（ASCII "abc" draft保持）＋📸。実IME composition ではない旨明記 | 合格（申告） | **B**（headed・ASCII）／**D**（実機） | `DD-002本文` L240 |
| A-5 | 変換中のリモート更新でドラフト消失0件 | 状態機械 MarkConflictOnly ユニット＋simulator 6件＋📸（赤枠競合＋draft保持・ASCII） | 合格（申告） | **A+B**（ASCII）／**D**（実機） | `DD-002本文` L124, L240 |
| A-6 | イベントトレースを保存し、再現手順を文書化 | 再現手順書 `manual-ime-test-guide.md` 完備。**実IMEトレース保存は未実施**（申告で代替） | 部分（文書化のみ） | 文書化**C**／実IMEトレース**E** | `DD-002本文` L152, L264 |

補足（自動検証の堅さ）: 状態機械テスト52件・E2E 11件green・Codex 2ラウンド全指摘対応・実行時バグ2件を回帰E2E化（`DD-002本文` L224, L250, L266）。**ただし全て synthetic/ASCII で実IME挙動は非担保**。

### PoC-B（DD-004・Canvas仮想スクロール・§18.2）

> 実測値は**実機確認run（Run A・実Chrome 150・ユーザー手動・`overall=pass`）**を正とする。出典 `doc/archived/DD/DD-004/measurement-report.md`（以下 `report`）＋ JSON `pocb-measurement-realrun-20260712.json`（以下 `realrun.json`）。先行の MCP run（Run B）は `overall=n/a`。

| # | 合格条件（§18.2・計画書 L1636-1640） | 実測値（Run A・実機） | 判定 | 証拠レベル | 出典 |
|---|---|---|---|---|---|
| B-1 | 通常スクロールの95%フレームが33ms未満 | frame **p95 16.8ms**（over33比率1.1%・count 711） | pass | **B+C** | `report` L23／`realrun.json` `acceptance.ac1` |
| B-2 | 停止中の再描画8〜12ms以内を目標 | **平均0.33ms**（×20・目標を大きく下回る） | pass | **B+C** | `report` L24／`realrun.json` |
| B-3 | pointerから選択枠表示まで50ms未満 | 選択遅延 **worst 16.9ms**（35標本） | pass | **B+C** | `report` L25／`realrun.json` |
| B-4 | 10分連続スクロールでメモリが単調増加しない | 傾き **−78.97KB/s**・増加率0.486（純減＝リークなし）。**ただし厳密な10分連続フォアグラウンドsoakは未実施**（約8.5分スパン・非アクティブ区間含むproxy） | pass（傾向）／厳密soakは未達 | 傾向**B+C**／厳密10分soak**E** | `report` L26, L29 |
| B-5 | 50,000行でscroll anchorが維持される | **true**（挿入後51,000行・補正0.90ms） | pass | **A+B+C** | `report` L27／`scroll-anchor.test.ts` |

正式判定: `realrun.json` `acceptance.overall = "pass"`（`report` L13）。50,000行×200列・非空500,000セル成立（生成647.1ms・store概算15.9MB・JSヒープ約25.5〜29MB）（`report` §2 L59-68）。Presence overlay 20人の**同時可視は視覚証拠なし**（unit test担保・`report` §6）。

### PoC-C（DD-003・共同編集Operation・§18.3）

> 出典 `doc/archived/DD/DD-003_PoC-C共同編集Operation.md`（受け入れ基準表 L56-62）＋テスト実体（`apps/collaboration-server/test/`・現在は `@nanairo-sheet/sheet-collaboration` を import）。**5条件すべて証拠レベルA（自動seed試験）で、D/E の合格条件はゼロ**＝最も証拠が堅いPoC。

| # | 合格条件（§18.3・計画書 L1656-1660） | 実測値・結果 | 判定 | 証拠レベル | 出典 |
|---|---|---|---|---|---|
| C-1 | 10,000件のランダムOperation後に全クライアントhash一致 | 3〜10体×10,000件で committed hash==Room hash==ログreplay hash・構造deep-equal・二重適用0（ops/sec 5,300〜10,800・最大pending深度4〜8有界） | ✅収束 | **A** | `DD-003` L58／`convergence.test.ts` L448-503 |
| C-2 | Operation重複送信で二重適用0件 | 二通目は operations 非配信・ログ長/hash不変・同一ACK再返却／クライアント dedup で committedHash不変 | ✅ | **A** | `DD-003` L59／`protocol-contract.test.ts` L73-111 |
| C-3 | revision欠落を検知して自動catch-up | rev欠落→保留→requestCatchup{afterRev-1}（off-by-one無し）→追従→hash一致 | ✅ | **A** | `DD-003` L60／`protocol-contract.test.ts` L113-143 |
| C-4 | 同一セル競合でローカル入力を保持 | stale reject→conflictQueue保持（currentValue/currentRevision入り・pending除去）／切断経由reject喪失(D27境界)も再接続時 validateOperation でstale検出→Queue・消失0 | ✅ | **A** | `DD-003` L61／`protocol-contract.test.ts` L146-235 |
| C-5 | サーバー再起動後にsnapshot＋logから復元 | 実WSで250op収束→停止→snapshot整合(documentHash==replayHash)→同一ポート復元→hash一致・revision継続→A/B再接続catch-up・新規Cもfull catch-up収束 | ✅ | **A**（実WS） | `DD-003` L62／`restart-restore.test.ts` L69-157 |

Presence目視（§18.3合格条件外の追加スコープ）: headed 2タブでSetCell同期・Presenceバッジ・close即時removed確認・📸2点（**B**）。総テスト163件（sheet-core 68・sheet-server-core 51・collaboration-server 44）。
⚠️ **数値の出典間ズレ**: ops/sec は `DD-003`/impl-log が「5,300〜10,800」、ADR-005/008 が「≈5,000〜16,000」。reject/conflict は impl-log「136/610」・ADR-008「147/617」。フォールト発火 impl-log「7,378/8,677/10,958/215」・ADR-005「7,408/8,728/10,847/208」。**収束はseed固定・決定論のため正準値は該当seed再実行で確定が安全**（転記時点差＝Codex修正前後に起因の可能性）。一致値: 163テスト・最大pending深度4〜8。

### PoC-D（DD-006・データ表現・簡易数式・§18.4）

> 出典 `doc/DD/DD-006/measurement-report.md`（以下 `mr`）＋生JSON `doc/DD/DD-006/measurements/`。Node 22（V8・`--expose-gc`）を主評価、採用候補はChrome 150実機確認（AC9）。

| # | 合格条件（§18.4・計画書 L1675-1679） | 実測値・結果 | 判定 | 証拠レベル | 出典 |
|---|---|---|---|---|---|
| D-1 | メモリと読書き性能を計測し、CellStore方式をADR化 | 4分布×4実装を実測。**chunked-rowslot が総合最良**（疎メモリ最小16.7MB・範囲走査3.6ms）。**全方式で§21目標300MB未満**（heap最大約160MB）。用途別選択表を ADR-011 拡充へ | 合格 | **A**（Node）＋**B/C**（Chrome AC9） | `mr` §AC1 L20-45／`cellstore-node-500k.json` |
| D-2 | 1セル変更の差分再計算が入力を阻害しない | 影響100式以下（通常入力）で **p95 1.09ms・worst 1.09ms**（合否基準 p95 16ms・worst 33ms を大きくクリア） | 合格（PASS） | **A** | `mr` §AC2 L48-62／`recalc-node-full.json` |
| D-3 | 行挿入後も固定ID参照が維持される | 実 `InsertRows`（先頭+1行）→A1表示はA2へ・**束縛セルの評価値は維持**（sheet-core実文書結合＋mock双方green） | 合格 | **A** | `mr` §AC3/4 L66-72／`integration-sheetcore.test.ts` |
| D-4 | 削除参照が`#REF!`になる | 実 `DeleteRows([r0])`→束縛参照が **`#REF!`**・displayRowOrderから消失 | 合格 | **A** | `mr` §AC3/4 L66-72 |
| D-5 | 100,000 Operationのreplay時間を測定しsnapshot閾値を決められる | 5点全実測: 1,000=0.1s／10,000=3.8s／50,000=163s／**100,000=847s（約14分）**。**replayはO(N²)超**（immutable clone＋文書肥大）＝**snapshot必須が実測確定**。暫定閾値「1,000〜5,000 Operation」を報告（確定はPhase 1） | 合格 | **A** | `mr` §AC5 L76-92／`replay-node-full.json` |

補足: AC6/AC8＝`eval`/`Function`不使用のインタプリタ・5関数・6エラー値・資源制限L1〜L6・深さ100,000でもスタック枯渇なし（44+13テストgreen・**A**）。AC9＝Chrome 150実機で chunked-rowslot 500,000セル完走（load 100ms・read 39ms・scan 2ms・approxStore 16.7MB＝Node一致・乖離なし）（**B/C**）。
⚠️ heap概算は `mr` §AC1「約160MB」・`ADR-011` L54「約138MB」で出典間に差（転記時点差の可能性）。いずれも§21目標300MB未満で判定への影響はないが、正準値は再計測で確定が安全。

---

## §2 DD-005 統合シナリオ10項目の成立状況

> **Phase 0 Go の必須条件**。統合E2Eは実WS＋2ブラウザーコンテキストだが IME は **synthetic composition**（Playwright/ChromiumはOSの実IMEを通せない）。DD自身が「synthetic は実IMEの代替でない」と繰り返し明記（`DD-005本文` L30・`integration-evidence.md` L6-9）。**実機(C)に到達した項目はゼロ**（実機ゲート=Phase 5 は実機テストなしでクローズ・`traces/` は `.gitkeep` のみ）。

| # | シナリオ | 成立 | 証拠レベル | 証跡・Phase 5残 |
|---|---|---|---|---|
| 1 | AがCanvas上セルで日本語IME変換を開始 | 自動分◯（synthetic） | **A**／実IME部分**E** | E2E `AC1/AC2`。残=実IME候補ウィンドウ・変換確定操作 |
| 2 | Bが同じセルを更新・確定 | ◯ | **A** | E2E `AC2`（実pointerdown＋実タイプ＋実Enter→ACK） |
| 3 | AのCanvasへリモート値と競合状態が反映 | ◯ | **A+B** | E2E `AC2`＋📸 `dd005-p3-alice-conflict.png`。残=実機視認 |
| 4 | Aの常駐textareaと未確定ドラフトは維持 | ◯ | **A+B** | E2E `AC2`（#8）＋Phase 3 headed。残=実IME未確定文字保持 |
| 5 | AがIME変換を確定してセルをCommit | 自動分◯（synthetic） | **A**／実発火順**E** | E2E `AC1/AC2`（#7順序）。残=確定Enter実発火順A/B未記録 |
| 6 | beforeRevision不一致として競合処理(reject) | ◯ | **A** | E2E `AC2`（server `stale-cell-revision`→reject） |
| 7 | Aの入力内容はConflict Queueに保持 | ◯ | **A** | E2E `AC2`（reject後 conflictCount+1） |
| 8 | 全クライアントとサーバーの文書状態が収束 | ◯ | **A** | E2E `AC1/AC2`（committedHash A==B・pending0） |
| 9 | スクロール中も常駐textareaが正しいセルへ追従 | 自動分◯（synthetic） | **A のみ（C未到達）** | E2E `AC3`（synthetic＋実DOMスクロール）📸 `…ac3-scroll-follow.png`。残=実IME変換中の実機追従 |
| 10 | Presenceの activeCell/selectionRanges/editingCell 表示 | ◯ | **A+B（C未到達）** | E2E `Presence`＋📸 `…presence.png`。selectionRangesは単一セル(start==end)のみassert。残=複数ユーザー実機目視・範囲選択 |

AC1〜4（受け入れ基準）: AC1同期＝**A+B**／AC2同一セル競合(Phase 0中核)＝**A+B**（実IMEはC未到達）／AC3 Canvas統合＝**A**／AC4構造変更＝**A**。E2E統合6件＋DD-002回帰11件＝**17 passed**。案A移設後もDD-003由来テスト全green（#7・**A**）。

---

## §3 ADR一覧の状態＋Phase 0 期限ADRの承認可否

> 現状態は計画書§4を正典として転記。整理欄（実証/未実証/制約/再検討/憲章整合）は Phase 1 集約、状態案は Phase 2（ユーザー判定ゲート）で確定。

### ADR-005: サーバー主導型の全順序Operationログ

- 現状態: **Proposed** ／ 決定期限: Phase 0終了時 ／ ドラフト: `doc/adr/0005-server-ordered-operation-log.md`

| 整理欄 | 内容 |
|---|---|
| 実証された前提 | 163テストgreen。3〜10体×10,000件＋フォールト注入で全hash==サーバーhash==ログreplay hash・構造deep-equal・二重適用0・stale reject→Conflict Queue保持・snapshot復元hash一致（`ADR-005` L28-42） |
| 未実証の前提 | 単一サーバーのスループット/レイテンシ上限（in-process/localhostのみ観測・実運用負荷未実証）・長時間オフライン・実RTT下の伝播レイテンシ（`ADR-005` L45／§4 SLO参照） |
| 既知の制約 | 全順序単一サーバーがスループット/レイテンシの中心（シャーディング未検証）・オフライン耐性は上限付き（§8.5）・ログ無限成長（in-memory前提・resyncRequired本実装が必要）（`ADR-005` L14, L45-47） |
| 再検討条件 | スループット/レイテンシがボトルネック化／長時間オフラインが主要UC化／ログ肥大が運用制約化（`ADR-005` L43-47） |
| 製品憲章との整合 | サーバー主導型はコアのゼロ依存・アダプター境界方針と整合（憲章§10/ADR-022）。水平スケールはPhase 2以降 |
| 状態案（Accepted / Proposed継続 / 条件付きAccepted） | （ユーザー判定ゲート Phase 2で記入） |

### ADR-008: 楽観適用＋rollback/replay

- 現状態: **Proposed** ／ 決定期限: Phase 0終了時 ／ ドラフト: `doc/adr/0008-optimistic-apply-rollback-replay.md`

| 整理欄 | 内容 |
|---|---|
| 実証された前提 | 最大pending深度4〜8（有界・O(pending)）・恒常遅延の兆候なし（ops/sec維持）・競合時の入力保全（消失0・reject経路＋echo先着再検証経路）・D22 committed権威で収束担保・D26 tail欠落は周期catch-upで回復（`ADR-008` L28-36） |
| 未実証の前提 | **No-Go条件「rollback/replayが入力遅延を恒常的に発生させる」の実証は間接的**＝in-process/localhost・注入クロックでpending深度/ops/secを観察したのみで、**実RTT下・実IME入力下の体感遅延は直接未測定**。D27（submitOperation欠落起点のclientSequence完全再整列）は**未実装**（`ADR-008` L37） |
| 既知の制約 | pending逆操作・再検証の複雑さ／O(pending)で大規模pending時にUI遅延の可能性／InverseSeedのbefore-revision欠如（厳密Undo/監査再現を破る）／D27 seq再整列が実WSで問題化し得る（`ADR-008` L14, L39-43） |
| 再検討条件 | 長時間オフライン・大量未確定でUI遅延／厳密Undo要件／切断跨ぎのseq gap顕在化→決定論的再整列の本実装（`ADR-008` L41-43） |
| 製品憲章との整合 | 「入力を黙って上書きしない」（計画書L32・憲章）と整合。実RTT UX計測はPhase 1/2 |
| 状態案 | （ユーザー判定ゲート Phase 2で記入） |

### ADR-011: 行スロット＋チャンク化セルストア

- 現状態: **Draft** ／ 決定期限: Phase 0終了時 ／ ドラフト: `doc/adr/0011-row-slot-chunked-cell-store.md`

| 整理欄 | 内容 |
|---|---|
| 実証された前提 | DD-006で4分布×4実装を実測。chunked-rowslot総合最良（疎16.7MB・範囲走査3.6ms）・chunked-column密最小（12.5MB）・全方式300MB未満。Chrome 150実機で500k完走・Node乖離なし（`ADR-011` L46-54／`mr` §AC1・AC9） |
| 未実証の前提 | 2,000,000ストレッチ未実施（参考・合否対象外）・精密ブラウザヒープ未取得（`performance.memory` がChrome 150で封鎖）・密比率が高い実データでの再評価（`mr` L164, L118） |
| 既知の制約 | 本PoCストアは**index キー**（RowIdキーでない）＝行挿入/削除でセルがRowId追従しない。columnarは数値列Float64前提（`ADR-011` L43／`mr` L163） |
| 再検討条件 | 密ブロックが優位／splice高頻度で問題化／indexキー起因の挿入削除ずれが共同編集と衝突（`ADR-011` L67-73） |
| 製品憲章との整合 | 用途別選択（単一勝者を強制しない）・ゼロ依存。Phase 1で**index→RowIdキー移行が必須**（DD-004簡略化解消・共同編集InsertRows/DeleteRows整合） |
| 状態案 | （ユーザー判定ゲート Phase 2で記入。DD-006で決定案確定＝Accepted化の材料は揃う。ただし「RowIdキー移行」がPhase 1条件） |

### ADR-022: コアはゼロランタイム依存を原則とする

- 現状態: **Draft**（DD-006/PoC-Dで起票・実在） ／ 決定期限: Phase 0終了時 ／ ドラフト: `doc/adr/0022-zero-runtime-dependency-core.md`

| 整理欄 | 内容 |
|---|---|
| 実証された前提 | sheet-types/sheet-core（既存ゼロ依存）・`sheet-collaboration`（DD-005）・`sheet-formula`（DD-006）とも `dependencies:{}`＋`typecheck:core` env-freeゲートで機械実証。環境固有の関心事は注入抽象（CellReader/AxisView/ClientTransport/Clock/IdGenerator）（`ADR-022` L27-32） |
| 未実証の前提 | cross-platform hash一致の自作実装（FNV-1a/UTF-8）の限界・コア全パッケージ横断のゼロ依存維持の恒久CI運用 |
| 既知の制約 | replay O(N²)はimmutable自作契約由来（外部依存回避のトレードオフ・R-17）。計測ツール `apps/pocd-bench` はNode API使用だが製品パッケージ対象外（`ADR-022` L32） |
| 再検討条件 | 自作範囲が過大化しコスト超過（R-17）／自作hashの限界／回避できない環境差はAdapter層へ隔離（`ADR-022` L34-38） |
| 製品憲章との整合 | 憲章§9.1/§10.3/§21（再利用性・公開範囲・依存脆弱性検査）と強く整合 |
| 状態案 | （Phase 2で記入。ドラフト実在・2パッケージで実証済み＝Accepted化の材料は揃う） |

---

## §4 性能SLO（§21 全14指標）×実測値

> 未計測は「Phase 1以降で計測」と明記（Observation・§7）。n/a（該当なし）と E（未実施）を区別。

| 指標 | 暫定SLO | 実測値 | 達成 | 証拠レベル | 出典 |
|---|---|---|---|---|---|
| アドレス可能行数 | 50,000行以上 | 50,000行 | ○ | B+C | DD-004 `report` §2 |
| アドレス可能列数 | 200列以上 | 200列 | ○ | B+C | DD-004 `report` §2 |
| 非空セル | 500,000基準、2,000,000ストレッチ | 500,000達成（2,000,000は未実施） | ○（基準）／ストレッチE | A/B | DD-004 `report` §2／DD-006 `mr` |
| 可視セル描画 | 2,500セル程度を1フレーム8〜12ms目標 | 停止中再描画 0.33ms | ○ | B+C | DD-004 `report` L24 |
| スクロール | 95%フレーム33ms未満、通常60fps志向 | p95 16.8ms（over33 1.1%） | ○ | B+C | DD-004 `report` L23 |
| 選択反応 | pointer／keyから50ms未満 | pointer→選択枠 worst 16.9ms（**key起点の遅延は未計測**） | pointer○／key未計測 | pointer**B+C**／key**E** | DD-004 `report` L25 |
| IME draft表示 | input eventから次フレーム以内 | synthetic層でのみ確認・**実IME実機は未計測** | 未確定 | 合成A／実機**E** | DD-002／DD-005（実機未実施） |
| 10,000セル貼り付け | ローカル適用250〜500ms以内を目標 | Phase 3で計測予定・**未実施**（§21 L1925に有効SLOとして存在・Phase 0では未計測） | 未実施（E） | E | 計画書§21 L1925／§19 Phase 3 |
| Operation伝播 | 同一リージョンp95 150〜250ms以内 | in-process収束は実証も**実RTT伝播レイテンシは未計測** | 未確定 | 収束A／実RTT**E** | DD-003 `ADR-005` L45 |
| Presence伝播 | p95 250ms以内 | **Phase 1以降で計測**（実RTT未計測） | 未確定 | E | DD-003/005 |
| 再接続 | 1,000 Operation差分で2秒以内を目標 | replay 1,000点0.1秒（材料）／DD-005 join→収束897ms（非空100k・18.3MB replay・snapshotなし） | 材料あり・**要snapshot設計** | A/B | DD-006 `mr` §AC5／DD-005 `initial-load-metrics.md` |
| 同時編集者 | 1文書20名 | DD-003は3〜10体で収束実証／DD-004 Presence overlay 20人は視覚証拠なし（unit）／**20名同時負荷は未計測** | 部分（3〜10体）／20名E | 3-10体A／20名**E** | DD-003／DD-004 §6 |
| メモリ | 基準データで300MB未満を目標 | DD-004 JSヒープ約29MB／DD-006 全方式300MB未満（Node heap最大約160MB・Chrome完走） | ○ | A/B（精密ブラウザヒープはE） | DD-004 `report` §2／DD-006 `mr` §AC1 |
| snapshot restore | 基準文書で5秒以内を目標 | DD-003 復元hash一致は実証（時間の直接計測なし）／replay O(N²)より**snapshot形式の正式設計が前提** | 復元動作○／時間未計測 | 動作A／時間**E** | DD-003 `restart-restore.test.ts`／DD-006 `mr` §AC5 |

---

## §5 既知の制約一覧（確認できたこと／確認していないことを分離）

| 出所 | 制約・簡略化 | 確認できた範囲 | 確認していない範囲 | Phase 1引き継ぎ |
|---|---|---|---|---|
| DD-002 | 実IME受入は口頭申告のみ・実機トレース未採取（`traces/phase6-acceptance/` 空） | 状態機械ロジック・順序A/B両対応のコード成立（synthetic A/B） | **実IMEでの先頭欠落0・確定Enter実発火順A/B・候補ウィンドウ挙動**（実機C/E） | 新 integration-editor アダプタ×実IMEの実機検証（順序A/B・先頭欠落） |
| DD-003 | client→server方向（submitOperation欠落）の完全なclientSequence再整列は未実装。収束試験はserver→client＋切断/再接続に限定（D27/D34 Critical・queueLen 95k〜155k指数増幅） | server→client欠落/重複/遅延・切断/再接続からの収束（A） | client→server欠落起点のseq再整列・全障害パターン・実RTT体感遅延 | Phase 1 共同編集DDで対応（ADR-008再検討条件）。統合PoC成功を「全障害対応済み」と表現しない |
| DD-003 | 認証・認可（§8.7）はスコープ外。Codex見送り2件（message-codec再帰入力検証・room.ts ID拘束） | 両端自製の信頼前提でPoC成立 | 本番アダプター化時の境界検証 | 本番化時に入力検証・認可を実装 |
| DD-004 | chunk-store は index キー（RowIdでない）＝行挿入/削除でセルがRowId追従しない | anchor補正はRowId基準で正しい・可視範囲クエリO(可視セル数) | セルデータのRowId追従 | RowIdキー CellStore（DD-006方式比較を受けて実装） |
| DD-004 | 10分連続フォアグラウンドsoak未実施・Presence20人同時可視の視覚証拠なし・セル結合/A11y未実装 | 約8.5分スパンでメモリ純減・Presenceはunit担保 | 厳密10分soak・20人同時可視・A11y | 厳密soak（任意・マージン大）・A11y・セル結合 |
| DD-005 | 同時実行の構造Op中、ローカル選択ハイライト/Enter移動先が state-machineの activeCell 非再ベースでずれる（Codex P1残） | Commit先・draft保持・RowId追従・presenceは正しい（中核AC不変） | ローカル選択/移動先の再ベース | state-machineへ activeCell再ベースAPI（Phase 1共同編集DD） |
| DD-005 | 初期snapshotは接続ごとに18.3MB全replay（snapshotベース初期化なし） | node実WS join→収束897ms・browser toFirstOperable 1.05〜1.56s | 大規模・多人数での初期ロード | snapshotベース初期化（ClientSession API追加） |
| DD-006 | 指数表記未対応（#ERROR!）・#NUM!未導入（非有限は暫定#VALUE!）・$絶対参照は構文保持のみ・2,000,000未実施・replay O(N²)（immutable由来）・精密ブラウザヒープ未取得 | 5関数・6エラー値・固定ID参照・500k実機完走 | #NUM!/比較/IF/日付/フィルrebind・2M密度・精密ブラウザヒープ | 数式拡張・snapshot正式形式・index→RowIdキー |

---

## §6 リスク表（R-01〜R-20）再評価

| ID | リスク | Phase 0での実証 | 低減/残存/新規 | 根拠 |
|---|---|---|---|---|
| R-01 | IMEイベント順がOS・ブラウザーで異なる | 状態機械は順序A/B両対応をコード化（synthetic）。**実機順序A/Bは未検証** | **残存** | DD-002 実機トレース未採取・DD-005 Phase 5未実施（§1 A-1/A-2・§5） |
| R-02 | Canvasとtextareaの座標ずれ | DD-004 ViewportTransform・DD-005 AC3追従（synthetic）で座標ずれなし | **低減**（実機実IME追従は残） | DD-005 §2 #9・AC3 |
| R-03 | データ密度でブラウザーメモリ超過 | Node全方式300MB未満・Chrome 150で500k完走・乖離なし | **低減** | DD-006 §AC1/AC9（精密ヒープはE） |
| R-04 | 未ACK rollback/replayが遅い | pending深度4〜8有界・恒常遅延兆候なし。replay O(N²)→**snapshot必須**（実RTT UXは未測定） | **低減**（snapshot設計がPhase 1条件） | DD-003 ADR-008／DD-006 §AC5 |
| R-05 | 同一セル競合で入力消失 | Conflict Queue保持で消失0（reject＋再検証経路）・DD-005 reject→Queue | **低減** | DD-003 C-4／DD-005 §2 #6-7 |
| R-06 | 行列操作と数式参照が壊れる | 固定ID参照維持・削除→#REF!（AC3/4）。ただしCellStore index→RowIdキー移行が前提 | **低減**（Phase 1移行条件） | DD-006 D-3/D-4／ADR-011 |
| R-07 | Undoが他ユーザー更新を壊す | Undo/RedoはPoC対象外（Phase 3範囲） | **残存（未検証）** | 計画書§19 Phase 3 |
| R-08 | 大量pasteがWS・DBを圧迫 | pasteはPoC対象外（Phase 3範囲） | **残存（未検証）** | 計画書§19 Phase 3 |
| R-09 | Presence更新が高頻度 | DD-003 Presence TTL・DD-005 overlay（presence-onlyで再描画修正） | **部分低減** | DD-003／DD-005 Codex P1 |
| R-10 | Operationログ肥大化 | replay O(N²)・100k=14分で**snapshot必須が実証**。ADR-005ログ無限成長懸念は残 | **残存（snapshot設計Phase 1）** | DD-006 §AC5／ADR-005 L47 |
| R-11 | サーバー障害で文書Room停止 | snapshot＋log復元でhash一致・revision継続（単一Room前提） | **低減**（単一Room範囲） | DD-003 C-5 |
| R-12 | 水平スケール時の二重sequencer | 単一サーバー全順序のみ実証・水平分割未検証 | **残存** | ADR-005 L45 |
| R-13 | Canvasアクセシビリティ不足 | A11yはPoC未実装 | **残存** | DD-004 §5 |
| R-14 | テスト組合せ爆発 | 各PoC seed決定論・回帰0で管理 | **部分低減** | 各DD 🔬機械検証 |
| R-15 | Excel同等期待が無制限に拡大 | 憲章・計画書で段階スコープ管理 | **管理下** | 計画書§19／憲章 |
| R-16 | 数式仕様の曖昧さ | function-spec.md単一正・5関数・6エラー値・ロケール不変 | **低減** | DD-006 §AC6 |
| R-17 | 外部依存回避により自作範囲が過大 | ゼロ依存実現（sheet-core/collaboration/formula）。replay O(N²)は自作immutable由来のコスト | **部分（トレードオフ顕在）** | ADR-022／DD-006 §AC5 |
| R-18 | 文字列・日付・数値のロケール差 | 数式はロケール不変を実証。日付はPhase 1（未実装） | **部分低減** | DD-006 §AC6 |
| R-19 | 互換性のないprotocol更新 | formulaEngineVersion等に言及・schema版管理はPhase 1 | **残存（Phase 1設計）** | DD-006 Phase 1引き継ぎ |
| R-20 | 操作ログに機密セル値が残る | 認証認可§8.7スコープ外（Codex見送り） | **残存** | DD-003 §5 |

---

## §7 §18.6 基準との対照＋3分類（Hard Gate / Conditional Gate / Observation）

> **ユーザー判定（2026-07-12・条件付きGo）を判定欄へ記録**。判定の理由・7項目の条件（CG-1〜CG-6）は **DD-007本体「決定事項」を正**とする。エージェントは材料集約と所見までで、Go/条件付きGo/No-Go の決定はユーザーが行った。

| 判定項目 | §18.6区分 | 対照結果（証拠に基づく所見） | 証拠レベル | 判定欄（ユーザー判定 2026-07-12） |
|---|---|---|---|---|
| IME合格条件を満たす（§18.1） | Hard Gate | 自動/synthetic層は成立（状態機械・E2E・順序A/B両対応のコード）だが、§18.1が要求する**各対象環境の実機受入は口頭申告のみ・実IMEトレース未採取**。ルールにより **D/E だけでHard Gateを合格にできない → 残存リスク／条件付きGo が妥当** | 合成**A/B**・実機**D/E** | **条件付きGo**（CG-1: Phase 1で実機IME検証＝順序A/B・先頭欠落0を解除条件） |
| Canvasが50,000行で実用速度（§18.2） | Hard Gate | 実機run `overall=pass`（p95 16.8ms・選択16.9ms・再描画0.33ms・anchor維持）。**厳密な10分連続フォアグラウンドsoakは未実施（E・マージン大）** | 傾向**B+C**／厳密soak**E** | **合格** |
| Operation収束性が確認できる（§18.3） | Hard Gate | 5条件すべて自動seed試験で成立（hash一致・二重適用0・catch-up・競合保持・復元）。**最も証拠が堅い**。境界=client→server再整列未実装（§5・R-04/R-10） | **A** | **合格**（境界=CG-5でPhase 1対応） |
| メモリ見積が実用範囲 | Hard Gate | Node全方式300MB未満・Chrome 150で500k完走・乖離なし（精密ブラウザヒープは`performance.memory`封鎖でE） | **A/B**（精密ヒープE） | **合格**（CG-6: 精密ヒープをPhase 1計測） |
| 主要未決定事項をADR化できる | Hard Gate | ADR-005/008/011/022 すべてドラフト実在・PoC結果を反映済み（005/008=Proposed・011/022=Draft）。Accepted化の状態確定はPhase 2判定 | **A** | **合格**（Accepted化は前提条件で確定） |
| No-Go: 実IMEの先頭文字欠落を安定回避できない | Hard Gate（該当ならNo-Go） | synthetic状態機械では回避を実証（A）だが、**実IMEでの50回連続入力の先頭欠落0は未実測（E）**＝No-Go該当とも非該当とも実機では未確定 | 合成**A**・実機**E** | **非該当（未確定）**（CG-1で実機確認） |
| No-Go: rollback/replayが入力遅延を恒常的に発生させる | Hard Gate（該当ならNo-Go） | 代理観察（in-process/localhost・注入クロック）では**恒常遅延の兆候なし**＝pending深度4〜8有界・ops/sec維持（A）。ただし**実RTT・実IME下の入力遅延は直接未測定（E）**。No-Go該当性はユーザー判定前は未確定。replay O(N²)はsnapshotで対処（Phase 1） | 代理**A**／直接**E** | **非該当**（実RTT計測はPhase 1・CG-3） |
| No-Go: 想定データ量でブラウザーメモリ上限を超える | Hard Gate（該当ならNo-Go） | Node全方式<300MB（A）。Chrome 150で500k完走・approxStore一致で**上限超過の兆候なし**（行動的証拠 B/C）。ただし採用候補の**精密ブラウザーヒープは `performance.memory` 封鎖で未取得（E）**。No-Go該当性はユーザー判定前は未確定 | Node**A**／完走**B/C**／直接ヒープ**E** | **非該当**（精密ヒープはCG-6） |
| 条件付きGo: 主要ブラウザーのうち1つに限定すれば成立 | Conditional Gate | 対象=Windows Chrome/Edge。macOS・Firefoxは全PoC対象外。実機確認はChrome中心 | **B/C**（Chrome）・他E | **採用: Windows Chrome/Edge を Tier 1 に限定（CG-4）** |
| 条件付きGo: 性能目標をデータ密度または列数の制約で達成可能 | Conditional Gate | 500,000非空・50,000行×200列で成立。2,000,000ストレッチ・高密度実データは未検証 | **A/B**（基準）・ストレッチE | **500k基準で成立を前提に採用**（2M/高密度はPhase 1で再確認） |
| 性能SLO 14指標のうち Phase 0 未計測（§4） | Observation | IME draft実機・貼付・Operation伝播実RTT・Presence伝播・snapshot restore時間・20名同時＝Phase 1計測 | **E**（該当指標） | **Observation（Phase 1で計測）** |

> **条件付きGo の記録（該当時）**: DD-007本体の決定事項へ **7項目形式**（①条件 ②対象範囲 ③解除条件 ④期限 ⑤確認方法 ⑥未解除時の扱い ⑦ブロックするPhase 1 DD）で記録する。

---

## §8 No-Go時の再設計整理欄（No-Goの場合のみ使用）

> Go／条件付きGo の場合は本節は空のままとする。

| 該当No-Go条件 | 影響ADR | 再PoC候補 |
|---|---|---|
| （No-Goの場合のみ Phase 2で記入） | （同左） | （同左） |

---

## 記入ルール（Phase 1/2 で本ファイルを埋めるときの必須事項）

1. すべての値に出典必須（DD番号・レポート・証跡リンク）。
2. 出典のない値は載せない。
3. 未計測は「Phase 1以降で計測」と明記（空欄を「達成」と読み替えない）。
4. n/a と 未実施（E）を区別。
5. 証拠レベル（A〜E）を各根拠に付す。**Hard Gate を D／E だけで合格にしない**。
6. **判定はユーザーが行う**。§7判定欄・DD本体決定事項はユーザー判定ゲート（Phase 2）で埋める。
