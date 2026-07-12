# DD-006: PoC-Dデータ表現・簡易数式

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-12 | 2026-07-12 | 進行中 | DD-005完了→着手。**Phase 1〜3実装済**（CellStore 4実装／数式parser・固定IDバインド／依存グラフ・評価器・差分再計算。test 524件green・回帰0・typecheck:core green・AC2 smoke PASS・AC3/4 sheet-core結合green）。外部レビュー2回反映済み。Phase 4（replay計測）・Phase 5（ブラウザ確認/レポート/ADR/Codex）未着手 |

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
- **実装前詳細化トリガー判定（2026-07-12・Phase 0）**: 新規パッケージ＋性能特性が核心のため **Phase 1〜5すべて「要」**。各Phase冒頭の 📐 実装前詳細化タスクで、候補ストア共通I/F・ベンチ項目・データ分布・数式詳細（`DD-006/function-spec.md` 準拠）を確定してから実装に入る。
- **Phase 0 ドキュメント成果物（2026-07-12・DD-005並行セッション中の独立作業）**: `DD-006/scenarios.md`（Red設計・自然言語・全10節＋AC対応表）と `DD-006/function-spec.md`（資源制限L1〜L6の上限値・5関数の空白/文字列/エラー/範囲/数値変換仕様・6エラー値の発生フェーズと優先）を先行作成。上限値・関数仕様・エラー規則は `function-spec.md` を単一の情報源とし、`scenarios.md`・テストコードが参照する。いずれもワークスペース追加を伴わず `package-lock.json` 非更新（並行 DD-005 と無干渉）。上限値L1〜L6はExcel準拠の提案値で、Phase 2/3実測後に確定余地あり（変更時は本文・function-spec・テストを同時更新）。
- **外部レビュー第2回（2026-07-12・手動運用）の反映**: DD-005待ち時間の助言7点を doc-only で反映（詳細記録: `DD-006/chatgpt-review-20260712-2.md`）。①**ベンチ規約を結果より先に固定**＝`DD-006/bench-protocol.md` 新設（ウォームアップ/試行回数/集計指標/GC/実行順ローテーション/版数記録/生JSONスキーマ/reseed＋**Node↔ブラウザ乖離の事前判定規則**〔時間2倍超 or メモリ1.5倍超→原因分析必須〕。倍率は Phase 1 で確定し以後は結果を見て変えない） ②**CellStoreは単一の勝者を強制しない**＝用途別選択表を許容（ADR-011拡充・bench-protocol §6.1） ③**データ分布を4種へ**（一様疎/連続密/上部左集中/列型偏り・bench-protocol §4） ④**数式は意味論優先**＝`function-spec.md` に §2.1（非有限は暫定`#VALUE!`〔将来`#NUM!`〕・0除算優先・負の0正規化）と §2.2（ロケール不変）を追加。`function-spec.md` を唯一の正としテスト側に別仕様を作らない ⑤**Worker導入条件を判断表として成果物化**（bench-protocol §6.2・影響式数別実測から） ⑥**snapshot閾値は確定しない**＝素朴JSON計測は「Phase 1で正式snapshot形式を設計するための暫定推奨値・桁感」に留める（§16.3・bench-protocol §6.3） ⑦**`sheet-formula` に env-free typecheck**（`tsconfig.core.json`＋`typecheck:core`・テスト除外・`types:[]`）を追加（DD-005 `sheet-collaboration` の [P2] と同種の環境型混入を予防）。

## 受け入れ基準

