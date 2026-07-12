# DD-010: 安定ID・CellStore移行

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-13 | 2026-07-13 | 確認待ち | 実装・テスト（561 green）・Codexレビュー反映・CG-2 解除証拠まで完了。**ADR-0011 は Codex レビュー（xhigh・findings 4件全対応）をもって Accepted 確定**（ユーザー判断 2026-07-13＝ChatGPT ではなく Codex レビューで十分）。AC6 性能 baseline 解釈も同承認に含む。コミット後にアーカイブ判断 |

> アプローチ: TDD（データ構造・serialization・replay 決定性が中心で「正解」が明確・画面なし）
> 正典: `doc/plan/phase1-dd-roadmap.md` §0（CG-2）/§3/§4/§5・`doc/adr/0011-row-slot-chunked-cell-store.md`・
> DD-009 成果物（`doc/archived/DD/DD-009/poc-asset-ledger.md`・`package-boundary.md`）・CG台帳 `doc/plan/cg-ledger.md`

```text
Risk Class: A
Risk Triggers: データ表現の安定ID移行（データ消失・サイレント上書きの可能性）／serialization/migration を変更／rollback-replay・正準ハッシュへ波及
Human Spec Gate: required（Risk A。Phase 1 設計確定・テストシナリオはユーザーレビュー必須）
Codex: xhigh（データ表現＋serialization＋replay の実質変更が複合＝ロードマップ §2.2 L3 の限定条件に該当。起票指示でも明示。1回・Phase 4 一括）
Manual Gate: なし（自動試験で担保: serialization round-trip・replay 整合・property test・Node ベンチ。IME/textarea/DOM 親・Canvas 結線は不変＝実機/headed 変更トリガー非該当。ただし描画 read-through（document-view）へ波及するため、未解除 CG-1/CG-6 の実機系証拠は DD-012 の統合ゲートで再実証する〔§2.4 例外の波及確認済み〕）
External Review: 原則対象外（Phase境界・API確定・Go に非該当）。ADR-0011 の Accepted 化を本DDで行う場合のみ ADR転換に該当 → 要確認3
Evidence Level: full（Risk A・CG-2 解除証拠。§2.2 L5: A区分の圧縮＝格納場所の集約であり、seed・再現コマンド・replay 整合ログを省略しない。格納先=DD-010/ 添付）
```

## 目的

**CG-2（安定ID: index→RowId）を解除する。** ADR-0011 (A) chunked-rowslot 型 CellStore（現行 `apps/playground/src/pocb/chunk-store.ts`＝**行 index キー**）を **RowId キー**の製品 CellStore として `packages/sheet-core` の文書表現へ統合し、RowId serialization・replay 整合を自動試験で実証する。**DD-014（永続化・snapshot復元DD）より前**に完了する（snapshot 正式形式・共同編集 InsertRows/DeleteRows が本DDの安定IDに依存するため。ロードマップ §0/§5）。

## 背景・課題

- `packages/sheet-core` の SheetDocument は既に RowId キー二段 Map（§6.4 最小形）だが、大規模データ（500k 非空・§21）向けの製品 CellStore は DD-006 実測で **(A) chunked-rowslot が総合最良**（範囲走査 8ms vs Map 128〜175ms・疎メモリ 16.7MB）。その実装 `pocb/chunk-store.ts` は **index キー**のままで、ADR-0011 に既知の簡略化として「行挿入/削除は Axis 側のみ再採番し、セルデータは index 位置に留まる」と明記されている。
- index キーのまま InsertRows/DeleteRows を適用するとセルデータが行とずれる＝**サイレント上書き・データ消失経路**。この上に snapshot 正式形式（DD-014）を作ると移行が後戻り困難 → CG-2 の期限が「DD-014 より前」である理由。
- 現行 serialization（`packages/sheet-server-core/src/snapshot.ts` SnapshotData version 1）は RowId で直列化済みだが二段 Map 前提の PoC 形式。CellStore 表現を変えても round-trip・replay 整合・cross-platform hash 一致を維持する必要がある。
- DD-009 台帳の担当割当: `pocb/chunk-store.ts`＝Harden（index→RowId は DD-010・完了条件「RowId keyed・serialization・replay 整合 green」）／`sheet-core`＝Adopt（index→RowId が apply/document へ波及・「RowId keyed で不変条件スイート green・cross-platform hash 一致維持」）／`grid/cell-store.ts`＝Discard（後継成立後に不使用化確認＝DD-010）。
- 本DDは DD-011（rename・boundary lint）より前のため、**現行パッケージ名 `packages/sheet-*` のまま実装**する（論理名 `@nanairo-sheet/core` への実 rename は DD-011。境界文書 §2）。常設不変条件スイート runner も DD-011 のため、本DDのテストは通常 Vitest に置き DD-011 でスイートへ編入する。

