# DD-014: 永続化・snapshot復元

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-13 | 2026-07-13 | 検討中 | roadmap §4/§5 Alpha必須ライン・**CG-3担当**。DD-013の次・DD-015（reconnect）の前 |

```text
Risk Class: A
Risk Triggers: 永続化/snapshot/migration を変更（インメモリのみ→ディスク永続化・operation log 永続化・versioned snapshot format の正式確定）／データ消失の可能性（durable ACK 契約の欠陥＝ACK 済み operation の喪失・corrupt snapshot の誤読）
Human Spec Gate: required（起票後にユーザー提示。要確認①〜④の確定後に実装開始）
Codex: xhigh（永続化アルゴリズム・durable ACK 順序の実質変更＝A区分必須シグナル複合〔データ永続化×並行処理・トランザクション境界×外部I/F（snapshot/log format）〕。roadmap §2.2 L3「永続化アルゴリズムを実質変更した場合」に該当）
Manual Gate: 不要と判断＝サーバー再起動復旧は自動テストで担保可能（テストハーネスから server プロセス/Room を再生成し snapshot＋tail log から復旧→hash 一致を機械検証。ブラウザー再読込復元も既存 Playwright E2E ハーネスで自動実行）。headed 不要。IME/実機トリガー非該当
External Review: 不要（原則＝Phase境界・Stable API確定・Go/No-Go に非該当。永続化 format は将来外部契約になり得るが Alpha は Experimental 0.x・§6 トラステッド環境限定・本番バックアップ非保証。ADR 新設〔永続化バックエンド・durable ACK 契約〕は DD-010/DD-012-1 先例に倣い Codex xhigh レビューを外部レビュー代替とする。永続化方式の大きな設計転換〔例: PostgreSQL 本採用への変更〕が生じたら停止して再判定・ユーザー提示）
Evidence Level: full（A区分: durability/ACK条件・fault matrix〔corrupt/unsupported/途中破損〕・復旧手順書・O(N²)回避測定の生ログ・再現コマンド・既知の未保証境界〔ACK前クラッシュ等 §6〕を doc/DD/DD-014/ へ省略なく格納）
```

> アプローチ: TDD（durable ACK 契約・snapshot+tail replay 一致という「正解」が明確なロジック中心のため。性能測定 Phase のみ計測駆動）
> CG: **CG-3 snapshot正式形式** 担当。解除証拠=versioned snapshot・snapshot+tail replay一致・100k で log全replay非依存・O(N²)回避測定＋corrupt/unsupported version 時の fail-fast。期限=**DD-015（reconnect）前**。未解除=**Alpha不可**。
> 想定外の派生作業は子DD `DD-014-M` として起票し、トップレベル連番（DD-015〜）を崩さない（roadmap §0）。

## 目的

「同期」済みの operation を**サーバー側で durable に保存し、サーバー再起動・ブラウザー再読込後も文書を復元できる**状態を製品品質にする（roadmap §4 DD-014・計画書 §19 Phase 2 の最小）。具体的には **durable ACK の契約定義・operation log 永続化・versioned snapshot の正式形式・snapshot＋tail log からの復元一致・100k 相当で log 全replay 非依存**を実装・実証し **CG-3 を解除**する。「保存」のみを扱い「同期」を扱わない（同期＝DD-013／reconnect・catch-up・再送＝DD-015）。

## 背景・課題