計画書 §18.4 合格条件を流用（#1〜5）。計測条件: 参照端末=本機（DD-004と同じWin11・機種情報をレポートに記録）・Node 22主評価＋採用候補のブラウザ最小確認（要確認3回答）・非空500,000セル・10,000 formula cells。

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | **4分布**（一様疎/連続密/上部左集中/列型偏り・`bench-protocol.md` §4）×4実装（Map型／チャンク型2実装／列指向配列型の3カテゴリ）でCellStoreベンチ実行 → 生成・読書き・範囲走査時間とメモリの実測表が**分布別に**出力され、カテゴリ別の優劣と決定案（**単一の勝者を強制せず用途別選択表を許容**）をADR-011へ記載できる | Phase 1 ベンチJSON（`bench-protocol.md` 準拠）＋report §1／ADR-011拡充（Phase 5） |
| 2 | 10,000 formula cells文書で1セル変更（**影響100式以下=通常入力シナリオ**） → 依存再計算完了がp95 16ms未満・worst 33ms未満〔要確認1回答〕。影響1,000式／全10,000式／10,000行範囲SUM／10,000式チェーンの実測値がレポートに記録され、Worker分離閾値の素材になる（この4系は合否対象外） | Phase 3 計測（シナリオ別の決定論変更列×N回・p95/worst をJSON出力） |
| 3 | 参照される行の手前に行挿入 → 数式のA1表示は移動後の位置を示し、評価値が変わらない（固定ID参照維持） | Phase 3 ユニットテスト（モックAxisView）＋sheet-core実文書の結合試験（InsertRows適用） |
| 4 | 参照先の行を削除 → 該当式の評価値が `#REF!` になり、他の式は正常のまま | Phase 3 ユニットテスト＋sheet-core実文書の結合試験（DeleteRows適用） |
| 5 | 100,000 Operationをreplay → 1,000/5,000/10,000/50,000/100,000点の所要時間が計測され、snapshot閾値（§16.3）の**暫定推奨値（Phase 1で正式snapshot形式を設計するための桁感。本DDでは確定しない）**を報告できる（素朴JSON化のserialize/parse時間・サイズ・復元後メモリの参考計測を含む） | Phase 4 replay計測JSON＋report §3 |
| 6 | `=1+2*3`・`=(A1+B2)^2`・`=SUM(A1:B10)`・単項マイナス・文字列を入力 → §14.2文法どおり評価。不正式・未知関数・循環・0除算は対応エラー値〔要確認5回答〕。evalや動的コード実行を使わない | Phase 2/3 ユニットテスト＋lint（`no-eval`相当） |
| 7 | 計測レポート・ADR-011拡充・ADR-022ドラフト・Phase 1引き継ぎ事項が文書化される | Phase 5 成果物タスク＋`bash scripts/doc-check.sh` エラー0 |
| 8 | 資源制限境界の入力（最大式長超過・深い括弧ネスト・巨大ASTノード数・過多引数・巨大範囲参照・処理量上限超過）をparse/evaluate → 明示上限で安全に対応エラー値を返し、スタック枯渇・フリーズ・暴走しない | Phase 2/3 ユニットテスト（境界値・超過値。上限値は `DD-006/function-spec.md` に定義） |
| 9 | 採用候補方式を `apps/pocd-browser-bench` でChromeまたはEdge実測 → 500,000セルのロード・代表操作・メモリがNode実測から極端に乖離しない（乖離した場合は原因分析と方式選定への影響をレポートへ記載） | Phase 5 ブラウザ実測＋report §4 |

## タスク一覧

### Phase 0: 事前精査
- [x] 📋 **各Phaseのタスク精査・詳細化**（受け入れ基準1〜9と各Phase検証タスクの対応・ファイルパス明記・変更内容の具体性を確認）→ 完了(2026-07-12): AC1〜9とシナリオの対応表を `DD-006/scenarios.md` 付録に作成。各Phaseの新規ファイルパスは本文タスクで明記済み・変更対象は新規のみ（既存package無変更）を再確認
- [x] 🧪 **テスト設計（Red）**: 文法境界（演算子優先順位・単項連鎖・空白/文字列/エラー伝播・範囲境界）・資源制限境界（式長・ASTノード数・ネスト深さ・引数数・範囲セル数・処理量の各上限値と超過時挙動＝AC8。上限値は `DD-006/function-spec.md` に定義）・バインド境界（挿入/削除/移動・絶対相対）・依存グラフ（diamond依存・range重なり・cycle）・CellStore境界（チャンク境界・空行・密疎切替）のシナリオを `DD-006/scenarios.md` に自然言語で作成（合意済みスコープ内は自動継続ルールで進行）→ 完了(2026-07-12): `DD-006/scenarios.md`（10節＋AC対応表）・`DD-006/function-spec.md`（資源制限L1〜L6・5関数仕様・6エラー値の発生フェーズと優先）を作成。第2回外部レビュー反映で `DD-006/bench-protocol.md`（ベンチ規約・証跡JSONスキーマ・Node↔ブラウザ乖離判定・結論テンプレート）も追加
- [x] 📐 **実装前詳細化トリガー判定**（新規パッケージ＋性能特性が核心のため全Phase「要」想定。判定結果 `Phase N → 要/不要` を本文へ明記）→ 完了(2026-07-12): **Phase 1〜5すべて「要」**（詳細は「決定事項」へ明記）
- [x] 🧑‍⚖️ **Codexレビュー要否判定**（起票時暫定: **必須・effort high**〔TDD対象＋parser=入力検証＋新規パッケージ外部I/F〕。実行はPhase 5で全差分1回=DD-004と同運用）→ 完了(2026-07-12): 暫定判定を**確定**（必須・effort high）。実行はPhase 5・全差分1回
- [x] 😈 **Devil's Advocate調査**（特に「Node計測がブラウザ実態と乖離する」「ベンチのデータ分布が実業務と乖離し方式選定を歪める」「CellReader抽象がPhase 1のsheet-core結合で漏れる」リスク）→ 完了(2026-07-12): 5件を「DA批判レビュー記録」へ記載