## 検討内容

**CellStore 内部方式（要確認1・Phase 1 で確定）:**

| 案 | 概要 | 長所 | 短所 |
|---|---|---|---|
| **A: slot 間接方式（暫定推奨）** | RowMeta.slot（安定整数・§6.3）をチャンクキーに使い、chunk-store のデータ構造（チャンク×行スロット×列昇順並列配列）を流用。RowId→slot は rowMeta で解決 | 挿入/削除でセルデータ移動ゼロ（slot 不変・tombstone でも保持）・ADR-0011 の実測優位（O(可視セル) 走査・省メモリ）を維持 | slot 採番・回収の規約が新規（歯抜け slot の走査効率・compaction 要否） |
| B: RowId 直接 Map | `Map<RowId, RowSlot>` | 実装最小・二段 Map と同型 | チャンク局所性を放棄＝ADR-0011 実測優位を捨てる |
| C: 二段 Map 正本維持 | 文書正本は現行のまま。chunked store は描画専用派生に留める | 変更最小 | 台帳・ロードマップ「chunk-store の index→RowId 移行」と不整合。500k 級の文書表現性能が §2.3 予算未担保のまま DD-014 へ進む |

**SheetDocument への統合方式（Phase 1 詳細化で確定）:** cells を CellStore インターフェースで抽象化して chunked 実装へ差し替え（apply/clone/hash/validate 追従）。二段 Map はリファレンス実装としてテストへ残し、**差分試験（differential test）** で新実装との等価性を機械実証する。

**serialization 形式（要確認2）:** SnapshotData version 1 は PoC 形式で永続データが実在しないため、互換層・migration は作らず形式更新＋version 不一致 fail-fast（ADR-0015 方針）で足りる想定。snapshot の**正式** versioned 形式・durable ACK・tail replay は DD-014 スコープ（本DDは RowId serialization の整合までを担保）。

## 決定事項

（Phase 1 で確定。詳細は `doc/DD/DD-010/scenarios.md`。ユーザー合意 4 点の範囲内・新規論点なし。）

1. **CellStore 内部方式 = A案（slot 間接）で確定**。RowMeta.slot をチャンクキーに、ADR-0011 の chunked-rowslot
   構造を流用。RowId→slot は rowMeta、ColumnId→colIndex は columnOrder で解決（document.ts の純ヘルパーに集約）。
   B/C は却下（B=範囲走査 O(非空) で DD-006 劣位／C=500k 文書表現性能が予算未担保）。実装 `packages/sheet-core/src/cell-store.ts`。
2. **slot 採番規約 = 既存 `apply.nextSlot`（max+1・単調・回収なし・tombstone でも保持）を踏襲**（本DDで採番は変更せず、
   その slot をチャンクキーに用いるのみ）。歯抜けは rollback 除去時のみ・compaction は PoC 不要（hash/serialize は slot 非出力）。
3. **serialization = SnapshotData version 1→2（`SNAPSHOT_VERSION=2`）**。wire 形式 SerializedDocument は不変（RowId 直列化）。
   互換層・migration なし・version 不一致は fail-fast。加えて deserialize で slot 非負一意・セル参照解決可能性を検証し
   破損 snapshot を fail-fast（Codex[P2]）。
