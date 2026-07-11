# DD-006: PoC-Dデータ表現・簡易数式

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-12 | 2026-07-12 | 検討中 | 要確認1〜5回答済み・外部レビュー6指摘反映。着手条件: DD-005（統合PoC）完了後 |

> アプローチ: 標準（計測中心のPoC）＋TDD（parser・固定IDバインド・依存グラフ・CellStore候補のDOM非依存純ロジック）

## 目的

「想定データ量（500,000非空セル）と簡易数式（parser＋固定ID参照＋依存グラフ）が実用性能で成立するか」を検証するPoC-D（計画書 §18.4）を実装し、メモリ・読書き・再計算・replayの実測で合格判定する。成果でADR-011（CellStore方式）を拡充し、ADR-022（コアのゼロランタイム依存）ドラフトを起こす。Phase 0 No-Go条件「想定データ量でブラウザーメモリ上限を超える」（§18.6）とリスクR-03の最終判断材料を作る。

## 背景・課題

- 正典は計画書 `doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md` の **§18.4（実装範囲・合格条件）**。設計は §6（データモデル）・§14（数式エンジン）・§16.3（snapshot閾値）、目標値は §21。`doc/plan/phase0-dd-roadmap.md` の DD-006（DD-005の後・DD-007最終判定の前提）。
- CellStoreは §6.4 で「Phase 0で疎/密×Map方式・チャンク方式・配列方式を比較する」と定めており、DD-004 が起こした `doc/adr/0011-row-slot-chunked-cell-store.md`（Draft）は本DDの比較結果で拡充する前提。DD-004 のchunk-storeは**indexキーの簡略版**（ADR-011「既知の簡略化」）で、行挿入時のRowId追従・数式の固定ID参照とは未接続。
- 数式は §14 の方針（自前parser・AST・解析時に固定RowId/ColumnIdへバインド・クライアントサーバー同一パッケージ・任意コード実行禁止）が机上のみで、性能（10,000 formula cellsの差分再計算）と参照維持（行挿入・削除）の実証がない。
- snapshot生成閾値（§16.3 暫定1,000〜5,000 Operation）はreplay実測がないと確定できない（DD-003はOperation収束のみ検証・replay時間は未計測）。

## 検討内容

- **独立領域で実装**（ロードマップ着手条件）: playground（`apps/playground`＝DD-002/004/005の受入環境）・IME・Canvas・collaboration-server に一切触れない。実装先は新規ワークスペース3つ:
  - `packages/sheet-formula`（新規・計画書 §5.1準拠の製品パッケージ候補）: tokenizer／parser（§14.2文法）／canonical AST／A1↔固定ID双方向バインド（§14.3 BoundCellReference）／依存グラフ＋差分再計算＋cycle検出（§14.4）／評価器／エラー値。**ランタイム依存ゼロ**（ADR-022素材）。依存は `sheet-types` のみとし、セル値アクセスは `CellReader` インターフェイスで抽象化（`sheet-core` 文書モデルとの正式結合はPhase 1）。
  - `apps/pocd-bench`（新規・PoC専用のNode計測CLI。製品昇格しない）: CellStore候補4実装＋決定論データ生成＋ベンチ＋replay計測＋sheet-core結合試験＋結果JSON/Markdown出力。`sheet-core` は**読み取り＋`apply`利用のみ**（既存packagesを変更しない）。
  - `apps/pocd-browser-bench`（新規・採用候補CellStoreの最小ブラウザ確認ページ。製品昇格しない）: playground非依存の最小静的ページ（devサーバーはルート既存のViteを利用・新規依存なし）。採用候補方式の500kセルロード・代表操作・メモリをChrome/Edgeで実測する〔要確認3の回答による追加〕。