- **現状は全てインメモリ**: `@nanairo-sheet/server` に `snapshot.ts`（SnapshotData **version 3**・serialize/deserialize・version 不一致 fail-fast・重複slot/孤児セル検証＝DD-010/DD-012-1 実装済）があるが、**ディスク永続化・operation log 永続化・durable ACK・再起動復旧は未実装**。サーバープロセスが落ちれば全文書が消える。
- **snapshot 必須の実測根拠**: DD-006 AC5 で replay 100k=**14分**＝log 全replay 依存の初期化は成立しない。§8 既知制約「snapshotベース初期化」（放置期限=Alpha exit前）の回収先が本DD。
- **前提充足**: CG-2 解除済（DD-010・RowIdキー CellStore・serialization/replay整合）＝「CG-2 は DD-014 より前」（§0）を満たす。ADR-0005（server-ordered operation log）・ADR-0015（version 不一致 fail-fast）が方式の正典。
- **現存コード**: `packages/server/src/{snapshot,room,sequencer}.ts`／`apps/collaboration-server/src/server.ts`（Hono＋ws・ACK 送出箇所）／`tests/invariants/collab/collab.invariant.test.ts`（§2.3「snapshot＋logからの復旧」行は本DDが実充足を担う）。
- **永続化先が未選定**: 計画書の技術スタック欄は PostgreSQL 予定だが、Alpha の信頼境界（§6: トラステッド環境限定・persistence は本番バックアップを意味しない）を踏まえると過剰になり得る。**バックエンド選定が本DDの主要設計判断**（要確認①）。

## スコープ

- **対象**: durable ACK 契約の定義と実装（ACK を返す時点・log 書込と ACK の順序）／operation log のディスク永続化／versioned snapshot format の正式確定（既存 v3 を土台に永続化メタを付与）／snapshot 生成・保持ポリシー／snapshot＋tail log からの復元一致／サーバー再起動時の復旧手順（文書化＋自動試験）／ブラウザー再読込での文書復元（初期ロードの snapshot ベース化）／corrupt・unsupported version 時の fail-fast／100k 相当での log 全replay 非依存・O(N²) 回避測定／§2.3「snapshot＋logからの復旧」不変条件の常設化。
- **対象外**: 同期・OCC・収束（**DD-013**）／reconnect・catch-up・pending 再送・fault injection の製品保証（**DD-015**・CG-5。切断系障害は扱わない）／本番バックアップ・HA・複数サーバー・tenant isolation（§6 で Stage 1 対象外）／自動 migration（version 不一致は fail-fast のみ＝ADR-0015）／Facade 公開API・独立consumer 実証（**DD-016**）／Presence・Clipboard・行操作・数式。

## 検討内容

- **要確認: ① 永続化バックエンドの選定** — 計画書は PostgreSQL 予定だが Alpha の信頼境界（§6）は本番バックアップ非保証・トラステッド環境限定。**既定案: ストレージを薄い interface（`SnapshotStore`/`OpLogStore` 相当）で抽象化し、Alpha はファイルベース実装（append-only JSONL operation log＋snapshot ファイル・fsync 制御）のみを実装。PostgreSQL adapter は Stage 2（本番運用段階）で追加**。理由: 依存追加を避け（roadmap §2.1 A区分トリガー）・L4「現在の Phase exit に必要な品質まで」に従う。PostgreSQL を今入れる場合は運用（起動前提・接続設定・migration）が Alpha 配布 DD-017 へ波及する。可否の確認要。
- **要確認: ② durable ACK 契約** — 選択肢: (a) log 書込（fsync）完了後に ACK（write-ahead・最も安全）／(b) ACK 先行＋非同期書込（速いが「ACK 済みだが未保存」窓が生じ CG-3 の趣旨に反する）／(c) group commit（バッチ fsync 後に一括 ACK・性能と安全の折衷）。**既定案: (a) を契約とし、実装として (c) の小バッチ（数ms〜数十ms 窓）を許容**（契約上は「ACK 受領＝サーバー再起動後も失われない」を保証）。broadcast は ACK と同一の durable 境界の後とする。可否の確認要。
- **要確認: ③ snapshot の位置づけ・生成タイミング・保持ポリシー** — **既定案: operation log を正本、snapshot は復元最適化物**と定義（ADR-0005 の server-ordered log と整合・replay 決定性を正とする）。生成は「前回 snapshot 以降 N operation（既定 1,000）で非同期生成」、保持は「直近 K 世代（既定 2）＋対応 tail log。それより古い log の切詰めは Alpha では行わない（正本保全優先）」。可否（特に N・K・切詰め可否）の確認要。
- **要確認: ④ 100k 復元の性能目標値** — 既定案: (i) サーバー再起動→100k セル相当 room の復旧（snapshot 読込＋tail≦N replay）**≦5秒**、(ii) 復元時間が tail 長に対し**線形**（O(N²) 非該当を tail 長 2 点以上の測定で示す）、(iii) クライアント初期ロードは snapshot ベースで log 全replay に依存しない（DD-006 の 14分経路を排除）。目標値の妥当性の確認要。
- **format 方針（起票時案）**: 既存 SnapshotData v3 を土台に、永続化封筒（snapshot version・documentId/roomId・確定 revision・整合性検証用 checksum）を付与した **persisted snapshot format v1** を定義。既存の fail-fast（version 不一致 throw・重複slot/孤児セル検証）を永続化読込経路にも適用し、corrupt（JSON 破損・checksum 不一致・途中破損）でも黙って空文書にせず fail-fast。

