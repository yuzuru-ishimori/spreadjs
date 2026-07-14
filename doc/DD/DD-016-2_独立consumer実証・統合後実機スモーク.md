# DD-016-2: 独立consumer実証・統合後実機スモーク

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-14 | 2026-07-14 | 進行中 | 親=DD-016（案Y 2分割）。前提=DD-016-1 完了＝充足。**Phase 0/3 完了＝S1-3 実証・pack closure・再mount leak なし green**。**Phase 4 は最小スコープで順次実施へ切替（2026-07-14・先送り撤回）**: Step 0=trace 採取ハーネス配線＋**CG-1 統合後スモーク PASS（Chrome6＋Edge3＝9 sessions・先頭欠落0・順序B・両ブラウザ・2026-07-14）＝AC3 充足・cg-ledger CG-1 消し込み済**／残=**Step 4 CG-6 精密メモリのみ**（`--enable-precise-memory-info` flag run）→AC4→DD-012 クローズ連絡→完了。P2-1委譲受領・反映済 |

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
- [x] 📋 各Phaseのタスク精査・詳細化（AC↔検証対応・対象ファイルパス・🔬タスクの有無）→ 実施済（Phase 3 の対象ファイル・検査経路を確定＝下記ログ）
- [x] 📐 **実装前詳細化トリガー判定**: Phase 3 → 詳細化要（新規プロジェクト・外部I/F消費）／Phase 4 → 不要
- [x] 🧑‍⚖️ **Codexレビュー要否判定**: **不要で確定**（要確認A=(a) 採用＝Facade packaging 変更なし＝再判定トリガー不発。実証・計測が主・公開API不変）。Codex 未実行
- [x] 😈 **Devil's Advocate調査**（4観点）→ 下記 DA記録表 Phase 0 に記入。**pack closure の宣言漏れ（devDependencies のまま）を実検出し是正**（最重要 finding）

### Phase 3: 独立 consumer 実証（S1-3・E2E駆動）
- [x] **P2-1 追随（追加＝DD-016-1 Codex xhigh 委譲）**: `consumer-harness/src/index.ts` を確定 API へ更新（`GRID_API_VERSION`/`SERVER_HONO_API_VERSION`・`serverUrl` 必須化・async `serve` の型追随）→ `bash scripts/consumer-harness.sh` green
- [x] **pack closure 確立（追加＝P1-1 残余・要確認A=(a) の方式で）**: 内部 private package を含む 9 tarball で依存 closure を解決し install のみで型/module 解決 green。**内部 package 相互の実行時依存の `dependencies` 宣言を是正**（core/collab/render/server/formula）。`scripts/consumer-harness.sh` を closure 対応へ拡張＋`scripts/consumer/check-closure.mjs`（hoisting 非依存の宣言健全性静的検査）追加（engineering-patterns #4）
- [x] 独立 consumer プロジェクト整備（vanilla TS・**リポジトリ内 `consumer-app/`**・workspaces 非登録・`consumer-harness/` とは別の実アプリ相当）: pack closure install・S1-3 不合格条件の機械検査（**test-support import 禁止・未公開依存 0・workspaces 非登録**含む・`scripts/consumer-app.sh`）・vite build 可能な最小サンプル（S1-4 の一部。Quick Start 文書は DD-017）
- [x] 実挙動シナリオ: `server-hono` serve 起動→`grid` mount→日本語入力（synthetic）→2クライアント共同編集反映（B の base canvas 変化）→connection state/error notification 受信→destroy→**再mount×5 で leak なし**（AC1/AC2・production preview 計測）
- [x] 🔬 **機械検証**: `bash scripts/consumer-harness.sh` green＋`bash scripts/consumer-app.sh` green（S1-3 不合格条件 0・test-support import 0・server lifecycle・leak 検証・E2E 全 green）。証跡を `doc/DD/DD-016-2/` へ格納
- [x] 😈 **DA批判レビュー**（§7 不合格条件の再監査）→ 下記 DA記録表 Phase 3 に記入

