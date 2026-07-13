# DD-014: 永続化・snapshot復元

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-13 | 2026-07-14 | 完了 | サーバー側（durable ACK・snapshot format v1・100k復旧≦1s・O(N²)回避・fail-fast）＋**子DD DD-014-1 でクライアント snapshot bootstrap・durable frontier/poisoning を実装し CG-3 解除**（AC1〜9 充足・ADR-0023 Accepted）。P2-1（行操作Θ(N²)=DD-021）・P2-3/P2-4（異常構成エッジ）は既知制約。roadmap §4/§5 |

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

（Human Spec Gate＝要確認①〜④の確定＝**全て既定案どおり**でユーザー合意）

- **① 永続化バックエンド**: interface 抽象（`OpLogStore`/`SnapshotStore`）＋Alpha はファイルベース実装のみ（append-only JSONL oplog＋snapshot ファイル・fsync）。PostgreSQL は Stage 2。
- **② durable ACK 契約**: fsync 完了後に ACK/broadcast（「ACK 受領=再起動後も失われない」）。group commit（小バッチ fsync）許容。reject/duplicate は oplog に書かず即応。
- **③ snapshot 位置づけ**: log=正本・snapshot=復元最適化物。生成 N=1,000 op ごと非同期・保持 K=2 世代・log 切詰めなし。persisted snapshot は operationLog 非埋め込み（write amplification 回避）。
- **④ 100k 復元目標**: 再起動復旧≦5秒・tail 線形（O(N²) 非該当）・初期ロードは snapshot ベース（DD-006 の 14分経路排除）。**実測=865/660/565ms で達成**。
- 方針: ADR-0005/ADR-0015 と既存 snapshot v3 実装を土台にした**永続層の追加**であり、同期 protocol（DD-013）と描画・IME には触れない。ADR-0023（persisted format・durable ACK 契約）を新設（**Status: Proposed**。Codex xhigh レビューで検出した P1 findings＝durable frontier/poisoning/クライアント bootstrap を反映後に Accepted 確定・DD-010/012-1 先例）。永続化方式の大きな設計転換（PostgreSQL 本採用等）が必要になったら停止してユーザー提示。

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
- [x] 📋 **各Phaseのタスク精査・詳細化**（AC↔検証対応・対象ファイルパス・🔬タスクの有無を確認）
- [x] 現行資産の精査: `packages/server/src/{snapshot,room,sequencer}.ts`・`apps/collaboration-server/src/server.ts` の ACK 送出/`snapshot v3` 経路を確認し、durable 境界の挿入点・storage interface の切り口を確定（要確認①〜④のユーザー確定を反映）
- [x] 🧪 **テスト設計（Red）**: durable ACK 順序・復元一致・fault matrix（corrupt/unsupported/途中破損）・再起動復旧の境界値を自然言語シナリオ化 → `doc/DD/DD-014/scenarios.md` → 👀 ユーザー合意後にテストコード化
- [x] 📐 **実装前詳細化トリガー判定**: Phase 1・2 → **詳細化要**（新規モジュール・外部I/F〔format〕・トランザクション境界・後戻り困難なデータ形式に該当）／Phase 3・4 → 不要
- [x] 🧑‍⚖️ **Codexレビュー要否判定**: `Phase 3 → 必須・effort: xhigh（永続化アルゴリズム＋durable ACK 順序の実質変更＝データ永続化×並行処理×外部I/F の複合。§2.2 L3 該当）`。Codex 利用可確認済（2026-07-13 `--check` exit 0）
- [x] 😈 **Devil's Advocate調査**（fsync の実効性〔OS/FS バッファ〕／snapshot 生成中の書込競合／「復元一致するが ACK 前喪失を保証と誤認させる」境界の明示／DD-013/015 との境界崩れ／ファイルベース選定が Stage 2 PostgreSQL 移行を困難にしないか）

### Phase 1: operation log 永続化＋durable ACK（Red→Green→Refactor）
- [x] 📐 **実装前詳細化**（storage interface・log レコード形式・fsync/バッチ方針・ACK/broadcast 順序のデータフロー → 👀 ユーザーレビュー後にコーディング）
- [x] `packages/server/src/`（新規 `oplog-store.ts`・storage interface）: append-only operation log 永続化＋ファイル実装を TDD で作成（Red→Green→Refactor）
- [x] `apps/collaboration-server/src/server.ts`＋`packages/server/src/room.ts`: ACK 送出を durable 境界（log 書込完了）の後へ移す＝durable ACK 契約の実装。契約を `doc/DD/DD-014/durability-contract.md` に文書化
- [x] 🔬 **機械検証**: `npm run test -w @nanairo-sheet/server` green（log 書込前に ACK が出ないことを固定するテスト名を明記）
- [x] 😈 **DA批判レビュー**（「このPhaseで何が壊れるか」: ACK 遅延による既存 collab/E2E テストのタイムアウト回帰・書込失敗時の応答契約。基準: da-method.md §3.4）