- **CellStore比較の候補は4実装・3カテゴリ**（§6.4・ADR-011の選択肢に対応。レポートは3カテゴリで総括する）: ①**Map型**=単一Map（DD-002方式・基準線）／②**チャンク型2実装**=§6.4推奨の列ごとチャンクMap＋DD-004行スロット版の移植／③**列指向配列型**=密データ向けTypedArray＋文字列列は通常配列。疎（50,000行×200列・非空500,000）と密（連続矩形ブロック500,000）の両条件で、一括ロード・ランダム読書き・可視範囲走査・メモリを計測。2,000,000非空のストレッチ計測（§21）は参考値として取得（合否対象外）。
- **計測はNode 22（V8）を主評価とする**〔要確認3回答済み〕: 方式間の**相対比較**が目的でChrome/NodeはV8共通のため。メモリは `process.memoryUsage()`＋`v8.getHeapStatistics()`＋方式別概算フック。ただし製品の実行場所はブラウザーであり、§18.6のNo-Go条件「想定データ量でブラウザーメモリ上限を超える」はNodeだけでは確定できないため、**採用候補（決定案の方式）はChromeまたはEdgeで最小ブラウザ確認**（`apps/pocd-browser-bench`）を行い、メモリ・代表操作時間がNode実測から極端に乖離しないことを確認する。
- **数式の実装範囲は§14.7確定候補の5関数まで**〔要確認2回答済み〕: 四則演算（単項±・べき乗含む§14.2）・括弧・数値/文字列リテラル・セル参照・範囲参照・`SUM`/`AVERAGE`/`MIN`/`MAX`/`COUNT`。比較演算子・`IF`・日付関数はスコープ外（§14.2・§14.8）。`$`絶対参照は**構文解釈のみ**受け付けAST属性に保持（rebind適用はフィル機能とともにPhase 1）。
- **parserの資源制限を明示上限として実装**（数式は外部入力。計画書§20系「evalしない・サーバーは数式数を検証」と同じ入力検証の系譜）: 最大数式文字数／最大ASTノード数／最大括弧ネスト深さ／最大関数引数数／1範囲の最大参照セル数／evaluateの処理量上限（同期評価器のためタイムアウトではなく処理量カウンタで代替）。超過時は対応エラー値で安全に停止し、深いネスト・巨大範囲でスタック枯渇・フリーズしないことを検証対象とする（AC8）。上限の具体値は Phase 0 テスト設計時に `DD-006/function-spec.md` へ定義する。
- **依存表現の比較**（§14.4）: 1) 全展開 2) 列別interval index を実装して10,000 formula cells＋大range（`SUM(A1:A10000)`級）で比較。hybridは両者の実測差が示す場合のみ。
- **エラー値は独自仕様の最小セット**〔要確認5回答済み〕: `#REF!`（参照先削除）・`#CYCLE!`（循環）・`#DIV/0!`・`#VALUE!`（型不一致）・`#NAME?`（未知関数）・`#ERROR!`（構文・資源制限超過）の6種を採用。エラーは値として伝播。
- **固定ID参照はsheet-core実文書との結合試験で裏取りする**: モック `AxisView` のユニットテスト（AC3/4）に加え、`apps/pocd-bench` 側で「sheet-coreで文書作成→数式をRowId/ColumnIdへbind→sheet-coreの`InsertRows`適用→A1表示は変化・固定ID評価値は維持／`DeleteRows`適用→`#REF!`」の結合試験を1本実施する。製品パッケージ間の依存は増やさない（結合はPoCアプリ内のみ）。sheet-coreがAxis情報（RowId⇄表示index）を外部公開していない場合は読み取り専用の薄いアダプタで対応。
- **replay計測**: シード付きPRNGで決定論の100,000 Operation列（SetCells/InsertRows/DeleteRows混在・DD-003のfuzzerパターン踏襲）を生成し、`sheet-core` の `apply` でreplay時間を計測。1,000/5,000/10,000/50,000/100,000点の所要時間から snapshot閾値（§16.3）と再接続目標（§21: 1,000 Operation差分2秒以内）の判断材料を作る。数式込みreplay（formula付きSetCells→再計算）も参考計測。あわせてsnapshot閾値判断の精度向上のため、replay後文書の**素朴なJSON化のserialize/parse時間・JSONサイズ・復元後メモリ**を参考計測する（正式なsnapshot形式は未設計のため合否対象外・桁感の把握が目的。圧縮は任意）。
- **スコープ外**: Worker分離（§14.5・main thread計測で閾値素材のみ）／サーバー側re-parse・validate（§14.6・Phase 1）／`IF`以降の関数・比較演算／フィル・コピーのrebind適用／CellStoreのsheet-core本組込（Phase 1）／UI・描画統合（DD-005/Phase 1）／スタイルテーブル（§6.6）。
- **新規npm依存ゼロ**を厳守（dev依存もルート既存のvitest/tsc/eslintのみ）。ワークスペース追加で `package-lock.json` は更新される（並行DDなしのタイミングで実施）。