## 決定事項

（Human Spec Gate＝要確認①〜④の確定後に記入）

- 方針（起票時）: ADR-0005/ADR-0015 と既存 snapshot v3 実装を土台にした**永続層の追加**であり、同期 protocol（DD-013）と描画・IME には触れない。永続化方式の大きな設計転換が必要になったら停止してユーザー提示（External Review 再判定）。

## 受け入れ基準

> roadmap §4「永続化・snapshot復元DD 完了条件（CG-3）」＋§0 CG-3 解除証拠を全項目カバーする。

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | **durable ACK 定義**が文書化され、ACK 済み operation はサーバープロセス強制終了→再起動後も失われない（log 書込と ACK の順序をテストで固定） | Phase 1 TDD＋Phase 3 再起動復旧テスト。定義文書 `doc/DD/DD-014/durability-contract.md` |
| 2 | **versioned snapshot format** が定義され、serialize→persist→load→deserialize が往復一致する | Phase 2 単体テスト＋format 定義書 `doc/DD/DD-014/snapshot-format.md` |
| 3 | **snapshot＋tail log からの復元**文書 hash ＝ log 全replay の文書 hash（復元一致） | Phase 2 テスト＋Phase 3 randomized（seed 記録）。§2.3 復旧行の常設化 |
| 4 | **100k セル相当**で、サーバー再起動復旧・クライアント初期ロードが log 全replay に依存しない（snapshot＋tail のみで復元。目標値=要確認④確定値） | Phase 3 性能測定（測定生ログ `doc/DD/DD-014/`） |
| 5 | **O(N²) 回避測定**: 復元時間が tail 長に対し線形（tail 長 2 点以上で計測・グラフ/表で提示） | Phase 3 性能測定＋生ログ格納 |
| 6 | **corrupt/unsupported version の fail-fast**: version 不一致・JSON 破損・checksum 不一致・途中破損 snapshot/log の読込が黙って空文書・部分文書にならず、明示エラーで起動失敗する | Phase 3 fault matrix テスト（`doc/DD/DD-014/fault-matrix.md`） |
| 7 | **snapshot は正本か最適化物か**の定義＋**サーバー再起動時の復旧手順**が文書化され、手順どおりの自動試験が green | Phase 2 文書＋Phase 3 再起動復旧テスト |
| 8 | ブラウザー再読込で編集済み文書が復元される（durable ACK 済みの確定値が再読込後に表示される） | Phase 4 Playwright E2E（既存ハーネス） |
| 9 | 回帰なし: `npm run test`／`typecheck`／`lint`（boundary 新規違反0）／`build`／`test:invariants` green | Phase 4 🔬 一括機械検証 |

## タスク一覧

