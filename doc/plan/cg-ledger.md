# CG解除台帳（条件付きGo 解除ゲート CG-1〜6）

> **正本**: Stage 1 SDK Alpha（Delivery Phase A）における条件付きGo 解除ゲートの**横断追跡台帳**。
> DD-007 で Phase 0 が**条件付きGo**（CG-1〜6）と判定されたことを受け、DD-018（Stage 1移行判定）まで
> **複数DDが横断参照**するため常設する（起票: DD-009 基盤判断DD・2026-07-12）。
> ゲートの定義本体は `doc/plan/phase1-dd-roadmap.md` §0（CG-1〜6 ハードゲート表）。本台帳は**各CGの現在状態と解除証拠の所在**を追跡する。

## 重要注記: 未解除CGは「変更トリガー方式」の例外（ロードマップ §2.4）

> CG は参考資料ではなく**本体のハードゲート**。**未解除のCGは変更トリガー方式の例外**＝
> 該当コードを触っていなくても、抽出・Facade化・consumer統合・DOM親変更・bundling で挙動が変わりうるため、
> **解除証拠が出るまでゲートを発火させる**（manual/measurement gate を必須にする）。
> 特に **CG-1（実機IME）は「IMEコードを触っていないので実機省略」不可**。各DDの起票者は、本台帳で未解除のCGが
> 自DDのスコープに波及しうるかを確認し、波及するなら該当ゲートを自DDのゲートに含める。

## 解除状態の語彙

| 状態 | 意味 |
|------|------|
| 未着手 | 主担当DDが未着手 |
| 進行中 | 主担当DDで解除作業中 |
| 証拠待ち | 実装は済みだが解除証拠（実機/計測/障害注入）が未取得 |
| 解除済 | 解除証拠が揃い、担当DDのAC/レビューで確認済み |
| 製品境界化 | 解除せず「対象外の明示」で扱う（CG-4/CG-6 の一部が該当しうる） |

## CG解除台帳

