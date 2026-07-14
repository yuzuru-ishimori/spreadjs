# DD-016-2: 独立consumer実証・統合後実機スモーク

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-14 | 2026-07-14 | 検討中 | 親=DD-016（案Y 2分割）。前提=DD-016-1 完了＝充足。**要確認A〜C 確定済（全て既定案・2026-07-14 ユーザー）＝Phase 0 から着手可**（実装は別セッション開始予定）。S1-3実証・CG-1/CG-6 Manual Gate・P2-1委譲受領 |

```text
Risk Class: A
Risk Triggers: 公開API消費（外部I/F の実利用＝S1-3）／lifecycle 資源管理（再mount/画面遷移で resource leak）／未解除・残CGの変更トリガー例外（CG-1 統合後スモーク・CG-6 精密確定＝コード変更の有無に関わらず必須）
Human Spec Gate: 解決済（親DD-016 要確認②③④確定＋本DD 要確認A〜C を 2026-07-14 ユーザー確定〔全て既定案: A=(a) 全 package pack・B=リポジトリ内 consumer-app/・C=Phase 3 完了報告時に日程打診〕＝Phase 0 から着手可）
Codex: 不要で確定（実証・計測が主。要確認A=(a) 採用＝Facade packaging 変更なし＝再判定トリガー不発。実装中に差分の性質が変わった場合のみ再判定〔§2.2 L3〕）
Manual Gate: 要（CG-1 統合後 Tier 1 実機スモーク〔Win Chrome/Edge・Microsoft IME・人手〕＋CG-6 精密メモリ〔`--enable-precise-memory-info` 付き実 Chrome・clean run〕。残CGの例外につき必須＝cg-ledger 重要注記）
External Review: 不要（Codex xhigh 代替は DD-016-1 で実施済）
Evidence Level: full（consumer 実証ログ〔pack 経路・S1-3 不合格条件検査〕・再mount leak 検証・CG-1 実機 trace/judge 結果・CG-6 計測 raw・実施環境〔OS/ブラウザ版〕を doc/DD/DD-016-2/ へ格納）
```

> アプローチ: E2E 駆動（独立 consumer の serve→mount→日本語入力→共同編集→destroy/再mount を実挙動で実証）＋Manual Gate（実機IME・実機精密メモリ）
> 親=**DD-016**（アンブレラ）。前提=**DD-016-1 完了・アーカイブ済（2026-07-14・f7420e2＋e4a41e5）＝充足・着手可能**（Facade 実 API 0.1.0-experimental・ime/selection/render 抽出・baseline 41→10・720 test/8 E2E green）。本子DDは**実証重心**（pack 統合・S1-3・CG Manual Gate・DD-012 クローズ連絡）＋**DD-016-1 Codex xhigh P2-1 の委譲受領**（consumer-harness fixture の確定API追随）。
> CG: **CG-1**（解除済=DD-012-1）の「Facade 配線後の統合後 Tier 1 実機スモーク」残の担当・期限=Facade 公開前。**CG-6**（指標 pass=DD-012-2）の精密確定の担当・期限=Alpha exit 前。**CG-4 は本DDのゲートに含めない**（実機スモークの環境情報〔OS/ブラウザ版〕は証跡へ記録し DD-017 が転記できるようにする）。

## 目的

DD-016-1 で確定した公開 Facade を**独立 consumer から pack 済み成果物経由で統合**して **S1-3 を実証**し、**consumer lifecycle 契約の実挙動**（serve→mount→日本語入力→共同編集反映→connection state/error notification 受信→destroy→再mount で leak なし）を確認する。あわせて **CG-1 統合後 Tier 1 実機スモーク**と **CG-6 精密メモリの定義的確定**を行い、cg-ledger を更新して **DD-012 アンブレラ（AC2/AC4）のクローズを親DDへ連絡**する。

## 背景・課題（親DD-016 §背景の該当分＋DD-016-1 完了の反映）

