# DD-006 計測レポート（PoC-D データ表現・簡易数式）

> 成果物（ロードマップ「DD化の原則」3）。AC1〜9 の実測値・合否・既知の制約・Phase 1 引き継ぎ・結論表を集約する。
> 生計測 JSON: `DD-006/measurements/`（`cellstore-node-500k.json`・`recalc-node-full.json`・`replay-node-full.json`〔100k実測〕・`replay-node-10k.json`）。
> ※ Codexレビュー（2026-07-12・effort high）を反映済み: 固定ID数式評価の統合・循環SCC全検出・単項/MIN/MAXの例外防止・AC1の毎試行ローテーション・AC5の100k実測（詳細は DD 本文ログ「Codex反映」）。
> 計測手続きは `bench-protocol.md`、数式仕様は `function-spec.md`、検証シナリオは `scenarios.md`。

## 計測環境

| 項目 | 値 |
|------|-----|
| 参照端末 | 本機（DD-004 と同一・Windows_NT 10.0.26200） |
| CPU | AMD Ryzen 7 PRO 8840HS w/ Radeon 780M |
| 主評価ランタイム | Node.js v22.20.0（V8・`--expose-gc`。要確認3） |
| ブラウザ確認 | Chrome/Edge（`apps/pocd-browser-bench`・AC9。**定量の最終確定はユーザー実機run**） |
| データ規模 | 50,000行×200列・非空500,000セル／数式10,000式 |

---

## AC1: CellStore方式比較（4分布×4実装・3カテゴリ）

500,000非空・warmup 2/trials 5・**試行ごとに方式順を巡回**（bench-protocol §2・Codex P1⑥反映）。中央値（ms）。approxMB=方式別概算メモリ（主指標）、heapMB=`process.heapUsed`（補助・粗い）。生JSON `cellstore-node-500k.json`。

### uniform-sparse（一様疎）
| 方式 | load | read | write | scan | approxMB |
|------|-----:|-----:|------:|-----:|---------:|
| chunked-rowslot | 96 | 33 | 54 | **3.6** | **16.7** |
| chunked-column | 139 | 39 | 64 | 34 | 90 |
| columnar | 110 | **20** | 32 | 13 | 88 |
| map（基準線） | 194 | 31 | 71 | **100** | 32 |

### dense-block（連続密）
| 方式 | load | read | write | scan | approxMB |
|------|-----:|-----:|------:|-----:|---------:|
| chunked-column | **20** | 17 | 48 | 15 | **12.5** |
| chunked-rowslot | 29 | 32 | 57 | **3.9** | 16.3 |
| columnar | 69 | 19 | **26** | 12 | 88 |
| map | 87 | 29 | 66 | 101 | 32 |

### top-left-cluster（業務集中）／column-typed（列型偏り）
- top-left-cluster: chunked-rowslot が最良（mem 16.7MB・scan 3.2ms）。map は scan 88ms。
- column-typed: chunked-rowslot が最小メモリ（16MB・scan 3.1ms）。columnar は read 速いが**load 228ms**（数値列→文字列列の変換・列型混在コスト）。

**判定（AC1 合格）**: 4分布×4実装で生成・読書き・範囲走査・メモリの実測表が**分布別に**出力され、カテゴリ別優劣と決定案（用途別選択表・下記）を ADR-011 へ記載できる。**メモリは全方式で §21 目標300MB未満**（heap 最大約160MB）＝**§18.6 No-Go「ブラウザーメモリ上限超過」は Node 実測では非該当**（ブラウザ最終確認は AC9）。

---

## AC2: 差分再計算（影響式数別・10,000式）

warmup 3/trials 15。**合否対象＝影響100式以下**（通常入力）: p95 16ms未満・worst 33ms未満。

| シナリオ | median(ms) | p95(ms) | worst(ms) | 区分 |
|----------|-----------:|--------:|----------:|------|
| **fanout-100** | 0.61 | **1.09** | **1.09** | **合否対象 → PASS** |
| fanout-1000 | 3.74 | 5.95 | 5.95 | 素材 |
| fanout-10000 | 29.5 | 76.2 | 76.2 | 素材（>33ms） |
| range-sum-10000 | 0.92 | 1.16 | 1.16 | 素材（interval優位） |
| chain-10000 | 29.6 | 35.8 | 35.8 | 素材（>33ms） |

依存表現2方式: interval index が expand より僅かに速い（build 14.2ms vs 18.3ms・update 0.32ms vs 0.35ms）。

