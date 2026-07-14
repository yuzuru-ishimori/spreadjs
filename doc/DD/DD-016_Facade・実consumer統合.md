# DD-016: Facade・実consumer統合

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-14 | 2026-07-14 | 進行中 | 案Y 2分割＝アンブレラ化。**DD-016-1 完了・アーカイブ済**（Facade実装・物理抽出・720 test/8 E2E・Codex xhigh 反映）／DD-016-2 残（独立consumer実証・CG-1/CG-6 Manual Gate）。要確認①〜⑤ 確定済 |

```text
Risk Class: A
Risk Triggers: 公開APIの新規固定（Experimental 0.x の consumer 契約＝外部I/F。以後の互換性基線）／IME状態機械・textarea・focus/selection・render コードの物理移設（利用者入力経路へ間接波及）／未解除・残CGの変更トリガー例外（CG-1 統合後スモーク・CG-6 精密確定＝§2.4: 抽出・Facade化・consumer統合・bundling で挙動が変わりうる）
Human Spec Gate: required（要確認①〜⑤の確定後に実装開始）
Codex: xhigh（外部I/F〔公開API固定〕×IME/selection/render 物理移設〔挙動保存が破れた場合の検出〕×lifecycle 資源管理〔resource leak〕の必須シグナル複合＝guides.md 規定の理由記録。roadmap §2.2 L3 の「実質変更」に、公開API不変条件（§2.3）の新規確定＝consumer 契約の固定が該当すると判断）
Manual Gate: 要（CG-1 統合後 Tier 1 実機スモーク〔Win Chrome/Edge・Microsoft IME・人手〕＋CG-6 精密メモリ〔`--enable-precise-memory-info` 付き実 Chrome・clean run〕。残CGの例外につきコード変更の有無に関わらず必須＝cg-ledger 重要注記）
External Review: 候補（roadmap §2.2 L2「API確定」に該当。既定案=Codex xhigh で代替〔ADR-0011/ADR-012 の先例・ChatGPT レビューは手動運用方針〕。実施要否は要確認⑤＝ユーザー判断）
Evidence Level: full（A区分: API surface snapshot・挙動保存の回帰証跡・consumer 実証ログ〔pack 経路・S1-3 不合格条件検査〕・CG-1 実機 trace/judge 結果・CG-6 計測 raw・実施環境を doc/DD/DD-016/ へ格納）
```

> アプローチ: 標準（公開API確定＋挙動保存抽出＋実機実証の複合。Phase 1 は contract test 駆動〔TDD〕・Phase 3 は E2E 駆動を併用）
> CG: **CG-1**（解除済=DD-012-1。本DDは「Facade 配線後の統合後 Tier 1 実機スモーク」残の担当・期限=Facade 公開前）／**CG-6**（証拠待ち〔指標 pass=DD-012-2〕。本DDが精密確定の担当・期限=Alpha exit 前）。**CG-4 は本DDのゲートに含めない**（枠確定済=ADR-0015・実測記入=DD-017・合否=DD-018。実機スモークの環境情報〔OS/ブラウザ版〕は証跡へ記録し DD-017 が転記できるようにする）。
> 想定外の派生作業は子DD `DD-016-M` として起票し、トップレベル連番（DD-017/018）を崩さない（roadmap §0）。
>
> **【アンブレラ】本DDは案Y 2分割でアンブレラ化した（2026-07-14・要確認①〜⑤ ユーザー確定）。実作業は子DDで行う**:
> - **DD-016-1「Facade実装・物理抽出」**（Risk A・Codex xhigh）＝公開API固定・lifecycle 公開契約・ime/selection/render 物理抽出・baseline 縮退31・apps 書換え。**先に実装**。
> - **DD-016-2「独立consumer実証・統合後実機スモーク」**（Manual Gate）＝独立 consumer 実証（S1-3）・CG-1 統合後スモーク・CG-6 精密確定・cg-ledger 更新・DD-012 クローズ連絡。**DD-016-1 完了後**。
> 以降の 目的／背景／スコープ／検討内容／受け入れ基準 は両子DDの内容を包含する（子DDが各 AC・Phase を分担）。

## 目的