4. **性能非回帰 = A案維持**。DD-006 の生文字列 PoC ストア基準に対する名目超過（メモリ/走査 約2倍）は CellRecord 値モデル
   由来（既存の内在コスト）で CG-2 由来ではない。移行前の製品表現（二段 Map×CellRecord）に対しては heap -22〜31%・
   範囲走査 -33〜49% で**非回帰・改善**（`doc/DD/DD-010/perf-report.md`）。DD-006 基準線の値モデル不一致の解釈は
   **Codex レビュー（Phase 4）で確認済み**とし ADR-0011 Accepted の承認根拠に含める（ユーザー判断 2026-07-13）。
5. **現行パッケージ名 `packages/sheet-*` のまま実装**（rename・常設不変条件スイート編入は DD-011）。
6. **unknown-column を validate/apply/reject に追加**（Codex[P1]）: columnOrder 外の SetCells を構造 reject 化し
   「validateOperation===[] ⇒ applyOperation は throw しない」契約を維持（WS 切断ではなく構造化 reject にする）。

- 想定外の派生課題は子DD `DD-010-1` 形式で起票する（letter枝番禁止・ロードマップ §0）。**該当なし**。

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | setCells/insertRows/deleteRows を含む Operation 列を適用 → セル値が RowId に追従し、index ずれ・サイレント上書きが 0（tombstone 行のセルも RowId で保全） | Phase 2 unit test（シナリオ `DD-010/scenarios.md`） |
| 2 | seed 付きランダム Operation 列（3種混在・1,000件以上×複数 seed）→ 新 CellStore と二段 Map リファレンスの全セル・documentHash が完全一致 | Phase 2 property/differential test（seed・再現コマンドを DD-010/ に記録） |
| 3 | **［CG-2 証拠①］** serialize→deserialize round-trip → documentHash・構造（rowOrder/tombstone/slot/revision）一致 | Phase 3 test（`npm run test` 該当テスト名を AC対応表へ記入） |
| 4 | **［CG-2 証拠②］** 空文書から operationLog 全 replay → 復元文書と hash・構造一致・revision 連番・二重適用なし（verifySnapshotIntegrity 拡張が新表現で green） | Phase 3 test＋整合ログを DD-010/ へ格納 |
| 5 | documentHash の正準性維持 → 表現変更前後で同一文書の hash 値が不変（既存 hash 期待値テスト・cross-platform 一致テストが無修正で green） | Phase 2/3 🔬 `npm run test`（sheet-core hash） |
| 6 | 500k 非空・4分布（DD-006 と同条件）で範囲走査・load・メモリを計測 → DD-006 実測比で許容内（合格ライン＝要確認4） | Phase 4 pocd-bench 計測（§2.3 性能回帰予算: Document State 表現変更＝フル再計測発動） |
| 7 | `npm run test` / `npm run typecheck` / `npm run lint` 全 green・統合ページ（document-view read-through）の既存テスト回帰 0 | Phase 4 🔬 |
| 8 | `doc/plan/cg-ledger.md` CG-2 行 → 「解除済」＋証拠所在（DD-010/ のファイル名）に更新 | Phase 4 🔬（grep で CG-2 行の状態確認） |

## タスク一覧

### Phase 0: 事前精査
- [x] 📋 **各Phaseのタスク精査・詳細化**（AC1〜8 と検証タスクの対応・対象パス・🔬の有無を確認）
- [x] 🧪 **テスト設計（Red）**: 安定IDの不変条件・境界値（tombstone 行への setCells・削除済みアンカーへの insertRows・空行・重複 RowId 拒否・大規模 bulkLoad）を洗い出し、テストシナリオを自然言語で `doc/DD/DD-010/scenarios.md` に作成 → 👀 ユーザーレビュー合意後にテストコード化
- [x] 📐 **実装前詳細化トリガー判定**: Phase 2〜3 → **詳細化要**（3ファイル以上・データ移行・状態遷移変更・性能特性変化・後戻り困難に複合該当）／Phase 4 → 不要（計測・文書更新）
- [x] 🧑‍⚖️ **Codexレビュー要否判定**（Codex 利用可・2026-07-13 `--check` 確認済み）: Phase 2〜4 → **必須・effort: xhigh・Phase 4 で一括1回**（理由: データ表現の安定ID移行＋serialization 変更＋replay 波及の複合＝必須シグナル複合。§2.2 L3「実質変更に限定」に該当し、起票指示でも xhigh 明示）。2回目は差分の性質が変わった場合のみ
- [x] 😈 **Devil's Advocate調査**: A案 slot 採番の歯抜け・compaction コスト／differential test の網羅性錯覚（同じバグを両実装が持つ場合）／hash 正準性が内部表現に漏れていないか／DD-014 が前提にする形式を先取りしすぎ・不足しすぎのリスク