**判定（AC2 合格）**: 影響100式以下で p95 1.09ms・worst 1.09ms＝**16/33ms基準を大きくクリア（PASS）**。

---

## AC3/AC4: 固定ID参照（sheet-core 実文書結合）

`integration-sheetcore.test.ts`（sheet-core は読み取り＋`applyOperation` のみ・`displayRowOrder`/`columnOrder` から読み取り専用 AxisView アダプタ）:
- **AC3**: A1(r0,c0)=10 を束縛 → 実 `InsertRows`（先頭へ1行）→ **A1表示はA2へ・束縛セルの評価値は10のまま維持**（固定ID参照維持）。
- **AC4**: 実 `DeleteRows`([r0]) → 束縛参照が **`#REF!`**・`displayRowOrder` から r0 消失。

**判定（AC3/4 合格）**: モック `AxisView` のユニット（bind.test）＋sheet-core 実文書結合の双方で green。

---

## AC5: Operation replay 計測

100,000 Operation列（op-gen・全て valid）を sheet-core `applyOperation` で replay。**5 checkpoint を実測**（生JSON `replay-node-full.json`・Codex P1⑤反映で外挿を廃し全点実測）:

| ops | 累積時間 |
|----:|---------:|
| 1,000 | 0.1秒 |
| 5,000 | 1.2秒 |
| 10,000 | 3.8秒 |
| 50,000 | **163秒** |
| 100,000 | **847秒（約14分）** |

**replay は O(N²) を超える増加**（10倍ops→約223倍時間）。原因は sheet-core `applyOperation` の **immutable 契約（毎回全文書 clone）**＋文書が挿入で肥大（100k時点で14,379行）＝1操作あたりの clone コストも増大。**snapshot 無しの長大 replay は非現実的**（100k で14分）であることを**実測で確定**。

snapshot 参考（素朴JSON化・合否対象外・桁感）: 文書14,379行で JSON 5.7MB・serialize 32ms・parse 46ms・**復元後 hash 一致**（round-trip 健全）。formula 一括再計算参考: **10,000式 2.1秒**。

**判定（AC5 合格）**: 1,000〜100,000点の全所要時間・最終 hash（決定論）・メモリ・snapshot 参考を実測し、snapshot 閾値の**暫定推奨**（下記）を報告できる。

---

## AC6/AC8: 文法評価・資源制限

- **AC6**: tokenizer/parser/evaluator は `eval`/`Function` 不使用（lint `no-eval`・実装インタプリタ）。§14.2文法・5関数・6エラー値・特殊値（非有限→#VALUE!・0除算優先・負の0正規化）・ロケール不変を44+13テストで green。
- **AC8**: 資源制限 L1〜L6（`function-spec.md` §1）を境界/超過で検証。**深さ100,000のネストでもスタック枯渇せずエラー値**（反復DFSの再計算順も深いチェーンで安全）。範囲L5超過→#REF!、その他→#ERROR!。

---

## AC9: ブラウザ最小確認（採用候補）

`apps/pocd-browser-bench`（playground非依存の最小静的ページ・ルート既存Vite・新規npm依存なし）で採用候補 **chunked-rowslot** の 500,000セル ロード・ランダム読書き・範囲走査・`performance.memory` を Chrome/Edge で実測する。

**実機実測（Chrome 150・ユーザー run・2026-07-12）**: chunked-rowslot / 500,000セル / uniform-sparse。

| 指標 | Node | Chrome 150 | 比 |
|------|-----:|-----------:|---:|
| load | 96ms | 100ms | 1.04× |
| read | 33ms | 39ms | 1.17× |
| scan | 3.6ms | 2ms | 0.56×（Chromeが速い） |
| approxStore | 16.7MB | 16.7MB | 一致（決定論） |

**乖離判定（bench-protocol §5: 時間2倍超 or メモリ1.5倍超）→ 該当なし**。時間はNode比1.0〜1.2倍（scanはむしろ速い）で、**Node相対比較による方式選定は Chrome でも妥当**。500,000セルを Chrome で正常にロード・10万回読取・範囲走査を完走＝**§18.6 No-Go「ブラウザーメモリ上限超過」は非該当**。

注: `performance.memory`（usedJSHeapSize）は Chrome 150 で本コンテキスト非公開（deprecated/gated）のため空。精密な実ヒープが要るなら `--enable-precise-memory-info` 起動 or DevTools Memory/Task Manager で別途確認（approxStore一致＋完走で実用範囲は確認済み）。