Stage 1 SDK Alpha の**公開面を確定する縦切り**（roadmap §4 DD-016・S1-2/S1-3/S1-4 の一部）。①主要 Facade（`@nanairo-sheet/grid`・`@nanairo-sheet/server-hono`＝最小経路・境界文書 §5 決定2）の公開APIを **Experimental 0.x で固定**し、②縦切りDD群（DD-012-1/012-2/013/015）が委譲してきた **ime/selection/render の物理抽出＋Facade 配線＋boundary baseline 縮退**を実施し、③**独立 consumer へ pack 済み成果物経由で統合**して S1-3 を実証し、④**consumer lifecycle 公開契約**（connection state・error notification 含む）を確定し、⑤**CG-1 統合後 Tier 1 実機スモーク**と **CG-6 精密メモリの定義的確定**を行う。

## 背景・課題

- **Facade は stub のみ**: DD-011 設置の `packages/grid`・`packages/server-hono` は throw する skeleton（実 API・内部束ねなし）。実 API 化が S1-2（Facade がある）・S1-3（内部 import なしで統合）の前提。
- **物理抽出の受け皿**: DD-012-1（ime/selection）・DD-012-2（render）は「Facade 未配線のまま抽出すると apps→internal の R1 baseline が肥大する」ため抽出を本DDへ委譲した（両DDログ・ユーザー決定 2026-07-13）。baseline 41 entries 中 **31 が本DD担当**（owner=DD-016: 8・DD-012/DD-016: 23。残 10 は PoC-D throwaway=対象外）。**DD-012 アンブレラ（AC2/AC4）は本DD完了でクローズ**。
- **lifecycle 契約の素材は実装済み**: DD-015 の `ClientSession` イベント契約（`SessionEvent`: connection/pending/rejected/divergence・observer 購読）が `packages/collab/src/session.ts` に存在する。本DDは**公開API面への整形が主で新規設計は最小**（R7: 内部型を漏らさず公開型へ写像）。
- **残CG**: CG-1 は DD-012-1 で解除済だが「Facade 配線後の最終確認スモーク」が残（cg-ledger）。CG-6 は指標 pass のみで `--enable-precise-memory-info`＋clean redraw の定義的確定が残。いずれも変更トリガー例外＝本DDで必須発火。
- **consumer-harness は雛形どまり**: DD-011 の harness は pack 経由の型疎通＋S1-3 不合格条件の機械検査まで。**実挙動（mount→編集→共同編集→destroy/再mount の leak なし）の実証は本DD**（harness README 明記）。

## スコープ

- **対象**: `grid`/`server-hono` の公開API固定（export・mount/destroy・Command/Event/Options・型定義・Experimental 0.x・contract test）／consumer lifecycle 公開契約（create/mount・destroy/disconnect・event unsubscribe・document/room 指定・**connection state**・**error notification**＝SessionEvent の公開整形）／ime/selection/render の物理抽出＋apps の Facade 経由化＋baseline 縮退（担当31 entries・new=0 維持）／独立 consumer 実証（pack 済み成果物経由・S1-3 不合格条件0・最小サンプル=S1-4 の一部）／CG-1 統合後 Tier 1 実機スモーク／CG-6 精密メモリ確定。
- **対象外**: 行操作・数式（Stage 2=DD-021/022）／配布（private registry・dist-tag）・CHANGELOG・Quick Start・Tier 1 matrix 実測（**DD-017**）／Stage 1 移行判定・baseline 空の最終確認（**DD-018**）／Presence・Clipboard（Alpha後拡張）／`element`・`react` Facade（Stage 2。ただし要確認②で最初の consumer が React と確定した場合のみ `react` を本DDへ前倒し=境界文書 §5 昇格条件）／全 Facade の同時整備（§7: 最小経路に絞る）。

## 検討内容