### Phase 4: CG-1/CG-6 統合後実機スモーク・クローズ（Manual Gate）
- [x] **CG-1 統合後スモーク**（2026-07-14 PASS）: 実機（Win Chrome/Edge・Microsoft IME・人手）で Facade 配線後の統合経路に日本語連続入力→ `scripts/cg1/judge-ime-trace.mjs` **verdict PASS**（Chrome6＋Edge3＝9 sessions・先頭欠落0・順序B・両ブラウザ）→ trace/judge 結果を `doc/DD/DD-016-2/` へ格納・cg-ledger CG-1「DD-016 統合後スモーク残」消し込み済
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

### 2026-07-14（Phase 0/3 実装＝別セッション・Opus）

**Phase 0**: 各Phase精査・詳細化（下記の対象ファイル/検査経路を確定）。**Codexレビュー＝不要で確定**（要確認A=(a)＝Facade packaging 変更なし＝再判定トリガー不発。Codex 未実行）。DA 4観点調査を実施し DA記録表 Phase 0 へ記入。**公開 API（0.1.0-experimental）は変更なし**。

**P2-1 追随**: `consumer-harness/src/index.ts` を確定 API へ更新（`mount(target,options):GridInstance` sync／`GridMountOptions.serverUrl` 必須／`serve():Promise<ServerInstance>` async／`GRID_API_VERSION`・`SERVER_HONO_API_VERSION`）→ `bash scripts/consumer-harness.sh` green。

**pack closure（要確認A=(a)）＋宣言是正（DA #4 最重要 finding）**: grid・server-hono に加え内部7（core/types/collab/render/selection/ime/server）を pack し **9 tarball を同時 install** するだけで型/module 解決 green にした（`scripts/consumer-harness.sh` を closure 対応へ拡張）。DA 調査で「内部 package 相互の実行時依存が **devDependencies** に置かれ、flat-install の hoisting で解決が"たまたま"通る＝宣言漏れが install 成功で隠れる」ことを検出。是正: `packages/{core,collab,render,server,formula}/package.json` の実行時 inter-dep を **dependencies へ移設**（core→types／collab→core・server・types／render→selection・types／server→core・types／formula→types。render の core はテスト専用ゆえ devDep 据置）。あわせて **install 成否に依存しない静的検査** `scripts/consumer/check-closure.mjs`（非テストソースの `@nanairo-sheet/*` import が dependencies に宣言済みかを検証）を新設し harness/consumer-app 両スクリプトへ組込。`packages/server-hono` の `@nanairo-sheet/collab` は **test 専用**（実行時 import は server.ts 経由で core/server/types のみ）と確認＝devDependencies 据置が正。

**独立 consumer 新設（要確認B＝`consumer-app/`）**: npm workspaces **非登録**の vanilla TS 実アプリ相当（`index.html`＋`src/main.ts`＝grid Facade 公開 API のみの consumer／`server/serve-runner.ts`・`server/check-server.ts`＝server-hono serve()／`e2e/*.spec.ts`＝Playwright）。`bash scripts/consumer-app.sh` が S1-3 を機械化: 内部 import 0／`@nanairo-sheet/*/test-support` import 0／source path 参照 0／workspace link 0（tarball 展開実体）／未公開依存 0（`file:`/`workspace:`/SDK 宣言なし）／workspaces 非登録／closure 完備・stray 0。公開面 tsc green・server-hono ServerInstance lifecycle（serve/port/url/documentId/connectionCount/health/config/stop）green・vite production build（pack closure を Rollup で bundle・57 modules）green。

**実挙動シナリオ・leak 検証**（synthetic・chromium）: `scenario.spec.ts`＝serve→2 client mount→日本語入力（synthetic composition）→**共同編集反映（B の base canvas 変化）**→connection/error イベント受信→destroy（両者 none）green。`lifecycle.spec.ts`＝mount→destroy→**再mount×5** で canvas/textarea/stage/WS/rAF/interval が解放され leak しないことを**公開 API＋外部計装のみ**（test-support 不使用）で観測、production build+preview 配信で dev artifact（HMR socket/dev interval）を排除して絶対値 0 を担保。計測を `consumer-app-leak-metrics.json` へ。DA 調査で「leak 計測が vite HMR WebSocket を誤カウント」を検出し SDK `/ws` ソケット限定＋preview 配信で是正（DA記録表 Phase 3）。