### Phase 2: versioned snapshot 永続化・復元一致・再起動復旧（Red→Green→Refactor）
- [x] 📐 **実装前詳細化**（persisted snapshot format v1・checksum・生成/保持ポリシー・復旧シーケンス → 👀 ユーザーレビュー）
- [x] `packages/server/src/snapshot.ts`＋新規 `snapshot-store.ts`: persisted snapshot format v1（version・revision・checksum 封筒）と persist/load を TDD で実装。「snapshot＝復元最適化物・log＝正本」（要確認③確定値）を `doc/DD/DD-014/snapshot-format.md` に文書化
- [x] `packages/server/src/room.ts`＋`apps/collaboration-server/src/server.ts`: 起動時復旧（最新有効 snapshot 読込→tail log replay→revision 継続）と snapshot 生成トリガー（N operation ごと・非同期）を実装。復旧手順を format 文書へ記載
- [x] クライアント初期ロードの snapshot ベース化（§8 既知制約回収）: join 時に snapshot＋tail を配る既存経路を永続化後も維持し、log 全replay 経路が残っていないことをテストで固定
- [x] 🔬 **機械検証**: `npm run test -w @nanairo-sheet/server` green（snapshot+tail 復元 hash ＝全replay hash のテスト名を明記）
- [x] 😈 **DA批判レビュー**（snapshot 生成中に到着する operation の取り漏らし／古い snapshot＋新しい log の突合せ誤り／revision 連番の巻き戻り）

### Phase 3: fault matrix・100k 性能測定・不変条件常設化＋Codexレビュー
- [x] fault matrix テスト実装: unsupported version・JSON 破損・checksum 不一致・log 途中破損（torn write 模擬）・snapshot 欠落＋log 残存 の各ケースで fail-fast（黙って空文書化しない）を固定 → 結果を `doc/DD/DD-014/fault-matrix.md` へ
- [x] サーバープロセス強制終了→再起動の復旧テスト（テストハーネスから再生成・ACK 済み operation の非喪失＝AC1）
- [x] 性能測定: 100k セル相当 room で「再起動復旧時間」「初期ロードが snapshot＋tail 非依存でないこと」「tail 長 2 点以上の線形性（O(N²)回避）」を計測し生ログ・再現コマンドを `doc/DD/DD-014/` へ格納（Evidence full）
- [x] `tests/invariants/collab/`: §2.3「snapshot＋logからの復旧」行を randomized（seed 記録）で常設化
- [x] 🔬 **機械検証**: `npm run test:invariants` green＋性能測定値が要確認④確定目標内
- [x] Codexレビュー自動実行（依頼書 `doc/DD/DD-014/codex-review-request.md` 生成 → `bash scripts/codex-review.sh --request ... --out doc/DD/DD-014/codex-review-result.md --effort xhigh`・バックグラウンド実行）
- [x] Codexレビュー指摘への対応、または見送り理由をログに記録
- [x] 😈 **DA批判レビュー**（fault matrix に「通るように書いた」ケースしかないか＝破損を実注入して落ちることを確認／測定条件が実運用と乖離していないか）

### Phase 4: 再読込復元 E2E・完了確認・CG-3 解除記録
- [ ] Playwright E2E（既存ハーネス）: 編集→durable ACK→ブラウザー再読込→確定値復元（AC8）＋サーバー再起動を挟む復元シナリオを自動化。証跡を `doc/DD/DD-014/` へ 〔**未達＝要判断**: クライアント初期ロードが snapshot bootstrap 未実装で全 replay のため、AC8 は実ブラウザー E2E 未実施。Codex P1-6/P1-7〕
- [x] 🔬 **機械検証**: `npm run test`（676 pass・既知flaky ws-convergence.smoke 除く）・`typecheck`・`lint`（boundary 新規違反0）・`build`・`test:invariants` 一括 green（AC9）
- [ ] CG-3 解除証拠を `doc/plan/cg-ledger.md` へ記録（versioned snapshot・replay一致・100k 非依存・O(N²)回避・fail-fast の証拠パス一式）〔**CG-3 は進行中・未解除**（Codex P1 findings 要対応）。台帳は「進行中＋残課題」で更新済み〕
- [x] 密度計測を記録（人間確認時間・Codex effort/回数・ゲート待ち・findings数 → ログへ。roadmap §2.4）
- [x] 😈 **DA批判レビュー**（Evidence full 監査: durability契約・fault matrix・復旧手順・測定生ログ・未保証境界〔ACK前クラッシュ＝§6〕が証跡に欠けていないか）