- **公開 API は確定・実装済**（DD-016-1・設計中ではない）: `grid`=`mount(target:{container}, options):GridInstance`（**sync 返却・boot 非同期**＝進捗/失敗は `GridEvent` で通知）・`GridMountOptions`（**`serverUrl` 必須**・documentId?/columnOrder?/displayName?/clientId?/onEvent?）・`GridInstance`（documentId・connectionState()・subscribe()→unsubscribe・focus()・destroy()）・`GridEvent` 5種（connection/pending/rejected/divergence/error）・`GRID_API_VERSION='0.1.0-experimental'`／`server-hono`=`serve(options?):Promise<ServerInstance>`（**async**）・`ServerInstance`（port/url/documentId/connectionCount()/stop()）・`SERVER_HONO_API_VERSION`。`apps/collaboration-server` は**削除され server-hono へ昇華済み**（`dev:integration` は `packages/server-hono`）。本DDは**この確定面を変更しない**（実物: `packages/grid/src/index.ts`・`packages/server-hono/src/index.ts`）。
- **P2-1（DD-016-1 Codex xhigh 委譲・`doc/archived/DD/DD-016-1/codex-review-result.md`）**: `consumer-harness/src/index.ts` が**削除済みの** `GRID_FACADE_STAGE`/`SERVER_HONO_FACADE_STAGE` を import し、`serverUrl` 必須化・async `serve` にも未追随 → `scripts/consumer-harness.sh`（pack→install→tsc 検査）が**現状 fail**。本DD Phase 3 で確定 API へ追随する。
- **pack closure（P1-1 の残余）**: Facade の実行時依存は `dependencies` 宣言へ修正済みだが、内部 `@nanairo-sheet/*` は **private・未 publish** → pack 経由 install には**依存 closure の解決**が必要（grid→core/types/collab/render/selection/ime・server-hono→core/server/types＝内部7＋Facade2 の最大9 tarball。内部 package 相互の実行時依存の解決を含む）。`doc/engineering-patterns.md` #4。方式=要確認A。配布戦略そのもの（private registry）は DD-017 のまま。
- **consumer-harness は雛形どまり**: DD-011 の `scripts/consumer-harness.sh` は pack 経由の型疎通＋S1-3 不合格条件の機械検査（内部 import／source path／workspace link／tarball 実体）まで。**実挙動（mount→編集→共同編集→destroy/再mount の leak なし）の実証は本子DD**（harness README 明記）。
- **残CG**: CG-1 は DD-012-1 で実機解除済だが「Facade 配線後の最終確認スモーク」が残（cg-ledger）。CG-6 は指標 pass のみで `--enable-precise-memory-info`＋clean redraw の定義的確定が残。いずれも変更トリガー例外＝本子DDで必須発火。
- **CG-6 redraw**: DD-012-2 で redraw over-budget は「render 無変更ゆえ回帰不能の計測環境アーティファクト」と判定済み。本子DDの clean run で予算内なら解除、依然 over なら**上限明示（境界化）**を判定（親 要確認④）。

## スコープ

- **対象**: consumer-harness fixture の確定API追随（**P2-1**・`consumer-harness/src/index.ts`）／**pack closure の確立**（内部 private package を含む tarball 解決＝要確認A・`scripts/consumer-harness.sh` の closure 対応）／独立 consumer プロジェクト新設（vanilla TS・`grid` 直接・pack 済み tarball 経由・置き場所=要確認B）／S1-3 不合格条件の機械検査（workspace link／source path 直参照／`@nanairo-sheet/*` 内部 package 直import／**`@nanairo-sheet/grid/test-support` import**／unpublished 依存＝0）／実挙動シナリオ（serve→mount→日本語入力〔synthetic〕→2クライアント共同編集反映→connection state/error notification 受信→destroy→再mount で resource leak なし）／CG-1 統合後 Tier 1 実機スモーク／CG-6 精密メモリ確定／cg-ledger 更新／DD-012 クローズ連絡。
- **対象外**: Facade 実 API・抽出・baseline 縮退（**DD-016-1 完了済**）／公開 API の変更（確定面 0.1.0-experimental を維持。変更が必要と判明したら停止しユーザー提示）／配布〔private registry・dist-tag〕・CHANGELOG・Quick Start・Tier 1 matrix 実測（**DD-017**）／Stage 1 移行判定・baseline 空の最終確認（**DD-018**）／`react` Facade（Stage 2）／20セッション級の CG-1 再取得（解除済ゆえ最終確認スモークのみ）。

## 決定事項（親 要確認確定を継承）