**証跡**（`doc/DD/DD-016-2/`）: `consumer-app-run.log`（実行ログ全体）・`consumer-app-leak-metrics.json`（再mount leak per-cycle 計測）・`consumer-app-scenario-bob-reflected.png`／`consumer-app-scenario-alice-input.png`（共同編集反映スクショ）。

**回帰**（全 green）: `npm run typecheck`／`lint`（0 error・boundary new=0）／`build`／`test`（720/720。初回 run で contract の tsc-emit テストが 1 件 parallel-load flake→単独/再 run で 720 green・DA記録表 Phase 3）。consumer-app は workspaces 外ゆえ `npm run test`（vitest include=packages/apps/tests）に混ざらない。

**API 変更**: **無し**（公開面 0.1.0-experimental を不変のまま実証のみ）。

**Phase 4 は未着手**（人手必須）: CG-1 統合後 Tier 1 実機スモーク（Win Chrome/Edge・Microsoft IME・各3セッション以上・`scripts/cg1/judge-ime-trace.mjs` 再判定）＋CG-6 精密メモリ（`--enable-precise-memory-info` clean run）＋cg-ledger 消し込み＋DD-012 クローズ連絡。要確認C どおり本報告で日程打診。

### 2026-07-14（Phase 4 先送り決定＝ユーザー）
- **決定: Phase 4（CG-1/CG-6 実機 Manual Gate）を先送り**。当初見積り「実機1〜2時間」は壁時計の水増しで、実際の正味人手は **CG-1 実打鍵15〜20分＋起動/judge/証跡で計30〜40分**、**CG-6 はスクリプト起動＋待機で実作業5分程度**と補正（ユーザー確認）。それでも実機時間確保が要るため、ユーザー判断で実施時期を後ろ倒し。
- **先送りの構造的整合**: cg-ledger 上の期限は **CG-1=Facade公開前（＝DD-017）／CG-6=Alpha exit 前（＝DD-018）**。DD-016-2 は Facade を公開しない（配布は DD-017）ため、今ゲートを通す締切必然性はなく、**実機ゲートを DD-017 直前の実機まとめへ寄せる**のが妥当。**完全スキップは不可**（CG-1 はハードゲート＝cg-ledger「実機省略不可」）＝時期を後ろ倒すのみ。
- **本DDの帰結**: Phase 4 未実施のため **DD-016-2 はクローズせず「保留」**。連動して **DD-012 アンブレラ（AC2/AC4）のクローズ連絡も保留**（Phase 4 完了が条件）。Phase 0/3 の成果（P2-1 追随・pack closure・consumer-app・leak 検証・内部 deps 是正）は working tree に反映済み・green（コミットは未実施）。
- **再開条件**: ユーザーの実機時間確保時、または DD-017 着手時に Phase 4（CG-1/CG-6）を実施。手順一式（`dev-start.sh --integration`→実IME連続入力→trace-panel エクスポート→`node scripts/cg1/judge-ime-trace.mjs`／`--enable-precise-memory-info` Chrome→`scripts/cg-perf/judge-perf-report.mjs`）はその時に再提示する。