## 既知制約（本DDで解消しない・子DD DD-014-1／後続DDへ回収・ユーザー決定 2026-07-13）

- **P2-1: 単一行 InsertRows 連発ログの Θ(N²)** — `packages/core/src/apply.ts` `nextSlot` の全 rowMeta 走査＋`rowOrder.splice` により単一行 InsertRows が N 件並ぶ構造ログの replay は Θ(N²)。**行操作は Stage 2（DD-021）**のため Alpha 対象外＝最適化しない。100k 計測は bulk insert で O(N²) 回避を実証済（snapshot 経路＝セル値中心の線形性は担保）。回収先: DD-021。
- **P2-3: recovery の documentId/revision 相互検証欠如** — 起動時 recovery が `persisted.documentId`・封筒 revision・`snapshot.currentRevision`/`document.revision` の相互一致を検査せず tail 開始位置を決める。同一 persistenceDir を別 documentId で起動すると旧文書を新 ID として公開し得る（異常構成のエッジケース）。回収先: 起動 recovery 堅牢化の後続DD（DD-015 or 運用 DD）。
- **P2-4: restoreFrom＋persistenceDir 併用の revision 不連続** — 空 persistenceDir と revision R の `restoreFrom` を同時指定すると state は採るが既存 log が oplog へ書かれず、次 accepted op が R+1 をファイル先頭へ書いて次回起動が revision 不連続で失敗し得る（異常構成のエッジケース）。回収先: 同上（明示拒否 or restoreFrom 全ログの durable bootstrap）。

## ログ

### 2026-07-14（子DD DD-014-1 で CG-3 解除・親クローズ可能）
- **CG-3 ブロッカー（Codex xhigh P1-3〜P1-7）を子DD `DD-014-1` で解消**: (1) join protocol を snapshot@R＋tail 化＝fresh join/ブラウザー再読込が `bootstrap`（document@frontier）1 通で committed@R を確立し全 operationLog を replay しない（P1-6/P1-7・§8 既知制約回収）／(2) durable frontier 読取ゲート＝未 fsync revision を join/catch-up/`/snapshot`/welcome から非観測（P1-3）／(3) snapshot barrier＝snapshot.revision ≦ durable frontier（P1-4）＋生成中蓄積分の再判定（P2-5）／(4) oplog append 失敗で room poisoning＝write 全停止・欠番0（P1-5）。
- 証拠: `doc/DD/DD-014-1/{evidence.md,scenarios.md,bootstrap-perf-raw.txt,reload-01/02-*.png,codex-review-result.md}`。実ブラウザー再読込 E2E green・bootstrap 計測（4.8ms vs 全replay 26s/20k op）。
- **残 P2-1/P2-3/P2-4 は上記「既知制約」節へ記録**（Alpha 対象外・異常構成エッジ）。**ADR-0023 は DD-014-1 の Codex xhigh 承認で Accepted 昇格**。本DD（DD-014）は **クローズ可能**（CG-3 解除は DD-014＋DD-014-1）。