### Phase 1: 設計確定（Human Spec Gate）
- [x] 📐 **実装前詳細化**: CellStore 方式（A/B/C 比較→確定）・slot 採番/回収規約・CellStore インターフェース（`packages/sheet-core/src/` に置く型と関数シグネチャ）・SheetDocument 統合方式（apply/clone/hash/validate への波及一覧）・serialization 形式の変更点（`packages/sheet-server-core/src/snapshot.ts`）・エッジケース/テスト観点
- [x] 要確認1〜4 の判断を仰ぎ、決定を「決定事項」へ記録
- [x] 👀 **ユーザーレビュー**（Human Spec Gate: 合意後にコーディング開始）
- [x] 🔬 **機械検証**: 設計文書内の対象ファイル一覧に対し `npm run typecheck` が現状 green であることを確認（ベースライン固定）
- [x] 😈 **DA批判レビュー（このPhaseで何が壊れるか。基準: da-method.md §3.4）**

### Phase 2: RowId キー CellStore 実装（TDD）
**Red:**
- [x] 合意済み `DD-010/scenarios.md` に基づくテスト作成: `packages/sheet-core/src/cell-store.test.ts`（新規・AC1）＋差分試験 `packages/sheet-core/src/cell-store-differential.test.ts`（新規・AC2・seed 付き property test）→ 全件失敗（Red）確認
**Green:**
- [x] `packages/sheet-core/src/cell-store.ts`（新規）: `pocb/chunk-store.ts` の構造（チャンク×行スロット×列昇順並列配列・lowerBound）を流用し、キーを行 index → 確定方式（暫定: RowMeta.slot）へ差し替えた RowId キー CellStore を実装（pocb 側は demo 用に残置）
- [x] `packages/sheet-core/src/document.ts`・`apply.ts`・`hash.ts`・`validate.ts` を CellStore 抽象へ追従（cells 二段 Map の読み書き箇所を差し替え。hash の正準順序は表現非依存を維持＝AC5）
- [x] `packages/sheet-types/src/ids.ts` の RowId 採番正本を確認し、必要なら採番ヘルパー（`crypto.randomUUID` 系）を追加（台帳 A 行「DD-010（RowId 型追加）」）
- [x] テスト全件成功（Green）確認
**Refactor:**
- [x] 二段 Map リファレンスをテスト専用モジュールへ整理（本体から削除 or test-support 化は Phase 1 決定に従う）
- [x] 🔬 **機械検証**: `npm run test -w packages/sheet-core` → 全 green（新規テスト含む）／`npm run typecheck` → green
- [x] 😈 **DA批判レビュー（このPhaseで何が壊れるか。基準: da-method.md §3.4）**

### Phase 3: serialization・replay 整合（CG-2 証拠）
**Red:**
- [x] round-trip（AC3）・全 replay 整合（AC4）のテストを `packages/sheet-server-core/src/snapshot.test.ts` へ追加（InsertRows/DeleteRows/tombstone/削除済みアンカー挿入を含むログで作成）→ Red 確認
**Green:**
- [x] `packages/sheet-server-core/src/snapshot.ts` を新 CellStore 表現へ追従（SerializedDocument の RowId serialization 維持・version 更新と不一致 fail-fast は要確認2 の決定に従う）
- [x] `verifySnapshotIntegrity` を新表現で green に（hash 一致・構造一致・revision 連番・二重適用なし）
**Refactor:**
- [x] 整合試験の生ログ（hash 値・seed・再現コマンド）を `doc/DD/DD-010/replay-evidence.md` へ格納（Evidence Level: full・L5 集約）
- [x] 🔬 **機械検証**: `npm run test` → ルート一括 green（sheet-core/sheet-server-core/sheet-collaboration/sheet-formula 回帰 0）
- [x] 😈 **DA批判レビュー（このPhaseで何が壊れるか。基準: da-method.md §3.4）**