### Phase 1: CellStore方式比較（疎/密×4実装・3カテゴリ）★実装済（2026-07-12）
- [x] 📐 **実装前詳細化** → 完了: `CellStoreCandidate`（`cell-store.ts`）＝共通契約（get/set/bulkLoad/queryRange/nonEmptyCount/approxMemoryBytes）、ベンチ項目＝`bench-protocol.md`、データ分布＝`data-gen.ts` 4分布。既存 pocb（PRNG/行スロット）・sheet-collaboration（構成雛形）を再利用（apps間 import はせず再実装＝憲章§25）
- [x] `apps/pocd-bench/src/stores/{map-store,chunked-column-store,chunked-rowslot-store,columnar-store}.ts`（新規）: 共通 `CellStoreCandidate` インターフェイスで4実装（①Map型＝単一Map／②チャンク型2実装＝§6.4列チャンクMap・DD-004行スロット移植／③列指向配列型＝密向け・数値列 Float64Array）＋ユニットテスト（等価性: 同一操作列で4実装の読出結果一致）→ **全4分布で等価性 green**（get/nonEmptyCount/queryRange 一致）
- [x] `apps/pocd-bench/src/data-gen.ts`（新規）: シード付きPRNGで**4分布**（`uniform-sparse` 50,000×200非空500,000／`dense-block` 連続500,000／`top-left-cluster` 上部左集中／`column-typed` 列型偏り・`bench-protocol.md` §4）＋ストレッチ（2,000,000）を決定論生成。分布パラメータ（非空率・クラスタリング・型混在比）可変＋ユニットテスト（件数・再現性）→ **完了**（正準数値生成でcolumnar round-trip担保・決定論/件数/分布テスト green）
- [x] `apps/pocd-bench/src/bench-cellstore.ts`＋CLIエントリ（新規）: **`bench-protocol.md` 準拠**（ウォームアップ3・本計測10・中央値/p95/worst・GC明示・実行順ローテーション）で一括ロード・ランダム読書き（10万回）・範囲走査・メモリ実測→生JSON（§3スキーマ）出力 → **完了**（`npm run bench:cellstore --workspace apps/pocd-bench`・`--expose-gc`・`meta.acRelevant` で合否/参考を区別。smoke確認済・500k本計測はPhase 5）
- [x] 🔬 **機械検証**: `npm run test`/`typecheck`/`lint` green（既存workspace回帰0）＋ベンチCLI実行でJSON出力 → **完了**（test **455件green＝既存438＋新17・回帰0**／typecheck 全workspace green／lint green／bench CLI JSON出力確認）
- [x] 😈 **DA批判レビュー**（GC影響の排除・ウォームアップ・計測順序の偏り）→ **完了**（DA表 #6〜#8: 計測ノイズ抑制の実装・メモリ概算の粒度・columnar数値列変換の等価性）