### 2026-07-13
- DD作成（roadmap §4 DD-014 定義・§0 CG-3・§5 Alpha必須ライン・§6 製品境界・§8 既知制約「snapshotベース初期化」回収を前提に起票。dd-drafter）
- Codex 利用可否: **利用可**（`bash scripts/codex-review.sh --check` exit 0・codex-cli 0.144.0-alpha.4）
- Playwright MCP 確認: 本DDの再読込復元検証は既存 Playwright E2E ハーネスで自動実行予定＝MCP 非依存（利用不可なら手動キャプチャで代替）
- 前提状態: CG-2 解除済（DD-010）＝「CG-2 は DD-014 より前」充足。snapshot v3・fail-fast は実装済（インメモリのみ）。DD-013 は起票済・検討中（同期契約は DD-013 確定値に追従し本DDでは変更しない）
- **要確認①〜④を提示**（①永続化バックエンド〔既定案: interface 抽象＋Alpha はファイルベース・PostgreSQL は Stage 2〕②durable ACK 契約〔既定案: fsync 後 ACK＋小バッチ group commit 許容〕③snapshot の位置づけ・生成/保持〔既定案: log 正本・snapshot 最適化物・N=1,000・K=2 世代・切詰めなし〕④100k 復元目標〔既定案: 再起動復旧≦5秒・tail 線形〕）。Human Spec Gate: required＝確定後に Phase 1 開始。
- **実装（前エージェント・要確認①〜④は全て既定案どおりで合意）**: `packages/server/src/{oplog-store,snapshot-store,persistent-room}.ts`（＋各 `.test.ts`・`persistence-fault.test.ts`）・`apps/collaboration-server/src/server.persistence.test.ts`・`tests/invariants/collab/persistence.invariant.test.ts`・`scripts/dd014/measure-recovery.mts`。コア: `packages/core/src/apply.ts` を二相適用へリファクタ（`applyOperation`＝clone 1 回→in-place・新規 export `replayAcceptedOperations`＝clone 1 回で tail batch replay＝O(N²)回避）。配線: `apps/collaboration-server/src/server.ts`（persistenceDir 有効化）・`packages/server/src/index.ts`（re-export）。
- **100k 復旧計測（`recovery-perf-raw.txt`・AC4/AC5 サーバー側達成）**: snapshot-based recovery tail 250/500/1000 = **865/660/565ms**（全 hashMatch=true・≦5秒）。tailReplayed=tail 長のみ＝log 全長非依存。O(N²)回避: tail ×2.00 に対し時間 ×0.76/×0.86。

### 2026-07-13（仕上げ: lint/build・Codex xhigh レビュー・要判断エスカレーション）
- **lint/build/typecheck/test 確認**: 新規テストの未使用 import（4 件）を是正 → `npm run lint` green（eslint＋boundary `baselined=41 new=0`＝新規境界違反0・DD-016 委譲維持）。`npm run build` green。`npm run typecheck` green。`npm run test`＝**676 pass / 1 fail**（唯一の fail は既知flaky `ws-convergence.smoke` のタイムアウト＝58〜60s 境界・単体でも再現・persistenceDir 非使用ゆえ本DD変更と無関係・DD-015 スコープで不介入）。
- **Codexレビュー（xhigh・1回）実施**: 依頼書 `codex-review-request.md`／結果 `codex-review-result.md`。**findings 12 件（P1×7・P2×5）**。apply.ts 二相リファクタは「部分適用時の破壊・aliasing・reject 汚染」の観点では致命指摘なし（SetCells 全件検証先出し・clone 所有権明確）だが、**永続化の durable 境界とクライアント bootstrap に複数の実装ギャップ**を検出。
- **Codex findings 対応**:
  - ✅**修正（バウンデッド・store 層・自己完結）**: **P1-1**（oplog 末尾の改行なし行は内容によらず torn＝破棄＋再 append 前に最後の改行まで物理 truncate。`oplog-store.ts` readAll/ensureOpen・テスト2件追加）／**P1-2**（`FileHandle.write` の short write を許さず全バイト書き切る `writeAllBytes`＝oplog＋snapshot）／**P2-2**（初回起動で oplog 親ディレクトリを再帰作成。テスト追加）。→ 修正後 `oplog/snapshot/persistent-room/persistence-fault` 31 tests green・全体回帰なし。
  - ⏸️**要判断（既定案を超える設計判断・追加スコープ＝勝手に広げず戻す）**: **P1-6/P1-7**〔クライアント初期ロード/ブラウザー再読込が依然 log 全replay（`room.ts` handleJoin が lastAppliedRevision=0 へ全 operationLog 送出・`session.ts` は committed.revision=0 で join）＝**AC4 クライアント節・AC8 未達**。snapshot ベース join 経路＋実 Playwright ブラウザー再読込 E2E が未実装〕／**P1-3**〔durable frontier 未満の revision が join/catch-up/`/snapshot` から観測可能。読取を durable frontier までゲートする設計要〕／**P1-4**〔snapshot が durable frontier を超え得る＝再起動 fail-fast の危険。snapshot は fsync 済み最大 revision から生成する barrier 要〕／**P1-5**〔oplog append 失敗時に送信元 socket のみ切断で room 継続＝revision 欠番の危険。store/room poisoning 設計要〕。→ これらは durable frontier・poisoning・クライアント snapshot bootstrap という**新規設計判断**を要し、DD スコープ上「クライアント初期ロードの snapshot ベース化」は明記スコープだが未実装。**CG-3 解除条件（AC4/AC8）を満たさないため、CG-3 未解除・DD 未完了**として要判断で戻す。
  - 📌**要判断（P2・バウンデッド寄りだが設計/計測に波及）**: **P2-1**〔単一行 InsertRows 連発ログは `apply.ts` `nextSlot` の全 rowMeta 走査＋`rowOrder.splice` で Θ(N²)。計測は bulk insert で回避＝**AC5 の実ログ検証不足**。slot cursor 等で構造ログでも線形性を検証すべき〕／**P2-3**〔recovery で documentId・封筒 revision・`snapshot.currentRevision`/`document.revision` の相互検証なし＝別 documentId 起動で誤公開の危険〕／**P2-4**〔restoreFrom＋persistenceDir 併用時に既存 log が oplog へ書かれず revision 不連続の危険〕／**P2-5**〔snapshot 生成中に閾値超過分が再判定されず tail が N を大きく超え得る〕。