| CG | 内容 | 主担当DD | 解除証拠（何をもって解除とするか） | 期限 | 未解除時の扱い | 現在状態 |
|---|---|---|---|---|---|---|
| **CG-1** | 実機IME（日本語連続入力の正しさ） | DD-012-1 入力縦切りDD ＋ **最終consumer統合後（DD-016）の Tier 1 実機スモーク** | 実機 trace・**先頭欠落0＋順序B確定**（Win Chrome/Edge **両方**）。証拠採取は `event-recorder`/`trace-panel`（DD-009台帳 C 参照） | **Facade公開前** | **Alpha不可** | **解除済**（DD-012-1・2026-07-13）。実機20セッション（Chrome6＋Edge5＋Edge9・Win Chromium 150・Microsoft IME）→ `scripts/cg1/judge-ime-trace.mjs` **verdict PASS**（先頭欠落0・順序B・両ブラウザ）。証拠=`doc/DD/DD-012-1/cg1-judge-result.json`＋trace3本（`cg1-chrome-msime.json`/`cg1-edge-msime-1.json`/`cg1-edge-msime-2.json`）＋`evidence.md`。**再定義注記**: 確定Enter順序Aは現行 Tier-1（Chromium 150）で構造的に発生しない（実機0）→自動不変条件/E2E〔synthetic〕で担保し実機必須から除外。**DD-016 の統合後 Tier 1 実機スモークは残**（Facade 配線後の最終確認） |
| **CG-2** | 安定ID（index→RowId） | DD-010 安定ID・CellStore移行DD | RowId serialization・replay 整合試験 green | **永続化DD（DD-014）より前** | **Alpha不可** | **解除済**（DD-010・証拠 `doc/DD/DD-010/replay-evidence.md`〔AC1〜5〕・`perf-report.md`〔AC6〕。RowId キー slot 間接 CellStore を core（`@nanairo-sheet/core`）へ統合・round-trip/全replay/differential green。DD-014 より前に完了。ADR-0011 は **Codex レビュー（xhigh・findings 4件全対応）をもって Accepted 確定**〔ユーザー判断 2026-07-13＝ChatGPT ではなく Codex で十分〕） |
| **CG-3** | snapshot 正式形式 | DD-014 永続化・snapshot復元DD | versioned snapshot・snapshot+tail replay 一致・100k で log 全replay 非依存・O(N²)回避測定・corrupt/version fail-fast | reconnect DD（DD-015）前 | **Alpha不可** | **進行中（未解除・2026-07-13）**。**サーバー側**は達成: durable ACK 契約（fsync 後 ACK）・persisted snapshot format v1（checksum 封筒・atomic save・K=2・version/checksum fail-fast）・snapshot+tail replay hash == log 全replay hash（randomized 常設）・サーバー再起動復旧が snapshot(document@R)＋tail のみ・O(N²)回避（`replayAcceptedOperations` clone 1 回 in-place。tail 250/500/1000 で 865/660/565ms・時間 ×0.76/×0.86・≦5秒）・corrupt/torn write/version fail-fast。**未解除の残課題（Codex xhigh レビューで検出・要判断）**: ①**クライアント初期ロード/ブラウザー再読込が依然 log 全replay**（`room.ts` handleJoin が lastAppliedRevision=0 へ全 operationLog 送出＝AC4 クライアント節/AC8 未達・snapshot ベース join 未実装）②実 Playwright ブラウザー再読込 E2E 未実施（AC8）③durable frontier 未満の revision が join/catch-up/`/snapshot` から観測可能（P1-3）④snapshot が durable frontier を超え得る＝再起動 fail-fast の危険（P1-4）⑤oplog append 失敗時の room poisoning 未実装（P1-5）⑥単一行 InsertRows 連発ログは `nextSlot` 全走査で Θ(N²)（計測は bulk insert で回避・AC5 の実ログ検証不足・P2-1）。証拠（サーバー側）=`doc/DD/DD-014/recovery-perf-raw.txt`＋`doc/DD/DD-014/evidence.md`＋persistence テスト群。Codex 結果=`doc/DD/DD-014/codex-review-result.md`。ADR-0023 は **Proposed**（P1 findings 反映後に Accepted 確定） |
| **CG-4** | Tier 1 環境 | **DD-009 基盤判断（確定）＋全DD共通（実証）** | Tier 1 compatibility matrix（枠＝ADR-0015・`package-boundary.md` §6。実測記入 DD-017・合否 DD-018） | **Phase開始時に確定・exit で実証** | 対象外環境を明示（境界化で可） | **枠確定（DD-009）／実測待ち** |
| **CG-5** | reconnect 境界（D27/D34 完全再整列のデータ損失） | DD-015 reconnect/catch-up/idempotency DD | fault injection・再送・収束（障害種別ごと保証/非保証を分離） | Alpha exit 前 | **Alpha不可** | 未着手 |
| **CG-6** | 精密メモリ | **DD-012-2 性能縦切りDD（指標）＋ DD-016（精密確定）** | 精密メモリ計測（`performance.memory` 封鎖を回避＝`--enable-precise-memory-info`。実測面＝`apps/pocd-browser-bench`／pocb ハーネス・DD-009台帳 H・要確認 Q3） | Alpha exit 前 | データ上限を明示 or Alpha不可 | **証拠待ち（指標）**。主担当 DD-012-2 が計測ハーネス常設化（`scripts/cg-perf/`・`tests/invariants/perf`）＋指標計測（Playwright MCP Chrome150 run: メモリ peak **24.2MB ≪ 300MB**・リークなし slope 9.6KB/s・scroll p95 **16.8ms pass**）を実施。**精密メモリ（`--enable-precise-memory-info`）＋clean redraw の定義的解除証拠は DD-016 統合後実機スモークで確定**（redraw over-budget は render 無変更ゆえ回帰不能の計測環境アーティファクト）。証拠=`doc/DD/DD-012-2/perf-judge-result.json`・`evidence.md §8` |

## CG × 担当DD 早見

```text
CG-1 実機IME        → DD-012-1【解除済】（＋DD-016 統合後スモーク）  期限: Facade公開前   未解除: Alpha不可
CG-2 安定ID         → DD-010【解除済】                    期限: DD-014 前      未解除: Alpha不可
CG-3 snapshot形式   → DD-014【進行中・未解除】             期限: DD-015 前      未解除: Alpha不可
CG-4 Tier 1         → DD-009（確定）＋DD-017/018（実証）  期限: 開始時/exit    未解除: 対象外明示で可
CG-5 reconnect境界  → DD-015                             期限: Alpha exit前   未解除: Alpha不可
CG-6 精密メモリ     → DD-012-2（指標）＋DD-016 精密確定   期限: Alpha exit前   未解除: 上限明示 or 不可
```

## 更新運用（台帳の腐敗防止）

- **正本の一意化**: CG の**定義**（内容・解除証拠・期限）はロードマップ §0 が正本、**現在状態**は本台帳が正本。
  各DDヘッダには CG 番号のみ記す（定義を再掲しない＝二重管理を避ける）。
- 各DD完了時に、そのDDが主担当のCG行の「現在状態」を更新する（DD-009 は CG-4 の枠を確定）。
- DD-018（Stage 1移行判定）が全CG行の最終合否を判定する（事前条件の合否判定のみ・§5）。

## 参照

- ゲート定義本体: `doc/plan/phase1-dd-roadmap.md` §0
- 変更トリガー例外: 同 §2.4
- Tier 1 / compatibility matrix: `doc/adr/0015-stage1-api-maturity-and-tier1-support.md`・`doc/DD/DD-009/package-boundary.md` §6
- CG-1/CG-6 の証拠採取資産: `doc/DD/DD-009/poc-asset-ledger.md`（C・H）
</content>