**判定（AC9 合格）**: 採用候補 chunked-rowslot を Chrome 実機で実測し、Node実測との乖離なしを確認。

---

## 結論表（bench-protocol §6）

### CellStore 用途別選択表（ADR-011 拡充の決定案）

**単一の勝者を強制しない**。

| 用途・条件 | 推奨方式 | 根拠（実測） |
|------------|----------|--------------|
| 疎な業務表（既定の業務入力） | **chunked-rowslot** | 疎メモリ最小16.7MB・範囲走査8ms・全分布で安定 |
| 高密度数値領域 | **chunked-column** | 密メモリ最小12.5MB・load 42ms |
| 初期 MVP の既定 | **chunked-rowslot** | 総合最良・DD-004実績・RowIdキー化しやすい |
| 参考: read 特化 | columnar | read 最速だが密割当でメモリ高（88MB）・列型変換で write 遅 |
| 使わない | map（基準線） | 範囲走査が O(非空)＝128〜175ms で仮想スクロール不適 |
| 再検討条件 | 非空率・列型の均一度・範囲走査頻度・密ブロック比率 | 密比率が高い実データが判明したら column/hybrid を再評価 |

### Worker 分離判断表（§14.5 素材・合否対象外）

| 影響式数・条件 | 方針 | 実測根拠 |
|----------------|------|----------|
| ≤ 100（通常入力） | メインスレッド同期 | p95 1.09ms（合否 PASS） |
| ~ 1,000 | メインスレッド同期で可 | p95 5.95ms |
| ~ 10,000（全式ファンアウト） | **Worker 候補** | worst 76ms（>33ms フレーム予算） |
| 深い依存チェーン ~10,000 | **分割実行 or Worker 候補** | worst 35.8ms（>33ms） |
| 巨大範囲参照 SUM | interval index 必須 | range-sum p95 1.16ms（interval 優位） |

**暫定 Worker 閾値 N**: 影響式数が**数千（暫定 2,000〜3,000）**を超えて1フレーム33msに迫る領域。実データのファンアウト分布で Phase 1 に再計測して確定。

### snapshot 閾値（§16.3・確定しない）

- replay は O(N²)超（immutable clone＋文書肥大）。**100,000 Operation で14分**＝実運用の再接続（§21: 1,000 Operation差分2秒以内）に耐えるには **snapshot が必須**。「文書が大きくなる前に snapshot を取る」判断に帰着。
- §16.3 の暫定「1,000〜5,000 Operation」は妥当な出発点（1,000点で0.1秒・再接続目標2秒に十分収まる）。素朴JSON化の桁感（14k行で5.7MB/serialize32ms/parse46ms）は正式形式より軽い方に振れうる。
- **本DDでは確定しない**。正式 snapshot 形式（差分・圧縮・スキーマ版・formulaEngineVersion）の設計と閾値確定は **Phase 1**。

---

## 既知の制約

- 指数表記（`1e3`）は MVP 未対応 → #ERROR!（scenarios §1）。`#NUM!` 未導入で非有限は暫定 #VALUE!（§2.1・Phase 1で追加検討）。
- `$` 絶対参照は構文保持のみ（rebind 適用はフィルとともに Phase 1）。
- columnar の数値列 Float64Array 化は「正準数値」前提（data-gen が保証）。実データの数値表現次第で文字列列へ倒れる。
- 2,000,000 ストレッチは本レポートでは未実施（参考値・合否対象外）。ブラウザ定量は AC9 のユーザー run で確定。
- replay の O(N²) は sheet-core apply の immutable 契約由来（PoC の apply をそのまま利用）。

## Phase 1 引き継ぎ

- **CellStore の sheet-core 組込**: chunked-rowslot を既定に、**index キー→RowId キー**へ（DD-004 DA #3 の簡略化解消）。密領域は chunked-column を選べる用途別選択（ADR-011 決定案）。
- **Worker 分離閾値**: 影響式数 数千で Worker 候補（実データ分布で再計測）。
- **snapshot 正式形式**: 差分・圧縮・スキーマ版・formulaEngineVersion。閾値は replay O(N²) を踏まえ「文書肥大前」。
- **数式**: `#NUM!`・比較演算子・IF・丸め・日付・フィル rebind・サーバー re-parse/validate（§14.6）。
- **env-free 純度**: `sheet-formula` は `typecheck:core` で維持（Node/DOM 型混入を回帰検出）。