### Phase 2: formula parser・固定IDバインド（TDD）★実装済（2026-07-12）
- [x] **Red→Green**: `packages/sheet-formula/src/{tokenizer,parser,limits,bind}.test.ts` へ scenarios.md をコード化→実装で green 化 → **完了**（44テスト green）
- [x] `packages/sheet-formula/src/{tokenizer,parser,ast}.ts`（新規）: §14.2文法（比較演算は予約のみ・拒否）・canonical AST（`serialize`）・エラー値型（6種＝`errors.ts`）＋`a1.ts`（列↔index）→ **完了**（優先順位/べき乗左結合/単項/`-2^2`=`(-2)^2`/未知関数=#NAME?/大小非区別/canonical whitespace不変）
- [x] `packages/sheet-formula/src/limits.ts`（新規）: parser資源制限（L1式長/L2ASTノード数/L3ネスト深さ/L4引数数/L5範囲セル数）＋境界/超過ユニットテスト（AC8） → **完了**（`DEFAULT_LIMITS`＝function-spec §1。深さ10万でもスタック枯渇せずエラー値。L5→#REF!。L6=処理量はPhase 3評価器）
- [x] `packages/sheet-formula/src/bind.ts`（新規）: A1↔`BoundCellReference` 双方向変換（`$`属性保持）・範囲参照・`AxisView` インターフェイス（RowId/ColumnId⇄表示index）→ **完了**（行挿入でRowId不変・A1表示A1→A3・参照先削除で#REF!・`createArrayAxisView`）
- [x] `packages/sheet-formula/tsconfig.core.json`＋`typecheck:core`（新規・助言#7）: 実装ファイル（`src/**/*.ts`・`exclude:*.test.ts`・`types:[]`・DOM lib なし）の env-free 型検査ゲート → **完了**（`typecheck:core` green・`dependencies` 空＝外部ランタイム依存ゼロ）
- [x] 🔬 **機械検証**: `test`/`typecheck`/`typecheck:core`/`lint` green。パッケージのランタイム依存ゼロ（package.json `dependencies` なし・env-free 型検査で Node/DOM 型混入なし）を確認 → **完了**（test **499件green＝Phase 1後455＋新44・回帰0**／typecheck 全workspace green／typecheck:core green／lint green／`dependencies:{}`）
- [x] 😈 **DA批判レビュー**（全角/空白トークン・巨大数値・深いネストのスタック）→ **完了**（DA表 #9〜#10: 深いネストのスタック安全・比較演算子/裸識別子のエラー分類）

### Phase 3: 依存グラフ・差分再計算・評価器（TDD＋計測）★実装済（2026-07-12）
- [x] **Red→Green**: `packages/sheet-formula/src/{dep-graph,evaluator}.test.ts`（cycle・diamond・range重なり・#REF!伝播）＋`apps/pocd-bench/src/integration-sheetcore.test.ts`（行挿入/削除の参照維持=AC3/4実文書）→ **完了**（evaluator 13＋dep-graph 10＋結合 2）
- [x] `packages/sheet-formula/src/dep-graph.ts`（新規）: 全展開＋列別interval indexの2実装（§14.4）・dirty集合→topological再計算・DFS coloring cycle検出 → **完了**（2戦略の dependents 集合が等価・**反復DFS**で深いチェーンでもスタック枯渇せず・自己/相互/3項/範囲自己包含の循環→#CYCLE!）＋`recalc.ts`（FormulaSheet=値ストア＋CellReader）
- [x] `packages/sheet-formula/src/evaluator.ts`（新規）: `CellReader` 抽象上で5関数（SUM/AVERAGE/MIN/MAX/COUNT・要確認2回答）・空白/文字列/エラー伝播規則・**特殊値の意味論**（非有限→暫定`#VALUE!`・0除算優先・負の0正規化＝function-spec §2.1／ロケール不変＝§2.2）・評価時資源制限（処理量上限カウンタ L6＝AC8）を実装 → **完了**（範囲=非空走査・COUNTのみエラー非伝播・AVERAGE数値0件=#DIV/0!・関数仕様は `function-spec.md` 準拠でテスト側に別仕様なし）
- [x] `apps/pocd-bench/src/integration-sheetcore.test.ts`（新規）: sheet-core結合試験（AC3/4の実文書版）— sheet-coreで文書作成→数式をRowId/ColumnIdへbind→`InsertRows`適用→A1表示変化・固定ID評価値維持を確認／`DeleteRows`適用→`#REF!` を確認 → **完了**（sheet-coreは読み取り＋`applyOperation`のみ・`displayRowOrder`/`columnOrder` から読み取り専用 AxisView アダプタ・A1→A2表示変化＆値10維持＆削除で#REF!）
- [x] `apps/pocd-bench/src/bench-recalc.ts`（新規）: 影響式数別シナリオ（**影響100式以下=合否対象**／影響1,000式／全10,000式／10,000行範囲SUM／10,000式チェーン=レポート項目・Worker分離閾値素材）で1セル変更×N回→シナリオ別p95/worst JSON出力（AC2）＋依存表現2方式の構築/更新時間比較 → **完了**（`npm run bench:recalc`〔`--full`で10,000規模〕・`ac2Judgment` 出力。smoke値: fanout-100 p95 0.76ms/worst 0.76ms=**PASS**。本計測10,000式はPhase 5）
- [x] 🔬 **機械検証**: `test`/`typecheck`/`typecheck:core`/`lint` green＋bench-recalc実行でAC2判定値出力 → **完了**（test **524件green＝Phase 2後499＋新25・回帰0**／typecheck・typecheck:core・lint green／bench-recalc `ac2Judgment.pass=true`）
- [x] 😈 **DA批判レビュー**（再計算順の非決定性・interval indexの境界off-by-one・エラー伝播の抜け）→ **完了**（DA表 #11〜#12: 深いチェーンのスタック安全〔反復DFS〕・2戦略の dependents 等価性）