- **要確認: ① 過積載リスクと分割方針**（roadmap はレビュー指摘「DD-016 過積載=DD-005 再発」への対策を明記）。分割シグナル（§2.2 L1）該当: 人間設計ゲート2回以上（API面レビュー・consumer選定）／Manual Gate 2種（CG-1 実機・CG-6 計測）／Codex の差分性質が2回分（抽出・配線 vs consumer実証）。比較:
  - **案X 一括1本**: 本DDの Phase 0〜4 を直列実施。ゲートは Phase 内 👀 で担保。リスク=1レビューサイクルに公開API＋大規模移設＋実機を抱え込む（DD-005 再発パターン）。
  - **案Y 2分割（推奨）**: 本DDをアンブレラ化し、**DD-016-1「Facade実装・物理抽出」**（API固定・lifecycle 契約・抽出・配線・baseline 縮退・Codex xhigh）＋**DD-016-2「独立consumer実証・統合後実機スモーク」**（pack 統合・S1-3・CG-1/CG-6 Manual Gate）へ。コード重心と実証重心でレビューサイクルが自然に分かれる。
  - **案Z 3分割**: 抽出/API固定/実証の3子。ただし「抽出のみ」の子は **new=0 と両立しない**（Facade 未配線のまま抽出すると R1 肥大=DD-012-1 が見送った理由と同一）ため抽出と配線は不可分＝実質案Yに帰着。非推奨。
- **要確認: ② 最初の consumer** — (a) 実在社内アプリへ統合／(b) 独立 consumer プロジェクト。**既定案 (b)**（実アプリ未定のため §7 の代替経路: consumer-harness とは別に、serve→mount→日本語入力→共同編集→destroy/再mount を行う**実アプリ相当の独立プロジェクト**を pack 経由で新設。実アプリ確定時は差し替え/追加）。**スタック**: 既定=vanilla TS（`grid` 直接=最小経路・`react` は Stage 2 維持）。React を選ぶ場合は `react` Facade 前倒しが必須になる（§7）。**取り込み経路**: 既定=pack 済み tarball（`scripts/consumer-harness.sh` の確立済み経路。private registry は DD-017）。
- **要確認: ③ CG-1 統合後スモークの実施範囲** — 既定案: Win Chrome/Edge 実機（Microsoft IME・人手）で Facade 配線後の統合経路に対し**各ブラウザ最低3セッション**・`scripts/cg1/judge-ime-trace.mjs` 再判定 PASS（順序B＋先頭欠落0）。解除済 CG-1 の最終確認スモークのため DD-012-1 の20セッション級は再取得しない。実施者=人手必須（実施時期の段取り確認要）。
- **要確認: ④ CG-6 精密確定の実施経路** — 既定案: `--enable-precise-memory-info` 付きで実 Chrome をスクリプト起動（MCP 既定起動では flag 不可）し、Facade 配線後の統合経路で **clean run**（並行負荷なし）→ `scripts/cg-perf/` 判定器で精密メモリ＋redraw 予算を再判定。予算内なら CG-6 解除、redraw が依然 over ならアーティファクト再調査 or データ上限明示（境界化）を判定。
- **要確認: ⑤ Experimental API の外部レビュー要否** — 公開API確定は §2.2 L2 の外部レビュー対象候補。既定案: **Codex xhigh で代替**（ADR-0011/ADR-012 の先例・ChatGPT は手動運用）。実施する場合は Phase 1 の API 面確定後にレビューパックを用意。
- **lifecycle 整形方針（起票時案）**: `GridInstance` にイベント購読面（subscribe→unsubscribe 返却）を持たせ、SessionEvent 4種を公開イベント型へ写像（内部型 `ConflictQueueEntry` 等は R7 のため素通しにせず公開型へ変換）。`destroy()` で WS 切断・listener/RAF/canvas・textarea を解放し**再mountで leak しない**ことをテスト固定。

## 決定事項