- **最初の consumer**: 実アプリ未定のため**独立 consumer プロジェクト新設**（vanilla TS・`grid` 直接＝最小経路）。取り込みは **pack 済み tarball**（private registry は DD-017）。実アプリ確定時は差し替え/追加。
- **CG-1 スモーク**: Win Chrome/Edge 実機（Microsoft IME・人手）で Facade 配線後の統合経路に対し**各ブラウザ最低3セッション**・`scripts/cg1/judge-ime-trace.mjs` 再判定 PASS（順序B＋先頭欠落0）。20セッション級は再取得しない。
- **CG-6 経路**: `--enable-precise-memory-info` 付きで実 Chrome をスクリプト起動し、Facade 配線後の統合経路で **clean run**（並行負荷なし）→ `scripts/cg-perf/` 判定器で精密メモリ＋redraw 予算を再判定。予算内なら解除、redraw が依然 over なら上限明示（境界化）。
- **公開 API は変更しない**（最新化で追加）: DD-016-1 確定面（`GRID_API_VERSION`/`SERVER_HONO_API_VERSION`＝0.1.0-experimental）を前提に実証のみ行う。API 変更が必要と判明したら停止しユーザー提示（親DD 設計転換ルール）。
- **test-support は公開契約ではない**（最新化で追加）: `@nanairo-sheet/grid/test-support` は E2E introspection 用（boundary 検査除外）。**独立 consumer が import したら S1-3 不合格**として機械検査に含める。
- **要確認A〜C 確定（2026-07-14 ユーザー・全て既定案）**: **A=(a) 内部 package も全て `npm pack`**（tarball 一式を同時 install・Facade packaging 変更なし）／**B=リポジトリ内 `consumer-app/`**（npm workspaces 非登録・boundary 検査対象外・workspace link/source path 参照禁止を機械検査で担保）／**C=Phase 3 完了報告時に CG-1 実機の日程打診**（人手必須ゆえ実施はユーザー実機時間確保後）。

## 検討内容（要確認A〜C＝2026-07-14 確定済み・経緯の記録。親 要確認②③④は再オープンしない）

- **要確認A: pack closure の方式** — (a) **内部 package も全て `npm pack`** し tarball 一式（最大9本）を consumer へ同時 install（最小変更・既定案候補）／(b) Facade に `bundledDependencies` を宣言し自己完結 tarball 化（consumer は 2 tarball のみ。ただし Facade の packaging 変更が入る＝Codex 再判定トリガー）。※private registry 配布は DD-017 のまま。→ **確定: (a)**
- **要確認B: 独立 consumer プロジェクトの置き場所** — 既定案候補: リポジトリ内 `consumer-app/`（npm workspaces 非登録・boundary 検査対象外）に置き、workspace link 禁止・source path 参照禁止を機械検査で担保（CI・将来の再実行で再現可能）。真にリポジトリ外へ置く案は独立性の見た目は強いが再現性が下がる。→ **確定: リポジトリ内 `consumer-app/`**
- **要確認C: CG-1 実機スモークの実施段取り** — 人手必須（Win Chrome/Edge・Microsoft IME・各3セッション以上）＝**ユーザーの実機時間が要る**。→ **確定: Phase 3 完了報告時に日程打診**

## 受け入れ基準

| # | 基準（操作 → 期待結果) | 検証方法 |
|---|------------------------|---------|
| 1 | 独立 consumer が **pack 済み成果物のみ**で統合され、S1-3 不合格条件（workspace link／source path 直参照／`@nanairo-sheet/*` 内部 package 直import／**`@nanairo-sheet/grid/test-support` import**／unpublished assets・開発サーバー暗黙設定依存）が機械検査で0。実挙動（serve→mount→日本語入力→共同編集反映→destroy）を確認 | Phase 3 🔬 機械検査＋実挙動シナリオ（`bash scripts/consumer-harness.sh` green 含む＝P2-1 追随・closure 対応後） |
| 2 | lifecycle 実挙動: mount→destroy→再mount を繰り返しても listener/RAF/WS/canvas/textarea が解放され resource leak しない。connection state・error notification（SessionEvent 4種の公開整形）を Facade 経由で購読/解除できる | Phase 3 再mount leak 検証 |
| 3 | **CG-1 統合後スモーク**: Facade 配線後の統合経路で Win Chrome/Edge 実機・順序B＋先頭欠落0・judge 再判定 PASS → cg-ledger の CG-1 残注記を消し込み | Phase 4 Manual Gate＋証跡 |
| 4 | **CG-6 精密確定**: `--enable-precise-memory-info` 付き実 Chrome の clean run で精密メモリ＋redraw 予算を再判定し、解除（または上限明示の境界化）を cg-ledger へ記録 | Phase 4 Manual Gate＋cg-ledger 更新 |
| 5 | 回帰なし: `npm run test`／`typecheck`／`lint`／`build`／`test:invariants`・E2E green＋`bash scripts/doc-check.sh` green。DD-012 アンブレラ残 AC（抽出・縮退・統合後スモーク）の充足を親DD-012 へ連絡しクローズ可能にする | Phase 4 🔬 一括機械検証 |

