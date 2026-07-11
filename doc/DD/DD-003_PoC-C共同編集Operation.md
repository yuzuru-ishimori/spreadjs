# DD-003: PoC-C共同編集Operation

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-11 | 2026-07-11 | 検討中 | 仕様ユーザー合意済み。実装着手はDD-002のコードコミット後 |

> アプローチ: TDD（決定論的適用・シーケンサー・rollback/replay＝計画書 §7/§8 に「正解」が明確なロジック中心）＋標準（WSアダプター・試験ハーネス）

## 目的

「サーバー主導の全順序Operationログ＋楽観適用rollback/replayが、切断・競合・重複を経ても収束するか」を検証するPoC-C（計画書 §18.3）。`sheet-core` / `sheet-server-core` の最小実装＋開発用WSサーバー＋ヘッドレスNodeクライアント群（3〜10体）で自動検証し、Phase 0 No-Go条件「Operation収束性」と ADR-005（サーバー主導型全順序Operationログ）・ADR-008（楽観適用＋rollback/replay）の判断材料を作る。

## 背景・課題

- 正典は計画書 `doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md` の **§18.3（PoC-C実装範囲・合格条件）**。設計根拠は §3.4（一貫性モデル）・§7（Command/Operationモデル）・§8（WebSocketプロトコル）・§9（Presence）・§10（競合解決）・Appendix A（Operation例）。`doc/plan/phase0-dd-roadmap.md` ④に対応。
- 「rollback/replayが入力遅延を恒常的に発生させる」はPhase 0のNo-Go条件（§18.6）。ADR-005/008 の決定期限は Phase 0 終了時（§4）。
- DD-001 で monorepo 基盤構築済み（`sheet-types` ブランド型・vitest ルート集約 `packages/**`+`apps/**`・tsconfig.base は DOM lib なし）。packages/* はランタイム依存ゼロ原則（ADR-022・§3.6）。
- 実装順は ②→④→③→⑤。本DDの実装は **DD-002（PoC-A）のコードがコミットされた後に開始**する（同一ツリーでの同時実装をしない。`package-lock.json` 同時更新とCodexレビュー差分の混線を避ける）。

## 検討内容

- **実装先**: `packages/sheet-core`・`packages/sheet-server-core`（§5.1 の名前に合わせる）＋ `apps/collaboration-server`（§17.1 の開発用サーバー。ランタイム依存 hono / `@hono/node-server` / ws を許すのはこのアプリのみ＝§3.6）。ヘッドレスクライアント（楽観適用・rollback/replay・再接続）は専用パッケージを新設せず、collaboration-server 内の**依存ゼロ・トランスポート注入の分離モジュール**とし、Phase 1 で `sheet-collaboration` へ昇格しやすくする。
- **検証は自動中心（ヘッドレス）**: 収束試験は in-process フォールト注入トランスポート（シード付きPRNGで重複・欠落・遅延・切断を再現可能に注入）を主とする。実WSで10,000件を回すとタイミング非決定でシード再現性が壊れるため、実WSは縮小スモークと再起動復元試験に限定する。
- **サーバー再起動の模擬**: in-memoryスナップショット＋OperationログをJSONへエクスポート/インポート可能にし、「新インスタンスを復元起動→クライアント再接続→catch-up」で検証する（DB永続化＝§16 はスコープ外）。
- **スコープ外**: 列操作・数式・スタイル・Undo・MoveRows・セル結合・認証/認可（§8.7）・大量Operation transport（§8.6）・DB永続化・ブラウザーUI（`apps/playground` には触れない＝PoC-A/Bの場所）。プロトコル契約テストは §20.3 のうち**重複・欠落・stale revision のみ**（protocolVersion不一致等は後続）。
- **ADR**: 成果を `doc/adr/` の ADR-005・ADR-008 ドラフトへ記録する（状態はProposedのまま。Go/No-Go確定はロードマップ⑥）。

## 決定事項

- **Operationは3種のみ**（§7.4/7.5・Appendix A準拠）: `SetCells`（conflictPolicy は `reject-overlap` 固定）／`InsertRows`（`afterRowId` アンカー・新RowIdはOperationに同梱）／`DeleteRows`（rowIds指定・スロットtombstone化）。Envelopeは §7.3 の Client/Server 両形式。
- **適用関数は §7.6 決定論を厳守**: 時刻・乱数・DOM・ネットワーク非参照／同一入力→同一結果／`ApplyResult`（changeSet・inverseSeed・dirtyRegions・formulaInvalidations）返却／不正Operation（削除済み行へのSetCells等）は明示エラー。ID採番は適用関数の外（クライアントCommand側の `crypto.randomUUID()`）。
- **文書ハッシュ**: 正準直列化（行順・セル内容・lastChangedRevision）＋純TSのFNV-1a 64bit（依存ゼロ・Node/ブラウザー共通。Node crypto に依存しない）。
- **サーバーは §8.4 準拠**: revision単調付与・`operationId` 冪等（重複は二重適用せず同一ACKを再返却）・`baseRevision` 検証・セル `beforeRevision` 照合（staleは `operationRejected`＋現在値/現在revision返却＝§10.2）・`clientSequence` 検査。Roomはトランスポート非依存（メッセージin/outインターフェース）。
- **クライアントは §7.7 の6手順**（pending逆順rollback→server Operation適用→own除去→残pending再検証→再適用→不成立はConflict Queueへ）。`nextExpectedRevision` で欠落検知→`requestCatchup`、期待値より小さいrevisionは重複として無視（§8.4）。再接続は §8.5（先にサーバー差分取得→未送信Operationを再検証・再送）。競合時のローカル入力は Conflict Queue にコピー可能な形で保持する（§10.1-1/6。IMEドラフト保全の完全実装はPoC-A側）。
- **Presenceは §9 の最小**: 非永続・単調 `sequence`（古い更新は破棄）・`presenceSnapshot`／`presenceDelta`／`presenceRemoved`・切断時削除。共有範囲は**3種フル**（`UserPresence` のアクティブセル・選択範囲・編集中セルを素通しする最小実装。2026-07-11 ユーザー合意）。
- **メッセージは §8.3 のPoCサブセット**（join／welcome／submitOperation／operationAck／operationRejected／operations／requestCatchup／presence系／heartbeat系）。フィールド定義・rejectコード等の詳細は `DD-003/protocol-subset.md` へ分離（50行超のため）。

### 起票時「要確認」3点の回答（2026-07-11 ユーザー合意で確定）

1. **目視デモは含めない＝ヘッドレス検証のみ**（§18.3 合格条件はヘッドレスで判定可能。2ブラウザー同期の目視はPoC-B以降または製品Phase 2で扱う）。
2. **PresenceのPoC範囲は3種フル**（アクティブセル・選択範囲・編集中セル＝§9.2 の共有3種を最小実装で素通し）。
3. **ランタイム依存の追加を承認**: `apps/collaboration-server` のみに hono / `@hono/node-server` / ws を追加（§3.6「アダプター層のみ許可」の範囲内。packages/* はゼロ依存維持）。

## 受け入れ基準

計画書 §18.3 合格条件をそのまま使う。検証は自動中心（vitest・シード付きで再現可能）。

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | 3〜10クライアントで10,000件のランダムOperation（重複・遅延・切断再接続を注入）→ 全クライアント＋サーバーの文書hash一致 | Phase 5 収束試験（in-process・シード付き）＋実WS縮小スモーク |
| 2 | 同一Operationを重複送信 → 二重適用0件・同一ACK再返却 | Phase 2 ユニット＋Phase 5 契約テスト（重複） |
| 3 | operations の revision 欠落 → 検知して requestCatchup で自動追従・hash一致 | Phase 3 ユニット＋Phase 5 契約テスト（欠落） |
| 4 | 同一セル競合（stale beforeRevision）→ サーバーreject・ローカル入力をConflict Queueへ保持（消失0件） | Phase 2/3 ユニット＋Phase 5 契約テスト（stale revision） |
| 5 | サーバー再起動（snapshot＋logから新インスタンス復元起動）→ 再接続クライアントがcatch-upで収束・hash一致 | Phase 5 復元試験（実WS） |

## タスク一覧

### Phase 0: 事前精査
- [ ] 📋 **各Phaseのタスク精査・詳細化**（受け入れ基準との対応・ファイルパス・変更内容の具体性・🔬の有無を確認）
- [ ] 📐 **実装前詳細化トリガー判定**（各Phaseごとに本文へ明記。起票時暫定: Phase 1〜4 詳細化要〔新規パッケージ・3ファイル超・並行処理/状態遷移〕、Phase 5 はハーネス中心で不要見込み）
- [ ] 🧪 **テスト設計（Red）**: §7.6/7.7・§8.4/8.5・§10.2/10.3・§18.3 合格条件からシナリオを洗い出し `doc/DD/DD-003/scenarios.md` に自然言語で作成（決定論・冪等・欠落catch-up・競合reject〔同一セルstale／削除行へのSetCells＝§10.3〕・rollback/replay境界〔own operation受信時のpending除去・reject後の残pending再適用〕・再接続・復元・Presence sequence）→ ユーザーレビュー・合意後にコード化
- [ ] `doc/DD/DD-003/protocol-subset.md`（新規）: §8.3 メッセージのPoC採用分・Envelope必須フィールド・rejectコード・初期接続/catch-up/再接続手順を定義（scenarios と同時にレビュー）
- [ ] 🧑‍⚖️ **Codexレビュー要否判定**（起票時暫定: **必須**〔TDD対象＋並行処理・複雑な状態遷移＋外部I/F=WSプロトコル〕・effort: high〔xhighトリガー非該当。PoCでデータ移行・認可変更を含まない〕。実行は Phase 5 で全差分に1回）
- [ ] 😈 **Devil's Advocate調査**（欠点・代替案・壊れやすいポイント。§7.6 決定論違反の混入経路〔Map反復順依存・Date.now・Math.random〕を重点確認）

### Phase 1: sheet-core 最小（TDD）
- [ ] 📐 **実装前詳細化**（モジュール境界・公開シグネチャ・ApplyResult/ChangeSetの形を箇条書き→ユーザーレビュー後にコーディング）
- [ ] **Red**: `packages/sheet-core/src/*.test.ts`（新規）へ scenarios の該当分（適用・逆操作seed・不正Operation・hash決定論）をコード化 → 全件失敗を確認
- [ ] `packages/sheet-core/package.json`・`tsconfig.json`（新規）: `@spreadjs/sheet-core` ワークスペース追加（DD-001規約・ランタイム依存ゼロ・`@spreadjs/sheet-types` 参照）
- [ ] `packages/sheet-core/src/document.ts`（新規）: 最小文書モデル（単一シート・行Axis＝`rowOrder`＋`RowMeta{id, slot, lastChangedRevision}`・列は固定ColumnId列・CellStoreはMap二段の最小実装。§6.2/6.3 の完全形は対象外）
- [ ] `packages/sheet-core/src/operations.ts`（新規）: SetCells／InsertRows／DeleteRows 型と Client/Server Envelope 型（§7.3〜7.5・ブランド型使用）
- [ ] `packages/sheet-core/src/apply.ts`（新規）: 決定論的適用関数（§7.6・ApplyResult返却・不正Operationは明示エラー・ID生成をしない）
- [ ] `packages/sheet-core/src/hash.ts`（新規）: 正準直列化＋FNV-1a 64bit 文書ハッシュ
- [ ] **Green→Refactor**: 最小実装で全pass→整理（テストが通り続けることを確認しながら）
- [ ] 🔬 **機械検証**: `npm run test` / `typecheck` / `lint` → green（「同一Operation列→同一hash」をシード付きランダム列でも確認）
- [ ] 😈 **DA批判レビュー**（基準: da-method.md §3.4）

### Phase 2: sheet-server-core 最小（TDD）
- [ ] 📐 **実装前詳細化**（Sequencer/Roomの責務分割・メッセージin/outインターフェース→ユーザーレビュー）
- [ ] **Red**: `packages/sheet-server-core/src/*.test.ts`（新規）へ冪等・stale reject・catch-up・スナップショット復元のシナリオをコード化 → 失敗確認
- [ ] `packages/sheet-server-core/package.json`・`tsconfig.json`（新規）: ワークスペース追加（ランタイム依存ゼロ・sheet-types／sheet-core 参照。適用関数はクライアントと共有＝§5.3）
- [ ] `packages/sheet-server-core/src/sequencer.ts`（新規）: revision単調付与・operationId冪等（既知IDは同一ACK再返却・二重適用しない）・baseRevision検証・beforeRevision照合（reject-overlap→rejectコード＋現在値/現在revision）・clientSequence検査
- [ ] `packages/sheet-server-core/src/room.ts`（新規）: 権威文書＋Operationログ保持・join処理（lastAppliedRevision以降を返却）・requestCatchup応答・Presence中継（sequence比較・切断時Removed）— トランスポート非依存
- [ ] `packages/sheet-server-core/src/snapshot.ts`（新規）: snapshot＋OperationログのJSONエクスポート/インポート（再起動模擬用）
- [ ] **Green→Refactor** ＋ 🔬 **機械検証**: `npm run test` / `typecheck` / `lint` → green
- [ ] 😈 **DA批判レビュー**（冪等キャッシュとログの整合・catch-up境界のoff-by-one）

### Phase 3: ヘッドレスクライアント（TDD・楽観適用＋rollback/replay）
- [ ] 📐 **実装前詳細化**（committed/pending二層・Conflict Queue・トランスポートIF→ユーザーレビュー）
- [ ] **Red**: `apps/collaboration-server/src/client-session/*.test.ts`（新規）へ §7.7 の6手順・重複無視・欠落→catch-up・reject→ローカル入力保持・再接続（§8.5）をコード化 → 失敗確認
- [ ] `apps/collaboration-server/package.json`・`tsconfig.json`（新規）: ワークスペース追加（この時点ではランタイム依存なし）
- [ ] `apps/collaboration-server/src/client-session/session.ts`（新規・依存ゼロ・トランスポート注入）: committed/pending二層・楽観適用＋§7.7 rollback/replay・nextExpectedRevision・requestCatchup発行・Conflict Queue（ローカル値をコピー可能に保持）・Presence送信（sequence付き）・再接続手順
- [ ] `apps/collaboration-server/src/client-session/inprocess-transport.ts`（新規）: Room直結＋シード付きフォールト注入（重複・欠落・遅延・切断）トランスポート
- [ ] **Green→Refactor** ＋ 🔬 **機械検証**: `npm run test` → 重複二重適用0・欠落自動catch-up・reject時ローカル入力保持のユニット green / `typecheck` / `lint`
- [ ] 😈 **DA批判レビュー**（own operation受信とpending除去の競合窓・catch-up応答待ち中の新着operations処理）

### Phase 4: 開発用WSサーバーアダプター（Hono + @hono/node-server + ws）
- [ ] 📐 **実装前詳細化**（HTTP/WSエンドポイント・接続ライフサイクル・後始末→ユーザーレビュー）
- [ ] `apps/collaboration-server/package.json`: hono / `@hono/node-server` / ws を dependencies へ、`@types/node`・起動用ツール（tsx等）を devDependencies へ追加（要確認3の合意後。packages/* には追加しない）
- [ ] `apps/collaboration-server/src/server.ts`（新規）: §8.2 初期接続（HTTP GET snapshot〔revision付き〕→ WS join → R+1以降を送信）＋ `protocol-subset.md` のメッセージを Room へ配線・`dev`（起動）script追加
- [ ] `apps/collaboration-server/src/client-session/ws-transport.ts`（新規）: ws を使う実WSトランスポート実装（client-session へ注入）
- [ ] 🔬 **機械検証**: `apps/collaboration-server/src/server.smoke.test.ts`（新規・vitest・ランダムポート）: サーバー起動→3クライアント接続→SetCells相互反映→全hash一致・Presence delta到達 → green
- [ ] 😈 **DA批判レビュー**（切断イベントの取りこぼし・catch-up中送信順・テスト間のポート/プロセス後始末）

### Phase 5: 収束・契約・復元試験＋ADRドラフト＋Codexレビュー
- [ ] `apps/collaboration-server/test/convergence.test.ts`(新規): **10,000件ランダムOperation収束試験** — 3〜10クライアント・SetCells/InsertRows/DeleteRows混合・シード付きPRNG・フォールト注入（重複/欠落/遅延/切断再接続）→ 全クライアント＋サーバーの文書hash一致・二重適用0件（失敗時はシードを出力し再現可能に）
- [ ] `apps/collaboration-server/test/ws-convergence.smoke.test.ts`（新規）: 実WS縮小スモーク（3クライアント×1,000件 → hash一致）
- [ ] `apps/collaboration-server/test/protocol-contract.test.ts`（新規）: §20.3 該当分 — operation重複（同一ACK・二重適用0）／revision欠落（requestCatchup発行・追従）／stale beforeRevision（operationRejected・ローカル入力保持）
- [ ] `apps/collaboration-server/test/restart-restore.test.ts`（新規）: サーバー停止→snapshot＋logエクスポートから新インスタンス復元起動→クライアント再接続→catch-up→hash一致
- [ ] `doc/adr/0005-server-ordered-operation-log.md`・`doc/adr/0008-optimistic-apply-rollback-replay.md`（新規ドラフト）: 背景・選択肢・決定・結果（本PoCの計測・観察）・再検討条件。`doc/DOC-MAP.md` へ追記
- [ ] 🔬 **機械検証**: `npm run test` / `typecheck` / `lint` / `build` → green・`bash scripts/doc-check.sh` → エラー0
- [ ] 😈 **DA批判レビュー**（フォールト注入が実際に発火しているかのメタ検証・「たまたま収束する」構造がないか・rollback/replayによる遅延の観察記録〔No-Go条件の材料〕）
- [ ] Codexレビュー自動実行（Phase 1〜5 全差分。依頼書 `DD-003/codex-review-request.md`〔目的・スコープ・§7.6/7.7/8.4/10.2 の設計意図・制約を含める〕→ `bash scripts/codex-review.sh` → `DD-003/codex-review-result.md`。effort: high）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録

## ログ

### 2026-07-11
- DD作成（`doc/plan/phase0-dd-roadmap.md` ④「PoC-C 共同編集・Operation」に対応。同ロードマップの実DD列に DD-003 を記入）
- 実装開始条件: DD-002（PoC-A）のコードコミット後（ロードマップ「順序と依存」。現在DD-002が進行中）
- Codex CLI 利用可否チェック: 利用可（codex-cli 0.144.0-alpha.4）→ Codexレビュータスクを Phase 5 末尾に配置。起票時暫定判定: 必須（TDD対象＋並行処理・複雑な状態遷移＋外部I/F）・effort high
- Playwright MCP: 画面を伴う実装Phaseなしのため対象外（要確認1で目視デモを含める決定をした場合のみ、実装Phase開始時に利用可否を確認する）
- 要確認: ブラウザー目視デモ（2ブラウザーSetCell同期＝§26相当）を含めるか、ヘッドレス検証のみか（決定事項 §要確認1）
- 要確認: Presence のPoC範囲はアクティブセルのみか、選択・編集中セルまで含むか（同 §要確認2）
- 要確認: apps/collaboration-server への hono / @hono/node-server / ws 追加の可否（同 §要確認3）

### 2026-07-11（仕様確認ゲート通過）
- ユーザー合意により仕様確定（dd-auto Step 2）。要確認3点の回答 — ①目視デモは含めない（ヘッドレス検証のみ）②Presenceは3種フル（アクティブセル・選択範囲・編集中セル）③collaboration-server への hono/@hono/node-server/ws 追加を承認
- 実装（Opus）は DD-002 のコードコミット後に開始する

---

## DA批判レビュー記録

> 手順・品質フィルター・再チェック条件は `doc/da-method.md` を参照。

### 共通DA観点（全Phase必須）

**§7.6 決定論違反の混入**（Date.now・Math.random・Map/Set反復順への依存・環境依存の文字列整列）と、**「テストのための実装」化**（フォールト注入が発火していない・収束assertが弱くて常にpassする）を毎Phaseで確認する。

| # | Phase | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------|-------------------|--------|----------------------|--------|------|
| 1 | | | | | | |