### 2026-07-14（先送り撤回→最小スコープ順次実施へ切替＝ユーザー）
- **決定変更**: 上の「先送り」を撤回し、**Phase 4 を最小スコープで小さいステップに分けて順に実施**へ切替（ユーザー指示「最小限のテスト範囲に絞って順にやり直す」）。
- **重大な発見（実装エージェント Phase 4 段取り説明の誤り訂正）**: 実装報告は「統合ページ `poc-integration.html` に trace-panel が実装済み」としていたが**誤り**。DD-016-1 の apps 書き換えで統合ページは Facade consumer に一本化され、**IME trace 採取UIは存在しない**（`event-recorder` は `packages/ime` にライブラリとしてあるのみ・統合ページ非配線）。これが「実機ゲートが大仕事に見えた」一因。
- **CG-1 判定の真の最小条件を明確化**: judge（`scripts/cg1/judge-ime-trace.mjs`）の PASS は「先頭欠落0・順序B 採取・Chrome/Edge 両カバー・1セッション以上」。DD の「各3セッション」は保険であって judge の必須ではない → **最小=各ブラウザ1セッション**、judge が不安定なときだけ当該ブラウザを +1。
- **Step 0 実装（人手ゼロ・私）**: 統合ページに CG-1 trace 採取ハーネスを配線（`apps/playground/src/integration/trace-capture.ts` 新設＋`main.ts` から `?trace=1` のとき **dynamic import**）。**内部 `@nanairo-sheet/*` を import しない**（R1 維持＝boundary new=0）ため、`ime` の `createEventRecorder` は使わず DOM イベントから ImeEventTrace 互換のプレーンオブジェクトを構築（composition/input/keydown は Facade 内部 textarea から container へバブル→capture-phase 購読）。右下パネルに export/clear と実 IME 名入力を配置。
- **Step 0 検証（green）**: `typecheck`／`lint`（boundary **new=0**）／`build`（trace-capture は独立 2.63 kB chunk＝通常バンドル無影響）green。**export→judge の形式契約を synthetic 順序B payload（Chrome+Edge）で確認＝各1セッションで judge exit 0 PASS**（`node scripts/cg1/judge-ime-trace.mjs`）。実 IME イベントの中身のみ人手セッション待ち。
- **残ステップ（順次）**: Step 1=Chrome 実 IME 1 セッション（`http://localhost:5885/poc-integration.html?server=http://127.0.0.1:9499&trace=1&name=Alice` で日本語連続入力→export）→ Step 2=Edge 同 → Step 3=judge（PASS で CG-1 消し込み）→ Step 4=CG-6 flag run（`--enable-precise-memory-info`）。DD-012 クローズ連絡は Step 3/4 完了後。

### 2026-07-14（Step 1 Chrome trace 採取・ナビバグ派生）
- **Step 1（Chrome）採取・judge**: ユーザーが実 IME で Chrome 1 セッション採取（482 events・6 composition sessions）→ `doc/DD/DD-016-2/cg1-chrome-trace.json` に格納。judge = **先頭欠落0・順序B採取・orderA=0**＝Chrome 側は合格水準。overall は `bothCovered:false`（Edge 未採取）ゆえ FAIL 表示＝**Step 2 の Edge を足せば PASS**。
- **派生: 矢印キーナビの不具合を発見→別DD化**: CG-1 テスト中にユーザーが「下キーでスクロールするがカレントセルが動かない（Excel と異なる）」と報告。実機ドライブで原因特定（①クリックで textarea が focus 保持しない既存バグ ②scroll-follow 未実装）。**grid コアの挙動で consumer/Facade 契約は不変**ゆえ別DD **DD-016-3** として起票・修正・実機検証・ユーザー確認まで完了（本DDのスコープ・公開面は不変）。詳細=`DD-016-3`。
- **残**: Step 2（Edge trace）→ Step 3（judge PASS で CG-1 消し込み）→ Step 4（CG-6）。

### 2026-07-14（CG-1 統合後スモーク PASS＝AC3 充足）
- **Step 2（Edge）採取**: ユーザーが実 IME で Edge 1 セッション採取（214 events・UA に `Edg/`）→ `doc/DD/DD-016-2/cg1-edge-trace.json`。
- **Step 3 judge（Chrome+Edge）**: `scripts/cg1/judge-ime-trace.mjs` → **verdict PASS**（先頭欠落0・順序B採取・`bothCovered:true`・sessionTotal 9＝Chrome 6＋Edge 3）。結果を `doc/DD/DD-016-2/cg1-judge-result.json` へ。**AC3 充足＝CG-1 統合後 Tier 1 実機スモーク完了→cg-ledger CG-1 の「DD-016 統合後スモーク残」を消し込み（完全解除）**。
- **残=Step 4（CG-6 精密メモリ）のみ**。CG-6 完了で AC4 充足→DD-012 アンブレラ（AC2/AC4）クローズ連絡→DD-016-2 完了。

---

## DA批判レビュー記録

### Phase 0 DA批判レビュー