### 要確認（2026-07-12 ユーザー回答済み）

1. **AC2「入力を阻害しない」の定量基準** → **回答: 影響式数別に分割して確定**。合否は「**影響100式以下（通常入力シナリオ）で p95 16ms未満・worst 33ms未満**」。影響1,000式（中規模ファンアウト）／全10,000式（最悪ケース）／10,000行範囲SUM（range index性能）／10,000式チェーン（依存順と深さ）は計測レポート項目として実測し、**Worker分離（§14.5）の条件判断素材**とする（合否対象外）。
2. **関数の実装範囲** → **回答: 5関数（SUM/AVERAGE/MIN/MAX/COUNT）まで実装**。
3. **計測環境** → **回答: Node 22を方式選定の主評価として承認。ただし採用候補はChromeまたはEdgeで最小ブラウザ確認**を行い、メモリ・再計算時間が極端に乖離しないことを確認する（`apps/pocd-browser-bench`＝playground非変更の独立ページ。§18.6 No-Go条件「ブラウザーメモリ上限超過」の直接確認のため）。
4. **ADR-011のAccepted化タイミング** → **回答: 承認**（本DDは決定案記載まで・Accepted化はDD-007で）。
5. **エラー値の初期セット** → **回答: 6種（`#REF!` `#CYCLE!` `#DIV/0!` `#VALUE!` `#NAME?` `#ERROR!`）を承認**。

## 決定事項

- 要確認1〜5は2026-07-12のユーザー回答で確定（上記）。同日、外部レビュー（ChatGPT・手動運用）の指摘6点を反映: ①CellStore候補を「4実装・3カテゴリ」へ表記統一 ②Node主評価＋採用候補のブラウザ最小確認 ③再計算SLOを影響式数別に分割 ④sheet-core実文書との結合試験を追加 ⑤parser資源制限を受け入れ基準へ昇格（AC8） ⑥snapshot判断向けの素朴JSON化参考計測を追加。
- 実装先は `packages/sheet-formula`（製品候補・ランタイム依存ゼロ・sheet-typesのみ依存）＋ `apps/pocd-bench`（PoC専用計測CLI）＋ `apps/pocd-browser-bench`（採用候補の最小ブラウザ確認ページ）。既存の `apps/playground`・`packages/sheet-core`・`packages/sheet-server-core`・`apps/collaboration-server` は無変更。
- ASTのセル参照は解析時に `BoundCellReference`（sheetId＋RowId/ColumnId＋relative/absolute属性）へバインドし、行列挿入・移動後も同一論理セルを指す（§14.3・ADR-013素材）。参照先削除で `#REF!`。
- cycle検出はDFS coloring（Tarjanは実測で必要になった場合）。差分再計算はdirty集合からのtopological order（§14.4）。
- 成果物（ロードマップ「DD化の原則」3）: 計測レポート `DD-006/measurement-report.md`（方式比較・再計算・replay・合否・既知の制約・Phase 1引き継ぎ）、ADR-011拡充（疎/密比較結果と決定案）、ADR-022ドラフト `doc/adr/0022-zero-runtime-dependency-core.md`（`doc/DOC-MAP.md` 更新含む）。