### Phase 4: 性能非回帰・統合確認・クローズ
- [x] `apps/pocd-bench` に新 CellStore を追加し 500k×4分布を再計測（DD-006 と同 seed・同条件）→ 結果を `doc/DD/DD-010/perf-report.md` へ（AC6・合格ライン=要確認4 の決定値）
- [x] `apps/playground/src/integration/document-view.ts` の read-through が新表現で無修正 or 最小修正で動くことを既存テストで確認・`apps/playground/src/grid/cell-store.ts`（Discard 対象）の不使用化を import 検索で確認（台帳 B 行）
- [x] `doc/adr/0011-row-slot-chunked-cell-store.md` へ RowId キー移行の決定を追記（Accepted 化は要確認3 の決定に従う）
- [x] `doc/plan/cg-ledger.md` CG-2 行を「解除済」＋証拠所在へ更新（AC8）
- [x] 🔬 **機械検証**: `npm run test && npm run typecheck && npm run lint` → 全 green／`grep 'CG-2' doc/plan/cg-ledger.md` → 状態=解除済
- [x] 😈 **DA批判レビュー（このPhaseで何が壊れるか。基準: da-method.md §3.4）**
- [x] Codexレビュー自動実行（依頼書 `doc/DD/DD-010/codex-review-request.md`〔背景・設計意図・CG-2 証拠の観点を明記〕→ `bash scripts/codex-review.sh --request ... --out doc/DD/DD-010/codex-review-result.md --effort xhigh`）
- [x] Codexレビュー指摘への対応、または見送り理由をログに記録
- [x] 密度計測の記録（§2.4: 人間確認時間・Codex effort/回数・finding 数・手戻り）をログへ1行

## ログ

### 2026-07-13
- DD作成（dd-drafter）。ロードマップ §5 Alpha必須ライン順の2本目（DD-009 完了済みの次）として起票
- Codex利用可否チェック: 利用可（codex-cli 0.144.0-alpha.4）。Phase 4 で必須・effort xhigh と判定（見込み・Phase 0 で確定）
- 要確認1: **CellStore 内部方式** — A案（slot 間接・暫定推奨）／B案（RowId 直接 Map）／C案（二段 Map 正本維持）。A案は ADR-0011 の実測優位と安定IDを両立するが slot 採番規約が新規。Phase 1 詳細化で比較の上ユーザー確定
- 要確認2: **既存 SnapshotData version 1 との互換** — PoC 形式で永続データ実在せずのため、互換層・migration なし＋version 不一致 fail-fast（ADR-0015）で更新してよいか（暫定: 互換不要）
- 要確認3: **ADR-0011 の Accepted 化**（DD-007 要確認4 の積み残し）を本DDで行うか。行う場合 ADR転換＝External Review（ChatGPT 手動運用）の実施要否もあわせて判断
- 要確認4: **性能非回帰の合格ライン** — DD-006 実測（範囲走査 8ms・疎 16.7MB@500k）に対する許容回帰幅（暫定案: 範囲走査 +30% 以内・メモリ +20% 以内・全分布）。超過時は方式再検討（A案→ハイブリッド）
- 依存関係: 本DD完了が **DD-014（永続化・snapshot復元）着手の前提**（CG-2 期限）。DD-011（rename・lint・不変条件スイート）は本DDの後＝現行 `packages/sheet-*` 名で実装し、本DDのテストは DD-011 で常設スイートへ編入

### 2026-07-13（実装・dd-implementer / Opus）