- **判定**: サーバー再起動復旧・durable ACK（fsync 後）・snapshot format v1・O(N²)回避（bulk）はサーバー側で実証。ただし **Codex xhigh（CG-3 の指定レビューゲート）が AC4（クライアント）/AC8 未達と durable 境界の複数ギャップを検出**したため、**CG-3 は解除しない・DD は完了にしない**（status=確認待ち）。残 P1（クライアント bootstrap・durable frontier・poisoning）は設計判断＋追加スコープゆえ**要判断で呼び出し元へ返す**（子DD DD-014-M もしくは本DD追加 Phase での対応を要判断）。ADR-0023 は Proposed（findings 反映後 Accepted）。
- **密度計測**（roadmap §2.4）: Codex effort=xhigh×1回・findings=12（P1×7/P2×5）・対応=3件即修正/9件要判断。ゲート待ち=Codex xhigh 実行〜3分。人間確認=要確認①〜④は起票時既定案・仕上げは合意スコープ内。
- **注記（AC 検証文書の集約）**: AC 表が参照する `durability-contract.md`/`snapshot-format.md`/`fault-matrix.md`/`scenarios.md` は個別ファイルを作らず **`doc/DD/DD-014/evidence.md`**（§2 durable ACK 契約・§4 format v1・§6 fault matrix）に集約した。

---

## DA批判レビュー記録

### Phase 3/4 DA批判レビュー（Codex xhigh レビューを一次ソースとして統合）

**DA観点:** 永続化で最も壊れやすいのは「durable と称する境界の穴」と「復元経路が測定条件だけで成立していないか」。fault matrix が「通るように書いた」ケースだけでないか、測定が実運用ログ形状と乖離していないか。

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | クライアント初期ロード/ブラウザー再読込が snapshot bootstrap せず全 operationLog を replay（AC4 クライアント節/AC8 未達） | 高 | 100k op のある room へ新規ブラウザーで接続→join が全 log を送出し client 全 replay（`room.ts` handleJoin・`session.ts` committed.revision=0） | 復元経路がサーバー測定だけで成立しクライアント経路が未実装 | ⏸️要判断（snapshot ベース join＋実 E2E） |
| 2 | 100k O(N²)回避測定が bulk InsertRows でのみ成立。単一行 InsertRows 連発の実ログは `nextSlot` 全走査＋splice で Θ(N²) | 中 | 単一行 insert を N 件 replay→時間が tail 長の二乗で増大 | 測定条件が実運用ログ形状と乖離 | ⏸️要判断（slot cursor・実ログ計測・P2-1） |
| 3 | durable と称する境界の穴: 未 fsync revision が他読取から観測可（P1-3）／snapshot が frontier 超過で再起動不能（P1-4）／append 失敗時 poisoning 未実装（P1-5） | 高 | §11 各 finding 参照 | durable ACK 契約の frontier 一貫性 | ⏸️要判断 |
| 4 | oplog 末尾の改行なし完全 JSON を復元／torn バイト未 truncate で再 append 連結 | 高 | クラッシュで改行直前まで書けた JSON が復元される／破損直後へ追記が連結 | fault matrix が parse 失敗ケースのみで、valid-JSON-無改行 torn を見落とし | ✅修正済（P1-1・テスト2件追加） |

> 注: 本DDは fault matrix に実注入テスト（`persistence-fault.test.ts`・破損を実際に書いて throw を確認）を持ち「通るように書いた」だけではないが、Codex xhigh が上記の未カバー経路（クライアント bootstrap・valid-JSON torn・実ログ Θ(N²)）を追加検出した。詳細と全 findings は ## ログ 2026-07-13 仕上げ節・evidence.md §11。