## 受け入れ基準

計画書 §18.4 合格条件を流用（#1〜5）。計測条件: 参照端末=本機（DD-004と同じWin11・機種情報をレポートに記録）・Node 22主評価＋採用候補のブラウザ最小確認（要確認3回答）・非空500,000セル・10,000 formula cells。

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | 疎/密×4実装（Map型／チャンク型2実装／列指向配列型の3カテゴリ）でCellStoreベンチ実行 → 生成・読書き・範囲走査時間とメモリの実測表が出力され、カテゴリ別の優劣と決定案をADR-011へ記載できる | Phase 1 ベンチJSON＋report §1／ADR-011拡充（Phase 5） |
| 2 | 10,000 formula cells文書で1セル変更（**影響100式以下=通常入力シナリオ**） → 依存再計算完了がp95 16ms未満・worst 33ms未満〔要確認1回答〕。影響1,000式／全10,000式／10,000行範囲SUM／10,000式チェーンの実測値がレポートに記録され、Worker分離閾値の素材になる（この4系は合否対象外） | Phase 3 計測（シナリオ別の決定論変更列×N回・p95/worst をJSON出力） |
| 3 | 参照される行の手前に行挿入 → 数式のA1表示は移動後の位置を示し、評価値が変わらない（固定ID参照維持） | Phase 3 ユニットテスト（モックAxisView）＋sheet-core実文書の結合試験（InsertRows適用） |
| 4 | 参照先の行を削除 → 該当式の評価値が `#REF!` になり、他の式は正常のまま | Phase 3 ユニットテスト＋sheet-core実文書の結合試験（DeleteRows適用） |
| 5 | 100,000 Operationをreplay → 1,000/5,000/10,000/50,000/100,000点の所要時間が計測され、snapshot閾値（§16.3）の推奨値を報告できる（素朴JSON化のserialize/parse時間・サイズ・復元後メモリの参考計測を含む） | Phase 4 replay計測JSON＋report §3 |
| 6 | `=1+2*3`・`=(A1+B2)^2`・`=SUM(A1:B10)`・単項マイナス・文字列を入力 → §14.2文法どおり評価。不正式・未知関数・循環・0除算は対応エラー値〔要確認5回答〕。evalや動的コード実行を使わない | Phase 2/3 ユニットテスト＋lint（`no-eval`相当） |
| 7 | 計測レポート・ADR-011拡充・ADR-022ドラフト・Phase 1引き継ぎ事項が文書化される | Phase 5 成果物タスク＋`bash scripts/doc-check.sh` エラー0 |
| 8 | 資源制限境界の入力（最大式長超過・深い括弧ネスト・巨大ASTノード数・過多引数・巨大範囲参照・処理量上限超過）をparse/evaluate → 明示上限で安全に対応エラー値を返し、スタック枯渇・フリーズ・暴走しない | Phase 2/3 ユニットテスト（境界値・超過値。上限値は `DD-006/function-spec.md` に定義） |
| 9 | 採用候補方式を `apps/pocd-browser-bench` でChromeまたはEdge実測 → 500,000セルのロード・代表操作・メモリがNode実測から極端に乖離しない（乖離した場合は原因分析と方式選定への影響をレポートへ記載） | Phase 5 ブラウザ実測＋report §4 |

## タスク一覧