## タスク一覧

### Phase 0: 事前精査
- [ ] 📋 各Phaseのタスク精査・詳細化（AC↔検証対応・対象ファイルパス・🔬タスクの有無）
- [ ] 📐 **実装前詳細化トリガー判定**: Phase 3 → 詳細化要（新規プロジェクト・外部I/F消費）／Phase 4 → 不要
- [ ] 🧑‍⚖️ **Codexレビュー要否判定**: 既定=不要（実証・計測が主。P2-1 追随・consumer 新設は実証資産）。要確認Aで (b) bundledDependencies＝Facade packaging 変更を選んだ場合は再判定
- [ ] 😈 **Devil's Advocate調査**（独立 consumer が「fixture の言い換え」に堕ちないか〔§7 不合格条件〕／destroy 漏れ検出の実効性〔leak をテストでどう観測するか〕／CG-1 実機で順序A不発の前提が Facade 配線後も成り立つか／**pack closure が flat install の hoisting 頼みで内部 package 相互依存の宣言漏れ〔devDependencies のまま〕を隠さないか**）

### Phase 3: 独立 consumer 実証（S1-3・E2E駆動）
- [ ] **P2-1 追随（追加＝DD-016-1 Codex xhigh 委譲）**: `consumer-harness/src/index.ts` を確定 API へ更新（削除済み `GRID_FACADE_STAGE`/`SERVER_HONO_FACADE_STAGE` → `GRID_API_VERSION`/`SERVER_HONO_API_VERSION`・`serverUrl` 必須化・async `serve` の型追随）→ `bash scripts/consumer-harness.sh` green
- [ ] **pack closure 確立（追加＝P1-1 残余・要確認A の確定方式で）**: 内部 private package を含む依存 closure を tarball で解決し、`npm install <tarball群>` のみで型/module 解決 green（内部 package 相互の実行時依存が pack install で解決されることを確認・必要なら内部 package の `dependencies` 宣言を是正）。`scripts/consumer-harness.sh` を closure 対応へ拡張（engineering-patterns #4）
- [ ] 独立 consumer プロジェクト整備（vanilla TS・置き場所=要確認B・`consumer-harness/` とは別の実アプリ相当プロジェクト）: pack closure install・S1-3 不合格条件の機械検査（**test-support import 禁止を含む**・`scripts/consumer-harness.sh` の拡張 or consumer 側検査スクリプト）・最小サンプルとして整備（S1-4 の一部。Quick Start 文書は DD-017）
- [ ] 実挙動シナリオ: `server-hono` serve 起動→`grid` mount→日本語入力（synthetic）→2クライアント共同編集反映→connection state/error notification 受信→destroy→**再mount で leak なし**（AC1/AC2）
- [ ] 🔬 **機械検証**: `bash scripts/consumer-harness.sh` green（P2-1 追随・closure 対応後）＋consumer 検査スクリプト green（不合格条件0・test-support import 0）＋leak 検証テスト green（シナリオ・ログを `doc/DD/DD-016-2/` へ）
- [ ] 😈 **DA批判レビュー**（consumer が開発サーバーの暗黙設定・未公開アセットに依存していないか＝§7 不合格条件の再監査）