### Phase 4: Operation replay計測
- [ ] `apps/pocd-bench/src/op-gen.ts`（新規）: シード付きPRNGで100,000 Operation列（SetCells/InsertRows/DeleteRows混在比率は決定論・DD-003 fuzzer踏襲）＋ユニットテスト（再現性）
- [ ] `apps/pocd-bench/src/bench-replay.ts`（新規）: `@nanairo-sheet/sheet-core` の `apply` で1,000〜100,000点の所要時間・最終document hash・メモリを計測（AC5）。formula付きSetCells→一括再計算の参考計測を含む
- [ ] 同 bench-replay に**snapshot参考計測**を追加: 各計測点のreplay後文書を素朴にJSON化し、serialize/parse時間・JSONサイズ・復元後メモリを記録（合否対象外・snapshot閾値判断の桁感素材。圧縮時間は任意）
- [ ] 🔬 **機械検証**: `test`/`typecheck`/`lint` green＋bench-replay実行でJSON出力（hash一致=DD-003結果と整合）
- [ ] 😈 **DA批判レビュー**（Operation分布の偏りでreplayが軽く出る・InsertRows多発時のAxis再構築コスト）

### Phase 5: ブラウザ最小確認・計測レポート・ADR-011拡充・ADR-022ドラフト・引き継ぎ・Codexレビュー
- [ ] `apps/pocd-browser-bench`（新規・最小静的ページ）: 採用候補（決定案）方式の500,000セルロード・代表操作（ランダム読書き・範囲走査）・メモリをChromeまたはEdgeで実測し、Node実測との乖離を確認（AC9。playground非依存・devサーバーはルート既存Vite・新規npm依存なし）
- [ ] 計測実施→ `doc/DD/DD-006/measurement-report.md`（新規・添付）: AC1〜5・8〜9の実測値・合否・機種情報（ブラウザ版数含む）・**結論表**（`bench-protocol.md` §6: CellStore用途別選択表／Worker分離判断表／snapshot暫定推奨）・既知の制約・Phase 1へ引き継ぐ設計注意事項（CellStoreのsheet-core組込方針・RowIdキー化・Worker分離閾値〔影響式数別実測から〕・サーバーre-parse）
- [ ] `doc/adr/0011-row-slot-chunked-cell-store.md`（拡充）: **4分布**比較の実測を「結果」へ追記し決定案（**単一の勝者を強制せず用途別選択表を許容**・bench-protocol §6.1）を記載（Accepted化は要確認4の回答に従う）
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
- 外部レビュー（ChatGPT・手動運用方針に基づく）を受領・6指摘を全て反映（詳細記録: `DD-006/chatgpt-review-20260712.md`）: ①4実装3カテゴリ表記統一 ②Node主評価＋採用候補ブラウザ最小確認（`apps/pocd-browser-bench` 追加・AC9） ③AC2を影響式数別に分割（合否=影響100式以下、他4系はWorker分離閾値素材） ④sheet-core実文書との結合試験追加（AC3/4） ⑤parser資源制限をAC8へ昇格 ⑥snapshot参考計測（素朴JSON化）追加。あわせて要確認1〜5をユーザー回答で確定し「決定事項」へ反映
- スコープ増（②④⑥）への注記: 本DDはPhase 0最後の重量級PoCのため、実装中に肥大化の兆候（1レビューサイクル超過）が出た場合はreplay/snapshot計測（Phase 4）を別DDへ分割する
- **Phase 0 事前精査を実施**（DD-005を別セッションで並行実施中の独立ドキュメント作業・`package-lock.json` 非更新で無干渉）: `DD-006/scenarios.md`・`DD-006/function-spec.md` を作成、実装前詳細化トリガー判定（Phase 1〜5全「要」）、Codexレビュー要否を確定（必須・effort high）、DA調査5件を記録。Phase 1以降（コード実装・ワークスペース追加）は**着手条件（DD-005完了）未達**かつ**lock衝突回避**のため未着手（DD-005完了後に着手）。本作業はコミットせず作業ツリーに残す（ユーザーレビュー用）
- **外部レビュー第2回を受領・7指摘を doc-only で反映**（手動運用方針・詳細記録: `DD-006/chatgpt-review-20260712-2.md`）: ①ベンチ規約先行固定（`bench-protocol.md` 新設） ②CellStore用途別選択表を許容 ③データ分布4種 ④数式の意味論を function-spec §2.1/§2.2 へ明文化（非有限・負の0・ロケール不変） ⑤Worker導入条件を判断表として成果物化 ⑥snapshot閾値は暫定推奨に留める ⑦sheet-formula に env-free typecheck 追加。決定事項・AC1/AC5・Phase 1/2/3/5タスクへ還流。コード・workspace・lock は不変（実装はDD-005完了後）
- **Phase 1（CellStore 4実装比較）実装**（DD-005完了→着手。ゲート確認で「現行計画で即着手」・プロセス密度レビューは Phase 0残り現状維持で無ブロック）: 新規ワークスペース `apps/pocd-bench`（Node計測CLI・製品昇格しない）を追加し `package-lock.json` を更新（並行DDなしのタイミングで実施＝DD本文の制約どおり）。`cell-store.ts`（共通契約）・4ストア（map／chunked-column〔§6.4列チャンク〕／chunked-rowslot〔DD-004移植〕／columnar〔密向け・数値列 Float64Array〕）・`data-gen.ts`（4分布・正準数値）・`bench-cellstore.ts`（bench-protocol準拠CLI）・等価性/data-genテストを実装。**test 455件green（既存438＋新17・回帰0）・typecheck/lint 全workspace green・bench CLI JSON出力確認**。PRNG/行スロットは pocb を再実装（apps間 import なし＝憲章§25）。既存 playground/packages/collaboration-server は無変更。ステータス 検討中→進行中。Phase 2以降（parser/固定IDバインド/依存グラフ/replay/レポート/ADR/Codex）未着手
- **Phase 2（数式parser・固定IDバインド）実装**（TDD・一気通貫指示で継続）: 新規製品パッケージ `packages/sheet-formula`（外部ランタイム依存ゼロ・DOM/Node非依存・env-freeゲート `tsconfig.core.json`＋`typecheck:core`）を追加。`errors`（6エラー値）・`limits`（L1〜L5＝function-spec §1）・`a1`（列↔index）・`ast`（canonical＋`serialize`）・`tokenizer`（ASCIIのみ・全角/未定義文字拒否）・`parser`（§14.2再帰下降・演算子優先順位・べき乗左結合・単項・比較演算子拒否・#NAME?・資源制限）・`bind`（A1↔`BoundCellReference`・`AxisView`・行挿入でRowId不変/削除で#REF!）を実装。**test 499件green（Phase 1後455＋新44・回帰0）・typecheck/typecheck:core/lint green・`dependencies:{}`**。L6（評価時処理量）はPhase 3評価器で実装。Phase 3以降未着手
- **Phase 3（依存グラフ・差分再計算・評価器）実装**（TDD＋計測）: `sheet-formula` に `evaluator`（5関数・特殊値§2.1/§2.2・エラー伝播・L6処理量上限）・`dep-graph`（2戦略〔expand/interval〕・dirty→topological・**反復DFS coloring cycle検出**〔深いチェーンでスタック枯渇しない〕）・`recalc`（FormulaSheet=値ストア＋CellReader）を追加。`pocd-bench` に `integration-sheetcore.test`（sheet-core 実文書で AC3/4＝行挿入でA1→A2表示・固定ID評価値維持・削除で#REF!。読み取り＋`applyOperation`のみ）・`bench-recalc`（影響式数別 p95/worst・AC2判定・2戦略比較）を追加（pocd-benchへ sheet-formula/sheet-types 依存追加・lock更新）。**test 524件green（Phase 2後499＋新25・回帰0）・typecheck/typecheck:core/lint green**。AC2 smoke: fanout-100 p95 0.76ms/worst 0.76ms=**PASS**（16/33ms基準・本計測10,000式はPhase 5）。DA #11〜#12記録。Phase 4以降未着手