### Phase 0: 事前精査・契約設計（Red）
- [ ] 📋 **各Phaseのタスク精査・詳細化**（AC↔検証対応・対象ファイルパス・🔬タスクの有無を確認）
- [ ] 現行資産の精査: `packages/server/src/{snapshot,room,sequencer}.ts`・`apps/collaboration-server/src/server.ts` の ACK 送出/`snapshot v3` 経路を確認し、durable 境界の挿入点・storage interface の切り口を確定（要確認①〜④のユーザー確定を反映）
- [ ] 🧪 **テスト設計（Red）**: durable ACK 順序・復元一致・fault matrix（corrupt/unsupported/途中破損）・再起動復旧の境界値を自然言語シナリオ化 → `doc/DD/DD-014/scenarios.md` → 👀 ユーザー合意後にテストコード化
- [ ] 📐 **実装前詳細化トリガー判定**: Phase 1・2 → **詳細化要**（新規モジュール・外部I/F〔format〕・トランザクション境界・後戻り困難なデータ形式に該当）／Phase 3・4 → 不要
- [ ] 🧑‍⚖️ **Codexレビュー要否判定**: `Phase 3 → 必須・effort: xhigh（永続化アルゴリズム＋durable ACK 順序の実質変更＝データ永続化×並行処理×外部I/F の複合。§2.2 L3 該当）`。Codex 利用可確認済（2026-07-13 `--check` exit 0）
- [ ] 😈 **Devil's Advocate調査**（fsync の実効性〔OS/FS バッファ〕／snapshot 生成中の書込競合／「復元一致するが ACK 前喪失を保証と誤認させる」境界の明示／DD-013/015 との境界崩れ／ファイルベース選定が Stage 2 PostgreSQL 移行を困難にしないか）

### Phase 1: operation log 永続化＋durable ACK（Red→Green→Refactor）
- [ ] 📐 **実装前詳細化**（storage interface・log レコード形式・fsync/バッチ方針・ACK/broadcast 順序のデータフロー → 👀 ユーザーレビュー後にコーディング）
- [ ] `packages/server/src/`（新規 `oplog-store.ts`・storage interface）: append-only operation log 永続化＋ファイル実装を TDD で作成（Red→Green→Refactor）
- [ ] `apps/collaboration-server/src/server.ts`＋`packages/server/src/room.ts`: ACK 送出を durable 境界（log 書込完了）の後へ移す＝durable ACK 契約の実装。契約を `doc/DD/DD-014/durability-contract.md` に文書化
- [ ] 🔬 **機械検証**: `npm run test -w @nanairo-sheet/server` green（log 書込前に ACK が出ないことを固定するテスト名を明記）
- [ ] 😈 **DA批判レビュー**（「このPhaseで何が壊れるか」: ACK 遅延による既存 collab/E2E テストのタイムアウト回帰・書込失敗時の応答契約。基準: da-method.md §3.4）

### Phase 2: versioned snapshot 永続化・復元一致・再起動復旧（Red→Green→Refactor）
- [ ] 📐 **実装前詳細化**（persisted snapshot format v1・checksum・生成/保持ポリシー・復旧シーケンス → 👀 ユーザーレビュー）
- [ ] `packages/server/src/snapshot.ts`＋新規 `snapshot-store.ts`: persisted snapshot format v1（version・revision・checksum 封筒）と persist/load を TDD で実装。「snapshot＝復元最適化物・log＝正本」（要確認③確定値）を `doc/DD/DD-014/snapshot-format.md` に文書化
- [ ] `packages/server/src/room.ts`＋`apps/collaboration-server/src/server.ts`: 起動時復旧（最新有効 snapshot 読込→tail log replay→revision 継続）と snapshot 生成トリガー（N operation ごと・非同期）を実装。復旧手順を format 文書へ記載
- [ ] クライアント初期ロードの snapshot ベース化（§8 既知制約回収）: join 時に snapshot＋tail を配る既存経路を永続化後も維持し、log 全replay 経路が残っていないことをテストで固定
- [ ] 🔬 **機械検証**: `npm run test -w @nanairo-sheet/server` green（snapshot+tail 復元 hash ＝全replay hash のテスト名を明記）
- [ ] 😈 **DA批判レビュー**（snapshot 生成中に到着する operation の取り漏らし／古い snapshot＋新しい log の突合せ誤り／revision 連番の巻き戻り）