### Phase 0: 事前精査
- [ ] 📋 **各Phaseのタスク精査・詳細化**（受け入れ基準1〜9と各Phase検証タスクの対応・ファイルパス明記・変更内容の具体性を確認）
- [ ] 🧪 **テスト設計（Red）**: 文法境界（演算子優先順位・単項連鎖・空白/文字列/エラー伝播・範囲境界）・資源制限境界（式長・ASTノード数・ネスト深さ・引数数・範囲セル数・処理量の各上限値と超過時挙動＝AC8。上限値は `DD-006/function-spec.md` に定義）・バインド境界（挿入/削除/移動・絶対相対）・依存グラフ（diamond依存・range重なり・cycle）・CellStore境界（チャンク境界・空行・密疎切替）のシナリオを `DD-006/scenarios.md` に自然言語で作成（合意済みスコープ内は自動継続ルールで進行）
- [ ] 📐 **実装前詳細化トリガー判定**（新規パッケージ＋性能特性が核心のため全Phase「要」想定。判定結果 `Phase N → 要/不要` を本文へ明記）
- [ ] 🧑‍⚖️ **Codexレビュー要否判定**（起票時暫定: **必須・effort high**〔TDD対象＋parser=入力検証＋新規パッケージ外部I/F〕。実行はPhase 5で全差分1回=DD-004と同運用）
- [ ] 😈 **Devil's Advocate調査**（特に「Node計測がブラウザ実態と乖離する」「ベンチのデータ分布が実業務と乖離し方式選定を歪める」「CellReader抽象がPhase 1のsheet-core結合で漏れる」リスク）

### Phase 1: CellStore方式比較（疎/密×4実装・3カテゴリ）
- [ ] 📐 **実装前詳細化**（候補ストアの共通インターフェイス・ベンチ項目・データ分布を本文/添付へ）
- [ ] `apps/pocd-bench/src/stores/{map-store,chunked-column-store,chunked-rowslot-store,columnar-store}.ts`（新規）: 共通 `CellStoreCandidate` インターフェイスで4実装（①Map型＝単一Map／②チャンク型2実装＝§6.4列チャンクMap・DD-004行スロット移植／③列指向配列型）＋ユニットテスト（等価性: 同一操作列で4実装の読出結果一致）
- [ ] `apps/pocd-bench/src/data-gen.ts`（新規）: シード付きPRNGで疎（50,000×200・非空500,000）・密（連続ブロック500,000）・ストレッチ（2,000,000）を決定論生成＋ユニットテスト（件数・再現性）
- [ ] `apps/pocd-bench/src/bench-cellstore.ts`＋CLIエントリ（新規）: 一括ロード・ランダム読書き（10万回）・範囲走査・メモリ実測→JSON/Markdown出力
- [ ] 🔬 **機械検証**: `npm run test`/`typecheck`/`lint` green（既存workspace回帰0）＋ベンチCLI実行でJSON出力
- [ ] 😈 **DA批判レビュー**（GC影響の排除・ウォームアップ・計測順序の偏り）

### Phase 2: formula parser・固定IDバインド（TDD）
- [ ] **Red→Green**: `packages/sheet-formula/src/{tokenizer,parser,bind}.test.ts` へ scenarios.md をコード化→実装で green 化
- [ ] `packages/sheet-formula/src/{tokenizer,parser,ast}.ts`（新規）: §14.2文法（比較演算は文法上予約のみ・拒否）・canonical AST・エラー値型（6種・要確認5回答）
- [ ] `packages/sheet-formula/src/limits.ts`（新規）: parser資源制限（最大式長・最大ASTノード数・最大括弧ネスト深さ・最大関数引数数）の実装＋境界/超過ユニットテスト（AC8。上限値は function-spec.md の定義に従う）
- [ ] `packages/sheet-formula/src/bind.ts`（新規）: A1↔`BoundCellReference` 双方向変換（`$`属性保持）・範囲参照・`AxisView` インターフェイス（RowId/ColumnId⇄表示index）
- [ ] 🔬 **機械検証**: `test`/`typecheck`/`lint` green。パッケージのランタイム依存ゼロ（package.json `dependencies` なし・DOM lib なしで型検査）を確認
- [ ] 😈 **DA批判レビュー**（全角/空白トークン・巨大数値・深いネストのスタック）