**Human Spec Gate 確定（2026-07-14・ユーザー）＝要確認①〜⑤:**
- **① 分割方針**: **案Y 2分割**（本DDをアンブレラ化）。DD-016-1（コード重心＝Facade実装・物理抽出・Codex xhigh）＋DD-016-2（実証重心＝独立consumer・CG-1/CG-6 Manual Gate）。実装は DD-016-1 から。
- **② 最初の consumer**: **独立 consumer プロジェクト新設・vanilla TS**（`grid` 直接＝最小経路）。取り込みは **pack 済み tarball 経由**（private registry は DD-017）。**React Facade は前倒ししない**（Stage 2）。
- **③ CG-1 統合後スモーク**: Win Chrome/Edge・**各3セッション以上**・`scripts/cg1/judge-ime-trace.mjs` で PASS（先頭欠落0・順序B・両ブラウザ）。20セッション級は再取得しない。
- **④ CG-6 精密確定**: `--enable-precise-memory-info` 付き実 Chrome の **clean run**＋既存判定器（`scripts/cg-perf/`）。redraw が依然 over budget なら**境界化（上限明示）**判定。
- **⑤ Experimental API 外部レビュー**: **ChatGPT 不要・Codex xhigh で代替**（ADR-0011/012 先例）。
- **方針**: 抽出は**挙動保存**（描画・IME・同期挙動を変えない・既存テスト/E2E/不変条件 green 維持＝CG-1/CG-5 解除証拠を無効化しない）。公開APIは skeleton の signature を出発点に**最初の consumer に必要な最小面**のみ固定（§7）。設計転換（API 全面再設計・保証拡大）が必要になったら停止しユーザー提示（DD-016-1 Phase 1 の 👀 API確定ゲート）。

## 受け入れ基準

| # | 基準（操作 → 期待結果) | 検証方法 |
|---|------------------------|---------|
| 1 | `@nanairo-sheet/grid`・`@nanairo-sheet/server-hono` の公開API（export・mount/destroy・Command/Event/Options・型定義）が固定され、contract test（export surface snapshot＋R7 内部型漏洩0）green・Experimental 0.x 表明（ADR-0015 整合） | Phase 1 🔬 contract test |
| 2 | lifecycle 公開契約: mount→destroy→再mount を繰り返しても listener/RAF/WS/canvas が解放され resource leak しない。document/room 指定・connection state・error notification（SessionEvent 4種の公開整形）を Facade 経由で購読/解除できる | Phase 1 契約テスト＋Phase 3 再mount leak 検証 |
| 3 | ime/selection/render が `packages/{ime,selection,render}` へ物理抽出され**挙動保存**（既存 test・E2E・不変条件 green・`tests/invariants/ime` の import 先を package へ差し替え=DD-012-1 申し送り） | Phase 2 🔬 一括 green |
| 4 | boundary baseline: owner が DD-016／DD-012/DD-016 の全31 entries が除去され、新規違反0・残存は PoC-D throwaway（owner=none・10件）のみ | Phase 2 🔬 boundary lint |
| 5 | 独立 consumer が **pack 済み成果物のみ**で統合され、S1-3 不合格条件（workspace link／source path 直参照／`@nanairo-sheet/*` 内部 package 直import／unpublished assets・開発サーバー暗黙設定依存）が機械検査で0。実挙動（serve→mount→日本語入力→共同編集反映→destroy）を確認 | Phase 3 🔬 機械検査＋実挙動シナリオ |
| 6 | **CG-1 統合後スモーク**: Facade 配線後の統合経路で Win Chrome/Edge 実機・順序B＋先頭欠落0・judge 再判定 PASS → cg-ledger の CG-1 残注記を消し込み | Phase 4 Manual Gate＋証跡 |
| 7 | **CG-6 精密確定**: `--enable-precise-memory-info` 付き実 Chrome の clean run で精密メモリ＋redraw 予算を再判定し、解除（または上限明示の境界化）を cg-ledger へ記録 | Phase 4 Manual Gate＋cg-ledger 更新 |
| 8 | 回帰なし: `npm run test`／`typecheck`／`lint`（boundary 含む）／`build`／`test:invariants`・E2E green。DD-012 アンブレラ残 AC（抽出・縮退・統合後スモーク）の充足を親DDへ連絡しクローズ可能にする | Phase 4 🔬 一括機械検証 |

## タスク一覧（アンブレラ＝子DDが分担）

> 詳細タスク・🔬機械検証・😈DA・Codex は各子DDが保持する。本表は Phase↔子DD↔AC の対応（全体像）。上表の受け入れ基準 AC1〜8 は両子DDが分担して充足する。