---

## DA批判レビュー記録

> 手順・品質フィルター・再チェック条件は `doc/da-method.md` を参照。

### 共通DA観点（全Phase必須）

**計測の妥当性**（ベンチのデータ分布・Node環境がPoC判断を歪めていないか、合否がJSONから追跡できるか）と、**既存環境の不介入**（`apps/playground`・`packages/sheet-core|sheet-server-core|sheet-types`・`apps/collaboration-server` を変更しない）を毎Phaseで確認する。

| # | Phase | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------|-------------------|--------|----------------------|--------|------|
| 1 | 0 | **Node計測の合格＝ブラウザ合格ではない**。Node/Chrome は同一V8だがGC挙動・メモリ上限（Chromeタブ≒数GB／Node `--max-old-space-size`）・DevToolsオーバーヘッドが異なり、§18.6 No-Go「ブラウザーメモリ上限超過」はNodeだけでは判定不可 | 高 | Nodeで500k/2Mセルを`process.memoryUsage()`計測 → 同方式を`pocd-browser-bench`でChrome計測 → RSS/heap値を比較 | 計測の妥当性 | AC9（採用候補のChrome/Edge実測）を必須化済み。レポートにNode/ブラウザ両値を並記し乖離>閾値なら原因分析（対応済み・実装時に遵守） |
| 2 | 1 | **ベンチのデータ分布の代表性**。data-genの疎/密が実業務（上部集中入力・列ごとの型偏り）と乖離すると方式選定が歪む。特に列指向配列型は密有利・疎不利で分布次第で結論反転 | 高 | data-genの非空率・クラスタリング・型混在比を変えて4方式を計測 → 分布により優劣順が変わることを確認 | 計測の妥当性 | 分布パラメータを可変にし疎/密の両極＋中間1点を計測。レポートに分布前提を明記し「業務データ確定後に再評価」をPhase 1引き継ぎへ（Phase 1詳細化で実装） |
| 3 | 3 | **CellReader抽象の漏れ**。Phase 1のsheet-core正式結合で、範囲走査効率（非空のみ vs 全走査）・エラー値受け渡し・CellScalar型整合が漏れると再設計 | 中 | `integration-sheetcore`でCellReader経由の実アクセスを1本通し、非空走査・エラー透過・型対応の契約を検査 | 計測の妥当性 | §10結合試験でCellReader実アクセスを通し、インターフェイス契約（非空走査・エラー透過・型対応）をPhase 2で明文化（`function-spec.md` §6引き継ぎ） |
| 4 | 0 | **既存環境の不介入とlock衝突**。ワークスペース3追加で`package-lock.json`が更新され並行DD（DD-005）と衝突しうる | 中 | 並行DD実施中に`npm install`→lock差分が両セッションで競合 | 既存環境の不介入 | ワークスペース追加は並行DDのないタイミングで実施（本文既記）。Phase 0ドキュメント作業はlock非更新で並行安全（本作業で遵守） |
| 5 | 1 | **GC・ウォームアップの計測ノイズ**。一括ロード/読書きベンチがGCタイミング・ウォームアップ不足で歪む | 中 | 単一試行のみで計測 → 試行間で数十%ぶれることを確認 | 計測の妥当性 | 各ベンチにウォームアップ＋複数試行の中央値、`--expose-gc`で計測境界のGC明示、計測順序ローテーション（Phase 1詳細化でbench共通土台に実装） |
| 6 | 1 | 計測ノイズ対策の実装確認（DA #5 の実装）。bench-cellstore が warmup/trials/GC明示/順序ローテーションを実装しているか | 中 | `bench-cellstore.ts` レビュー＋smoke実行 | 計測の妥当性 | 実装済（warmup 3・trials 10・中央値/p95/worst・各計測直前 `globalThis.gc()`＋`--expose-gc`・分布ごと実行順ローテーション・全raw保存）。残: `heapUsed` はストア外割当も含み粗い → 方式間比較は `approxMemoryBytes()` を主指標・heapUsed は補助（Phase 5レポートで並記） |
| 7 | 1 | 既定 smoke 規模（5,000×50・非空20,000）で満足し 500k 本計測（AC1合否）を怠るリスク | 中 | 既定引数で bench 実行→合否規模でないことに気づかない | 計測の妥当性 | JSON `meta.acRelevant`（非空≥500,000 で true）で合否/参考を機械的に区別。`bench-protocol.md` §0/§5 に「500k本計測は Phase 5」明記。Phase 5 で 50,000×200・非空500,000 を CLI 引数で実施 |
| 8 | 1 | columnar の数値列 Float64Array 化は「正準数値（String(Number(s))===s）」前提。data-gen が非正準数値を出すと round-trip 破綻＝等価性崩壊 | 中 | 非正準数値（"12.50" 等）を数値列に入れ get が "12.5" を返さないか | 正しさ（等価性） | data-gen は正準数値のみ生成（テスト `isCanonicalNumber` で検証）。非正準値 set 時は該当列を文字列列へ変換する経路を実装＋変異等価性テストで担保。4分布すべてで等価性 green |
| 9 | 2 | 再帰下降パーサは深いネストで**スタック枯渇**の懸念（外部入力＝数式・AC8の核心） | 高 | `=(((…)))` を深さ10万で parse | 正しさ（安全性） | L3（ネスト深さ64・`DEFAULT_LIMITS`）で `enter()` が深さ超過を検出し #ERROR!。**深さ10万でもクラッシュせずエラー値を返す**ことをテストで確認（例外を外へ出さない・parse は必ず結果オブジェクトを返す） |
| 10 | 2 | エラー分類の一貫性（function-spec §4 との一致）。比較演算子・裸識別子・未知関数・引数0・範囲超過のエラー値が仕様どおりか | 中 | 各境界式を parse しエラー値を照合 | 正しさ | 比較演算子→#ERROR!（予約拒否）／未知関数・裸識別子→#NAME?／引数0・構文→#ERROR!／範囲L5超過→#REF!。parser.test/limits.test で網羅。指数表記 `1e3` は #ERROR!（MVP未対応・scenarios §1 既知の制約） |
| 11 | 3 | **深い依存チェーンの再計算順で再帰DFSがスタック枯渇**（10,000式チェーンはレポート項目）。数式は外部入力・AC8の系 | 高 | chain-10,000 を recalcAll | 正しさ（安全性） | topoSort を**再帰→反復DFS**へ変更（明示 frame スタック＋gray path）。chain-2,000 の再計算・cycle検出がクラッシュせず動作（bench-recalc chain シナリオ green）。深いチェーンでもエラーにならず正しい順序で収束 |
| 12 | 3 | 依存表現2方式（expand/interval）で **dependents 集合が食い違う**と方式比較が無意味＋再計算漏れ | 中 | 範囲重なり・連鎖のグラフで両戦略の affectedSet を比較 | 計測の妥当性／正しさ | `dep-graph.test` で両戦略の `affectedSet` 等価性を検証（`SUM(A1:A50)`＋`SUM(A25:A75)`重なり＋連鎖 D=A1+B1・複数変更点）。bench-recalc は同一結果前提で構築/更新時間のみ比較 |