**DA観点:** pack closure・S1-3・destroy 検出・CG-1 前提の「見かけ green だが実は隠れている」箇所は何か？

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | **pack closure が flat-install の hoisting 頼みで宣言漏れを隠す**: 内部 package が実行時 inter-dep を **devDependencies** に置いていた（core→types／collab→core・server・types／render→selection・types／server→core・types／formula→types）。9 tarball を top-level へ同時 install すると全 package が hoist され解決が"たまたま"通るため、devDependencies のままでも install/tsc が green になり宣言漏れが露見しない（将来の bundle/部分配布＝DD-017 で破綻）。 | 高 | `packages/core/package.json` の `@nanairo-sheet/types` を devDependencies に置いたまま 9 tarball install→tsc → green になってしまう（宣言漏れを検出できない） | pack closure が hoisting 頼みで宣言漏れを隠さないか | ✅修正済（実行時 inter-dep を dependencies へ移設＋`scripts/consumer/check-closure.mjs` で install 非依存の静的検査を新設・harness/consumer-app へ組込） |
| 2 | **「fixture の言い換え」への堕落リスク**: 独立 consumer が実体は workspace 参照や内部 import だと、単なる sample の焼き直しで S1-3 を実証しない。 | 中 | — | fixture の言い換えに堕ちないか | ❌不要（設計で回避）: consumer-app は workspaces 非登録＋pack tarball 展開実体（symlink 0）＋内部 import/test-support/source path/未公開依存を機械検査で 0 に強制。実 serve+mount+編集を実行し公開 API のみで検証 |
| 3 | **destroy 漏れ検出の実効性**: leak を「テストでどう観測するか」が曖昧だと destroy 漏れをすり抜ける。 | 中 | — | destroy 漏れ検出の実効性 | ✅対応（設計）: WS(readyState)/rAF(Set)/interval(Set) を外部計装＋DOM(canvas/textarea/stage) 数を、再mount×5 サイクルで観測。destroy 漏れは残 DOM/socket・totalSockets 線形増で顕在化。metrics を JSON 証跡化 |
| 4 | **CG-1 順序A不発前提が Facade 配線後も成り立つか**は Phase 3（synthetic）では判定不能。 | 低 | — | CG-1 実機で順序A不発の前提が Facade 配線後も成り立つか | ⏭️Phase 4（実機 Manual Gate）: synthetic は「独立 consumer 経由で共同編集 write 経路が成立する」ことまで（前提の充足）。順序A/B の実 IME 判定は Phase 4 で不変前提のまま実施 |

### Phase 3 DA批判レビュー

**DA観点:** consumer が開発サーバーの暗黙設定・未公開アセット・計測ノイズに依存していないか（§7 不合格条件の再監査）。

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | **leak 計測が vite dev の HMR WebSocket / dev interval を誤カウント**: dev サーバー配信だと destroy 後も HMR socket(readyState 1) と dev interval が残り、SDK と無関係な「偽 leak」を検出＝AC2 判定が汚染される。 | 中 | dev 配信で mount→destroy→`openSockets` を数えると HMR socket 分の 1 が残り 0 にならない（実測: `ws://…5886/?token=…` rs=1） | consumer が開発サーバーの暗黙設定に依存していないか | ✅修正済: 計測を SDK の `/ws` ソケット限定＋**production build+preview 配信**（HMR socket/dev interval 不在）に切替。絶対値 0 で leak なしを担保 |
| 2 | **開発サーバー暗黙設定への依存（serverUrl 省略で dev 既定に寄る）**: consumer が接続先を暗黙既定に頼ると独立配布で壊れる。 | 中 | — | 未公開アセット/暗黙設定依存 | ❌不要（型で封じ済）: `GridMountOptions.serverUrl` 必須＝省略は型エラー。consumer-app は URL パラメータで明示注入 |
| 3 | **未公開アセット依存**: consumer が SDK 以外の未公開物（workspace/file: 依存・source path・test-support）へ依存していないか。 | 中 | — | 未公開アセットに依存していないか | ❌不要（機械検査 0）: `scripts/consumer-app.sh` が内部 import/test-support import/source path/workspace link/`file:`・`workspace:`・SDK 宣言/stray を全て 0 検査。tarball 9 本のみ |
| 4 | **contract テストの parallel-load flake**（`tests/contract/facade-surface.test.ts` が tsc emit を shell out・全 720 並列で稀に 1 件タイムアウト風失敗）。 | 低 | 稀: `npm run test` 初回で当該 1 件 fail → 単独/再 run で 720 green | 回帰の見かけ赤 | ❌不要（本DD変更起因でない）: 単独 4/4・再 run 720/720 green を確認。既存の tsc-emit テストの実行時間依存で、依存宣言変更とは無関係 |