| Phase | 内容 | 担当子DD | 充足 AC |
|-------|------|---------|---------|
| 1 | 公開API固定・lifecycle 契約（contract test 駆動・👀 API確定ゲート） | **DD-016-1** | AC1・AC2 |
| 2 | ime/selection/render 物理抽出・Facade 配線・baseline 縮退31・apps 書換え・Codex xhigh | **DD-016-1** | AC3・AC4・AC8(回帰) |
| 3 | 独立 consumer 実証（S1-3・pack 経由・再mount leak なし） | **DD-016-2** | AC5・AC2(実挙動) |
| 4 | CG-1 統合後実機スモーク・CG-6 精密確定・cg-ledger 更新・DD-012 クローズ連絡 | **DD-016-2** | AC6・AC7・AC8(クローズ) |

**アンブレラ完了トラッキング**:
- [x] **DD-016-1 完了**（Facade 実 API・ime/selection/render 抽出・baseline 41→10・720 test/8 E2E green・Codex xhigh 6 findings 反映）→ 2026-07-14 アーカイブ済
- [ ] **DD-016-2 完了**（S1-3 実証・CG-1/CG-6 Manual Gate・cg-ledger 更新）
- [ ] DD-012 アンブレラ（AC2/AC4）クローズ連絡・本DD完了

> Phase 0（現行資産精査・分割判断）は完了（2026-07-14）。精査結果は DD-016-1 §Phase 0 精査結果 に記録。

## ログ

### 2026-07-14
- DD作成（roadmap §4 DD-016 定義・§5 Alpha必須ライン・§7 consumer実証/lifecycle契約・cg-ledger CG-1/CG-6 残・DD-012-1/-2 の委譲決定・境界文書 `doc/archived/DD/DD-009/package-boundary.md` §5 を前提に起票。dd-drafter。**番号はロードマップ予約済み DD-016 固定＝新規採番なし**）
- Codex 利用可否: **利用可**（`bash scripts/codex-review.sh --check` exit 0・codex-cli 0.144.0-alpha.4）
- Playwright MCP: 主セッションで利用実績あり（DD-012-2 計測）。ただし **CG-1 実機は人手必須**（synthetic では実IMEを代替できない=DD-012-1 先例）・**CG-6 は flag 付き起動が必要**（MCP 既定起動では `--enable-precise-memory-info` 不可→スクリプト起動）。取得不能時は手動キャプチャで代替。
- 前提状態: DD-013/014/014-1/015 完了（CG-2/3/5 解除済）・Facade は DD-011 stub・baseline 41 entries（担当31）・consumer-harness は雛形。
- **要確認①〜⑤を提示**（①分割方針〔推奨=案Y 2分割: DD-016-1 Facade実装・物理抽出／DD-016-2 独立consumer実証・統合後実機スモーク〕②最初の consumer〔既定案=独立 consumer プロジェクト新設・vanilla TS・pack 経由〕③CG-1 スモーク範囲〔既定案=各ブラウザ3セッション以上・judge 再判定〕④CG-6 経路〔既定案=flag 付き実 Chrome clean run＋既存判定器〕⑤Experimental API 外部レビュー〔既定案=Codex xhigh 代替〕）。Human Spec Gate: required＝確定後に Phase 1 開始。
- **要確認①〜⑤ ユーザー確定＝全既定案どおり**（①案Y 2分割 ②独立consumer・vanilla TS・pack 経由・React 前倒し無し ③各3セッション以上・judge PASS ④flag 付き clean run＋境界化判定 ⑤Codex xhigh 代替）。**アンブレラ化**し子DD **DD-016-1**（Facade実装・物理抽出）・**DD-016-2**（独立consumer実証・統合後実機スモーク）を起票。Phase 0 現行資産精査を実施（Facade stub・baseline 担当31 内訳・抽出対象〔ime/selection/render の apps 資産〕・`tests/invariants/ime` import 差し替え先・consumer-harness 検査項目を確定＝DD-016-1 §Phase 0 精査結果）。**実装は DD-016-1 Phase 1〔公開API設計〕から。API確定ゲートでユーザー提示**。

---

## DA批判レビュー記録

### Phase N DA批判レビュー

**DA観点:** （このPhaseで最も壊れやすいポイントは何か？）

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | (具体的に記述) | 高/中/低 | (高/中: 操作→結果) | (どのDA観点で発見したか) | ✅修正済/⏭️別DD/❌不要 |