**仕様確認ゲート合意 4 点をそのまま反映**（A案 slot 間接・互換なし fail-fast・ADR-0011 Accepted 化は実装後の手動 ChatGPT
外部レビュー前提・性能ライン 範囲走査+30%/メモリ+20%）。Phase 1 で新規設計論点は出ず、停止なしで実装完了。

**実装（変更ファイル）:**
- 新規: `packages/sheet-core/src/cell-store.ts`（安定 slot キー CellStore・chunked-rowslot 構造流用・CellRecord 格納・
  二分探索・clone/deleteRow/forEachInRow）。
- `packages/sheet-core/src/{document,apply,hash,validate,protocol,index}.ts`: `SheetDocument.cells` を二段 Map → CellStore へ。
  RowId/ColumnId 解決を document.ts の純ヘルパー（slotOf/columnIndexOf/getCell/setCell/deleteCell/deleteRowCells/
  forEachCellInRow）へ集約。hash は slot/colIndex 走査だが出力は rowId/columnId 文字列＝正準形不変。
- `packages/sheet-server-core/src/snapshot.ts`: serialize/deserialize を CellStore へ追従。`SNAPSHOT_VERSION=2`・version
  不一致 fail-fast・deserialize で slot 非負一意/セル参照解決の破損検知。
- `packages/sheet-collaboration/src/session.ts`（applyInverseSeed）・`apps/playground/src/integration/document-view.ts`・
  `apps/collaboration-server/test/{doc-compare,convergence}.ts`・`apps/collaboration-server/src/seed-dataset.test.ts`・
  `apps/pocd-bench/src/bench-replay.ts` をヘルパー経由へ追従。
- pocd-bench 計測: `stores/chunked-rowslot-stable-store.ts`（製品 CellStore アダプタ）・`stores/map-record-store.ts`
  （移行前の二段 Map×CellRecord 基準線）を追加。

**テスト結果: `npm run test` 561 green（+25／うち新規テスト）・`npm run typecheck` green・`npm run lint` green。**

**AC 対応表:**

| AC | 検証 | 結果 |
|----|------|------|
| 1 | `packages/sheet-core/src/cell-store.test.ts`（store 単体＋文書レベル index ずれ 0） | green（12 tests） |
| 2 | `packages/sheet-core/src/cell-store-differential.test.ts`（二段 Map リファレンス差分・seed×6・各1,200 op） | green（6 tests・全 op 後 hash/全セル/構造一致） |
| 3 | `snapshot.test.ts` `[AC3]` round-trip（tombstone 行のセル保全含む） | green |
| 4 | `snapshot.test.ts` `[AC4]` 全 replay 整合＋`verifySnapshotIntegrity`・収束試験回帰 0 | green |
| 5 | `hash.test.ts`（fnv1a64 期待値・documentHash 決定論）・S-K2 round-trip・ws-convergence smoke が hash 値そのままで green | green（無修正の期待値） |
| 6 | `perf-report.md`（500k×4分布再計測）。DD-006 文字列基準に対しては超過だが**移行前の二段 Map×CellRecord に対し heap -22〜31%・走査 -33〜49% で非回帰・改善**。超過は CellRecord 値モデル由来（点4 の再検討を記録） | 条件付き合格（下記） |
| 7 | `npm run test`/`typecheck`/`lint` 全 green・document-view read-through 回帰 0 | green |
| 8 | `doc/plan/cg-ledger.md` CG-2 行 →「解除済」＋証拠所在 | 更新済 |

**AC6 の再検討（点4「超過時は方式を再検討し記録」の実施）:** DD-006 の 16.7MB/8ms 基準は**生文字列 PoC ストア**で、
製品 CellStore（§6.4 収束判定に CellRecord 必須）とは値モデルが非等価。slot キー化（CG-2 の本体）の構造コストは ≒0
（chunked-rowslot と同一構造）。名目超過は 100% CellRecord 値モデル由来（移行前の二段 Map にも内在）。**真の基準線**
（移行前の二段 Map×CellRecord＝`map-record`）に対しては CellStore がメモリ・走査とも改善＝**回帰なし**。方式は A案維持。
基準線の値モデル不一致の解釈は **Codex レビュー（Phase 4・xhigh）で確認済み**とし、ADR-0011 Accepted 化の承認根拠に含める（ユーザー判断 2026-07-13＝ChatGPT ではなく Codex レビューで十分）。