### Phase 3: 依存グラフ・差分再計算・評価器（TDD＋計測）
- [ ] **Red→Green**: `packages/sheet-formula/src/{dep-graph,evaluator}.test.ts`（cycle・diamond・range重なり・#REF!伝播・行挿入/削除の参照維持=AC3/4）
- [ ] `packages/sheet-formula/src/dep-graph.ts`（新規）: 全展開＋列別interval indexの2実装（§14.4）・dirty集合→topological再計算・DFS coloring cycle検出
- [ ] `packages/sheet-formula/src/evaluator.ts`（新規）: `CellReader` 抽象上で5関数（SUM/AVERAGE/MIN/MAX/COUNT・要確認2回答）・空白/文字列/エラー伝播規則・評価時資源制限（1範囲の最大参照セル数・処理量上限カウンタ＝AC8）を実装（関数ごとの仕様・上限値を `DD-006/function-spec.md` に明文化）
- [ ] `apps/pocd-bench/src/integration-sheetcore.test.ts`（新規）: sheet-core結合試験（AC3/4の実文書版）— sheet-coreで文書作成→数式をRowId/ColumnIdへbind→`InsertRows`適用→A1表示変化・固定ID評価値維持を確認／`DeleteRows`適用→`#REF!` を確認（sheet-coreは読み取り＋apply利用のみ。Axis情報が外部公開されていない場合は読み取り専用アダプタ）
- [ ] `apps/pocd-bench/src/bench-recalc.ts`（新規）: 影響式数別シナリオ（**影響100式以下=合否対象**／影響1,000式／全10,000式／10,000行範囲SUM／10,000式チェーン=レポート項目・Worker分離閾値素材）で1セル変更×N回→シナリオ別p95/worst JSON出力（AC2）＋依存表現2方式の構築/更新時間比較
- [ ] 🔬 **機械検証**: `test`/`typecheck`/`lint` green＋bench-recalc実行でAC2判定値出力
- [ ] 😈 **DA批判レビュー**（再計算順の非決定性・interval indexの境界off-by-one・エラー伝播の抜け）

### Phase 4: Operation replay計測
- [ ] `apps/pocd-bench/src/op-gen.ts`（新規）: シード付きPRNGで100,000 Operation列（SetCells/InsertRows/DeleteRows混在比率は決定論・DD-003 fuzzer踏襲）＋ユニットテスト（再現性）
- [ ] `apps/pocd-bench/src/bench-replay.ts`（新規）: `@nanairo-sheet/sheet-core` の `apply` で1,000〜100,000点の所要時間・最終document hash・メモリを計測（AC5）。formula付きSetCells→一括再計算の参考計測を含む
- [ ] 同 bench-replay に**snapshot参考計測**を追加: 各計測点のreplay後文書を素朴にJSON化し、serialize/parse時間・JSONサイズ・復元後メモリを記録（合否対象外・snapshot閾値判断の桁感素材。圧縮時間は任意）
- [ ] 🔬 **機械検証**: `test`/`typecheck`/`lint` green＋bench-replay実行でJSON出力（hash一致=DD-003結果と整合）
- [ ] 😈 **DA批判レビュー**（Operation分布の偏りでreplayが軽く出る・InsertRows多発時のAxis再構築コスト）