### Phase 4: CG-1/CG-6 統合後実機スモーク・クローズ（Manual Gate）
- [ ] **CG-1 統合後スモーク**: 実機（Win Chrome/Edge・Microsoft IME・人手・実施段取り=要確認C）で Facade 配線後の統合経路に日本語連続入力→ `scripts/cg1/judge-ime-trace.mjs` 再判定 PASS → trace/judge 結果を `doc/DD/DD-016-2/` へ・cg-ledger CG-1 行の「DD-016 統合後スモーク残」を消し込み（Playwright MCP は synthetic 補助・実IMEは人手必須＝DD-012-1 先例）
- [ ] **CG-6 精密確定**: `--enable-precise-memory-info` 付き実 Chrome の clean run（`scripts/cg-perf/` 判定器）→ 精密メモリ＋redraw 予算の再判定 → cg-ledger CG-6 を解除 or 上限明示（境界化）へ更新
- [ ] DD-012 アンブレラ残 AC（AC2/AC4）の充足を親DD-012 ログへ連絡（クローズは親DD-012 側）・密度計測を記録（人間確認時間・Codex effort/回数・ゲート待ち・findings 数・manual gate 実施内容 → ログへ。roadmap §2.4）
- [ ] 🔬 **機械検証**: `npm run test`・`typecheck`・`lint`・`build`・`test:invariants` 一括 green＋`bash scripts/doc-check.sh` green（AC5）
- [ ] 😈 **DA批判レビュー**（Evidence full 監査: consumer 実証ログ・CG-1 trace/実施環境・CG-6 raw・既知の未保証境界が証跡に欠けていないか）

## ログ

### 2026-07-14
- DD作成（親=DD-016 の案Y 2分割。親 §要確認②〜④ のユーザー確定を継承。前提=DD-016-1 完了）。番号は子DD `DD-016-2`（トップ連番 DD-017/018 は不変）。**実装は DD-016-1 完了後に着手**。

### 2026-07-14（ドラフト最新化・新規採番なし）
- **前提充足**: DD-016-1 完了・アーカイブ済（コミット f7420e2＋e4a41e5・`doc/archived/DD/DD-016-1_Facade実装・物理抽出.md`）→ 本DD**着手可能**。確定公開 API（grid: mount sync/boot 非同期・`serverUrl` 必須・GridEvent 5種・`GRID_API_VERSION='0.1.0-experimental'`／server-hono: **async** `serve`・`ServerInstance`）を §背景へ反映し、「本DDは確定面を変更しない」を §決定事項へ追加。`apps/collaboration-server` 削除→server-hono 昇華済みを確認（本文に古い前提記述は無し）。
- **P2-1 委譲受領**（DD-016-1 Codex xhigh・`doc/archived/DD/DD-016-1/codex-review-result.md`）: `consumer-harness/src/index.ts` が削除済み export（`GRID_FACADE_STAGE`/`SERVER_HONO_FACADE_STAGE`）を import・`serverUrl`/async serve 未追随で `scripts/consumer-harness.sh` が**現状 fail** → Phase 3 に「確定 API 追随」タスクを追加。あわせて **P1-1 残余＝pack closure**（内部 private・未 publish package の tarball 解決。最大9 tarball＝Facade2＋内部7）を Phase 3 タスク化（方式=要確認A・engineering-patterns #4）。
- **検査条件の明確化**: `@nanairo-sheet/grid/test-support`（E2E introspection・非公開契約）の import を **S1-3 不合格条件へ明記**（AC1・スコープ・Phase 3 検査に反映）。
- **要確認: A〜C を提示**（A: pack closure 方式〔(a) 全 pack 同時 install=既定案候補／(b) bundledDependencies=Facade packaging 変更→Codex 再判定〕／B: 独立 consumer の置き場所〔既定案候補=リポジトリ内 `consumer-app/`・workspaces 非登録・boundary 検査対象外〕／C: CG-1 実機スモークの実施段取り〔人手必須・ユーザー実機時間〕）。**親 要確認②③④の確定値は再オープンしない**。Codex 判定は既定=不要を維持（要確認A(b) 選択時のみ再判定）。
- DA批判レビュー表は雛形のまま＝本DDは未着手（検討中）のため。Phase 3/4 の 😈 タスク実施時に記録する。
- **要確認A〜C ユーザー確定（全て既定案）**: A=(a) 内部 package も全て pack（tarball 一式同時 install・Codex 再判定トリガー不発）／B=リポジトリ内 `consumer-app/`（workspaces 非登録・機械検査で独立性担保）／C=Phase 3 完了報告時に CG-1 実機日程を打診。Human Spec Gate 解決済＝**Phase 0 から着手可**。**実装は別セッションで開始予定**（本セッションは起票まで。並行作業しない＝lock 安全）。

---

## DA批判レビュー記録

### Phase N DA批判レビュー

**DA観点:** （このPhaseで最も壊れやすいポイントは何か？）

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | (具体的に記述) | 高/中/低 | (高/中: 操作→結果) | (どのDA観点で発見したか) | ✅修正済/⏭️別DD/❌不要 |