**Codex レビュー（Phase 4・xhigh・1回）:** `doc/DD/DD-010/codex-review-result.md`。findings 4 件（P1×1・P2×3）全対応:
- [P1] columnOrder 外 SetCells が setCell の raw throw で「validate===[]⇒apply 非 throw」契約を破る → **対応**: validate/
  apply/RejectCode に `unknown-column` を追加し構造化 reject 化（apply.ts/validate.ts/protocol.ts/sequencer.ts・テスト追加）。
- [P2] deserialize が重複 slot・orphan 行・columnOrder 外列を黙って受理/破棄 → **対応**: slot 非負一意・セル参照解決を
  検証し破損 snapshot を fail-fast（snapshot.ts・テスト2件追加）。
- [P2] document-view queryRange が空行も全列 getCell で O(行×列)回帰 → **対応**: slot/hasRow で空行を列走査前にスキップ。
- [P2] map-record の Rec 形状が CellRecord 入れ子と非等価で heap 比較が不正確 → **対応**: 入れ子形状へ修正し再計測
  （map-record heap 154〜174MB へ・結論はより強化）。見送り findings: なし。

**grid/cell-store.ts（Discard 対象）:** 製品 sheet-core CellStore とは無関係の playground demo（main.ts/resident-textarea.ts=
IME 旧経路）で依然参照。CG-2 の後継成立には非依存＝除去は playground クリーンアップ（別途）。本DDでは不使用化せず記録のみ。

**密度計測（§2.4）:** 人間確認時間 0（合意済み 4 点で停止なし・Human Spec Gate は事前合意で充足）／Codex effort xhigh×1 回／
finding 数 4（P1×1・P2×3）／手戻り: Codex 対応で production 4 ファイル＋テスト＋bench 再計測（設計変更なし・全て堅牢化）／
所要: 実装〜Codex 反映まで 1 セッション。

---

## DA批判レビュー記録

### 実装 DA批判レビュー（Phase 2〜4 統合・da-method.md §3.4）

**DA観点:** 安定 ID 移行で「差分試験が同じバグを両実装に持つ錯覚」「hash 正準性が内部表現に漏れる」「serialization の
取りこぼし」が最も壊れやすい。

| # | 発見した問題/改善点 | 重要度 | 再現/確認 | DA観点 | 対応 |
|---|-------------------|--------|----------|--------|------|
| 1 | differential の網羅性錯覚（両実装が同一バグ） | 高 | リファレンスを二段 Map＋独立 apply＋独立 canonical で実装（hash 素のみ共有）・各 op 後に全セル/構造も比較 | 独立実装で相殺 | 対応済（seed×6・1,200 op green） |
| 2 | hash 正準性が slot/colIndex に漏れる | 高 | canonicalSerialize は rowId/columnId 文字列出力・既存 hash 期待値テスト無修正 green | 表現非依存を維持 | 対応済（AC5） |
| 3 | tombstone 行のセルが round-trip/replay で失われる | 高 | `[AC3]` で row-2 tombstone＋セル 'two' の保全を明示 assert | slot 保持でデータ消失なし | 対応済 |
| 4 | columnOrder 外列でサイレント破損/WS 切断（Codex[P1]） | 高 | validate/apply/reject に unknown-column | fail-fast を構造化 reject へ | 対応済 |
| 5 | 破損 snapshot（重複 slot 等）で RowId エイリアス起動（Codex[P2]） | 中 | deserialize で slot 一意・参照解決を検証し throw | 復元時の破損検知 | 対応済 |
| 6 | DD-006 基準線の値モデル不一致で超過を誤解釈 | 中 | map-record（真の基準線）で非回帰を実測 | 比較の等価性 | 記録済・Codex レビューで確認済 |