### Phase 3: fault matrix・100k 性能測定・不変条件常設化＋Codexレビュー
- [ ] fault matrix テスト実装: unsupported version・JSON 破損・checksum 不一致・log 途中破損（torn write 模擬）・snapshot 欠落＋log 残存 の各ケースで fail-fast（黙って空文書化しない）を固定 → 結果を `doc/DD/DD-014/fault-matrix.md` へ
- [ ] サーバープロセス強制終了→再起動の復旧テスト（テストハーネスから再生成・ACK 済み operation の非喪失＝AC1）
- [ ] 性能測定: 100k セル相当 room で「再起動復旧時間」「初期ロードが snapshot＋tail 非依存でないこと」「tail 長 2 点以上の線形性（O(N²)回避）」を計測し生ログ・再現コマンドを `doc/DD/DD-014/` へ格納（Evidence full）
- [ ] `tests/invariants/collab/`: §2.3「snapshot＋logからの復旧」行を randomized（seed 記録）で常設化
- [ ] 🔬 **機械検証**: `npm run test:invariants` green＋性能測定値が要確認④確定目標内
- [ ] Codexレビュー自動実行（依頼書 `doc/DD/DD-014/codex-review-request.md` 生成 → `bash scripts/codex-review.sh --request ... --out doc/DD/DD-014/codex-review-result.md --effort xhigh`・バックグラウンド実行）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録
- [ ] 😈 **DA批判レビュー**（fault matrix に「通るように書いた」ケースしかないか＝破損を実注入して落ちることを確認／測定条件が実運用と乖離していないか）

### Phase 4: 再読込復元 E2E・完了確認・CG-3 解除記録
- [ ] Playwright E2E（既存ハーネス）: 編集→durable ACK→ブラウザー再読込→確定値復元（AC8）＋サーバー再起動を挟む復元シナリオを自動化。証跡を `doc/DD/DD-014/` へ
- [ ] 🔬 **機械検証**: `npm run test`・`typecheck`・`lint`（boundary 新規違反0）・`build`・`test:invariants` 一括 green（AC9）
- [ ] CG-3 解除証拠を `doc/plan/cg-ledger.md` へ記録（versioned snapshot・replay一致・100k 非依存・O(N²)回避・fail-fast の証拠パス一式）
- [ ] 密度計測を記録（人間確認時間・Codex effort/回数・ゲート待ち・findings数 → ログへ。roadmap §2.4）
- [ ] 😈 **DA批判レビュー**（Evidence full 監査: durability契約・fault matrix・復旧手順・測定生ログ・未保証境界〔ACK前クラッシュ＝§6〕が証跡に欠けていないか）

## ログ

### 2026-07-13
- DD作成（roadmap §4 DD-014 定義・§0 CG-3・§5 Alpha必須ライン・§6 製品境界・§8 既知制約「snapshotベース初期化」回収を前提に起票。dd-drafter）
- Codex 利用可否: **利用可**（`bash scripts/codex-review.sh --check` exit 0・codex-cli 0.144.0-alpha.4）
- Playwright MCP 確認: 本DDの再読込復元検証は既存 Playwright E2E ハーネスで自動実行予定＝MCP 非依存（利用不可なら手動キャプチャで代替）
- 前提状態: CG-2 解除済（DD-010）＝「CG-2 は DD-014 より前」充足。snapshot v3・fail-fast は実装済（インメモリのみ）。DD-013 は起票済・検討中（同期契約は DD-013 確定値に追従し本DDでは変更しない）
- **要確認①〜④を提示**（①永続化バックエンド〔既定案: interface 抽象＋Alpha はファイルベース・PostgreSQL は Stage 2〕②durable ACK 契約〔既定案: fsync 後 ACK＋小バッチ group commit 許容〕③snapshot の位置づけ・生成/保持〔既定案: log 正本・snapshot 最適化物・N=1,000・K=2 世代・切詰めなし〕④100k 復元目標〔既定案: 再起動復旧≦5秒・tail 線形〕）。Human Spec Gate: required＝確定後に Phase 1 開始。

---

## DA批判レビュー記録

### Phase N DA批判レビュー

**DA観点:** （このPhaseで最も壊れやすいポイントは何か？）

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | (具体的に記述) | 高/中/低 | (高/中: 操作→結果) | (どのDA観点で発見したか) | ✅修正済/⏭️別DD/❌不要 |