### Phase 5: ブラウザ最小確認・計測レポート・ADR-011拡充・ADR-022ドラフト・引き継ぎ・Codexレビュー
- [ ] `apps/pocd-browser-bench`（新規・最小静的ページ）: 採用候補（決定案）方式の500,000セルロード・代表操作（ランダム読書き・範囲走査）・メモリをChromeまたはEdgeで実測し、Node実測との乖離を確認（AC9。playground非依存・devサーバーはルート既存Vite・新規npm依存なし）
- [ ] 計測実施→ `doc/DD/DD-006/measurement-report.md`（新規・添付）: AC1〜5・8〜9の実測値・合否・機種情報（ブラウザ版数含む）・既知の制約・Phase 1へ引き継ぐ設計注意事項（CellStoreのsheet-core組込方針・RowIdキー化・Worker分離閾値〔影響式数別実測から〕・サーバーre-parse）
- [ ] `doc/adr/0011-row-slot-chunked-cell-store.md`（拡充）: 疎/密比較の実測を「結果」へ追記し決定案を記載（Accepted化は要確認4の回答に従う）
- [ ] `doc/adr/0022-zero-runtime-dependency-core.md`（新規・ドラフト）: sheet-formula/sheet-core依存ゼロ実績を根拠に背景・選択肢・決定案・再検討条件。`doc/DOC-MAP.md` へADR行を追加
- [ ] 🔬 **機械検証**: `test`/`typecheck`/`lint`/`build` green・`bash scripts/doc-check.sh` エラー0
- [ ] 😈 **DA批判レビュー**（計測値の再現性・合否がJSON/レポートから追えるか・ADR決定案が計測に裏付くか）
- [ ] Codexレビュー自動実行（依頼書 `DD-006/codex-review-request.md`〔対象は本DDの `packages/sheet-formula`＋`apps/pocd-bench`＋`apps/pocd-browser-bench`＋ADR差分のみ〕→ `bash scripts/codex-review.sh` → `DD-006/codex-review-result.md`）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録

## ログ

### 2026-07-12
- DD作成（`doc/plan/phase0-dd-roadmap.md` DD-006。着手条件: DD-005完了後・DD番号順）
- Codex CLI 利用可否チェック: 利用可（codex-cli 0.144.0-alpha.4）→ 起票時暫定判定: **必須**〔TDD対象（parser/依存グラフ）＋入力検証（formula parser）＋新規パッケージ外部I/F〕・effort **high**〔xhighトリガー非該当〕。実行はPhase 5で全差分1回（DD-004と同運用・サブスク枠節約）
- 画面を伴う実装Phaseなし（Node計測CLI＋純ロジック）のためPlaywright MCP・スクショエビデンスは対象外。エビデンスは計測JSON・レポートで代替
- 要確認1〜5（AC2定量基準／関数範囲／Node計測のみで判定／ADR-011 Accepted化タイミング／エラー値セット）を「検討内容」に記載。ユーザー回答後に決定事項へ反映する
- 制約の記録: playground・既存packages・collaboration-serverは無変更（独立領域）。新規npm依存ゼロ。ワークスペース追加による `package-lock.json` 更新は並行DDのないタイミングで実施。DD-INDEX再生成は親セッションが一括実施（本起票では実行しない）
- 外部レビュー（ChatGPT・手動運用方針に基づく）を受領・6指摘を全て反映: ①4実装3カテゴリ表記統一 ②Node主評価＋採用候補ブラウザ最小確認（`apps/pocd-browser-bench` 追加・AC9） ③AC2を影響式数別に分割（合否=影響100式以下、他4系はWorker分離閾値素材） ④sheet-core実文書との結合試験追加（AC3/4） ⑤parser資源制限をAC8へ昇格 ⑥snapshot参考計測（素朴JSON化）追加。あわせて要確認1〜5をユーザー回答で確定し「決定事項」へ反映
- スコープ増（②④⑥）への注記: 本DDはPhase 0最後の重量級PoCのため、実装中に肥大化の兆候（1レビューサイクル超過）が出た場合はreplay/snapshot計測（Phase 4）を別DDへ分割する

---

## DA批判レビュー記録

> 手順・品質フィルター・再チェック条件は `doc/da-method.md` を参照。

### 共通DA観点（全Phase必須）

**計測の妥当性**（ベンチのデータ分布・Node環境がPoC判断を歪めていないか、合否がJSONから追跡できるか）と、**既存環境の不介入**（`apps/playground`・`packages/sheet-core|sheet-server-core|sheet-types`・`apps/collaboration-server` を変更しない）を毎Phaseで確認する。

| # | Phase | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------|-------------------|--------|----------------------|--------|------|
| | | | | | | |
