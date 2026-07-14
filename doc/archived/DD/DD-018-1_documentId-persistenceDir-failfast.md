# DD-018-1: serve() の documentId × persistenceDir 不一致 fail-fast

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-15 | 2026-07-15 | 完了 | documentId 不一致（snapshot＋全 oplog entry）＋封筒 revision 相互検査＋restoreFrom×persistenceDir 排他の3 fail-fast で **DD-014 既知制約 P2-3/P2-4 回収**。全検証 green（738 pass）・Codex high 2件全反映・見送り0。AC1〜3 充足 |

## 目的

`serve()`（公開 `ServeOptions`）が `documentId` と `persistenceDir` を独立に受け取るため、**文書Aで使用済みの `persistenceDir` を別 `documentId` で起動すると、現行 recovery が persisted documentId を照合せず A の内容を新 ID として公開し得る**（DD-014 既知制約 P2-3）。これを **起動時 fail-fast**（persisted documentId／revision 封筒と要求値の不一致検出で拒否）で塞ぐ。

## 背景・課題

- 出自: DD-014 既知制約 **P2-3**「recovery の documentId/revision 相互検証欠如」。DD-014 では「異常構成のエッジケース」として Alpha 対象外の既知制約に分類（ユーザー決定 2026-07-13）。回収先=「起動 recovery 堅牢化の後続DD」。
- DD-018 Codex 証拠監査（high・2026-07-15）**P1#2** が再評価: `documentId`/`persistenceDir` は**公開 Facade 入力**であり、悪意ある入力ではなく**通常の内部設定ミス**で誤公開に至る。roadmap §6 の trusted internal 境界（tenant isolation 非保証）では防げず、§6 の version-mismatch fail-fast 哲学（「古い snapshot/protocol を誤読しない・不一致を検出して fail-fast」）に倣うべき、と指摘。
- DD-018 判定での扱い: K7 を「延期→子DD DD-018-1 切り出し」とし、**Alpha ブロッカー扱いの是非はユーザー判断へ残した**（§6 は documentId を security 境界としない・P2-3 はユーザー既決で Alpha 対象外＝§5 でスコープ再決定しない、を根拠に DD-018 本判定は非ブロッカー。ただし Codex は不合格＝fail-fast 必須を主張）。

## 検討内容（着手時に精査）

- 関連: DD-014 P2-4（restoreFrom＋persistenceDir 併用の revision 不連続）も同じ recovery 堅牢化の範囲。まとめて扱うか要検討。
- fail-fast の粒度: (a) persisted `documentId` と要求 `documentId` の不一致で throw ／ (b) 封筒 revision と `snapshot.currentRevision`/`document.revision` の相互一致検査 ／ (c) 明示 override フラグ（意図的な restoreFrom）との両立。
- 公開面への影響: `ServeOptions` に検証エラーの通知経路（error code）を足すか。既存の fail-fast（version mismatch）と語彙を揃える。

## 決定事項

> Phase 0 精査で合意スコープ内で確定（着手承認=ユーザー 2026-07-15）。オーケストレータ推奨に沿う。

- **D1: P2-4 併合 = 実施**（AC3 で回収）。理由: 併合しても差分は小さい（restoreFrom×persistenceDir は現状どの caller も併用せず＝`restart-restore.test.ts`=restoreFrom 単独／`server.persistence.test.ts`・`reconnect-fault.test.ts`=persistenceDir 単独）。同じ「recovery 相互検証」範囲でレビューを 1 回に束ねられる。規模膨張なし。
- **D2: fail-fast 粒度**（roadmap §6 version-mismatch 哲学「不一致を検出して fail-fast・黙って誤読しない」に倣う。3 点）:
  - **(a) documentId 照合**（AC1）: `recoverSequencerState` に `documentId` を渡し、persisted 側 documentId（**snapshot.documentId** を第一、無ければ oplog 先頭 entry の documentId）と要求 documentId が不一致なら throw。snapshot/oplog どちらの復旧経路でも A の内容が B として公開されない。
  - **(b) 封筒 revision 相互一致**（AC3）: persisted snapshot がある時、`persisted.revision`（封筒）＝`snapshot.currentRevision`（内側 v3）＝`snapshot.document.revision` の三者一致を検査し、不一致（改竄/bit-rot）なら throw。既存の「snapshot revision > oplog 長」「oplog revision 連番」検査に追加。
  - **(c) restoreFrom×persistenceDir 排他**（AC3・P2-4）: `startServer` で両指定を **明示拒否**（throw）。restoreFrom=in-memory 専用 bootstrap（検査/テスト）・persistenceDir=durable file 復旧で、併用は revision 不連続（空 dir＋R の restoreFrom→次 op が R+1 を空 oplog 先頭へ→次回起動で連番違反）を生む。DD-014 Codex P2-4 の sanctioned 対応「明示拒否 or 全ログ durable bootstrap」の前者を採用。後者（restoreFrom 全ログの durable bootstrap）は現 caller 不在・Alpha スコープ外ゆえ Stage 2 backlog へ据え置き。
- **D3: エラー語彙**: 本 fail-fast は **サーバー起動時の throw**（`serve()`/`startServer()` の Promise reject）で、既存のサーバー側 fail-fast（`recoverSequencerState:` / `parsePersistedSnapshot:` / `deserializeSnapshot: 非対応の snapshot version` の版数不一致 fail-fast）と同じ **関数名 prefix 付き descriptive Error** に揃える。DD-017 の `packages/grid/src/error-codes.ts`（`GridErrorCode`/`GridConflictCode`）は**クライアント Facade の runtime イベント語彙**（別レイヤ）で、起動時 throw には適用しない（混同すると層が壊れる）。**ServeOptions は不変**（公開 API 追加なし＝Experimental 0.x の安定性を保つ）。
- **D4: Codex 要否 = 必須・effort high**。入力検証＋データ整合を公開 Facade 経路（documentId/persistenceDir）で扱うため必須。ただし data migration や認可変更は無く単一関心の fail-fast ゆえ xhigh 非該当＝high。

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | 文書A使用済み `persistenceDir` を `serve({documentId:'B', persistenceDir: dirA})` で起動 → persisted documentId 不一致を検出して **fail-fast（起動拒否・明示エラー）**。A の内容が B として公開されない | Phase 実装 🔬（fault/negative テスト） |
| 2 | 正常系（同一 documentId で既存 persistenceDir を再開）は従来どおり復旧できる | 🔬（既存 recovery テスト green 維持） |
| 3 | 封筒 revision と snapshot/document revision の相互検査で不整合を fail-fast（**P2-4 併合＝実施**：封筒 revision 三者一致検査＋restoreFrom×persistenceDir 排他 throw） | 🔬 |

## タスク一覧

### Phase 0: 事前精査
- [x] 📋 各Phaseのタスク精査・詳細化（決定事項 D1〜D4 に記録）
- [x] 📐 実装前詳細化トリガー判定 → 詳細化済（決定事項 D2 に fail-fast 3 点の対象ファイル・データフローを確定）
- [x] 🧑‍⚖️ Codexレビュー要否判定 = **必須・high**（D4）。Codex 利用可確認済（下記ログ）
- [x] 😈 Devil's Advocate調査 → 正常 restoreFrom 単独・同一 documentId 再開は throw しない（AC2 で positive 固定）。過剰拒否防止のため documentId 照合は persisted 側が存在する時のみ（空 dir は fresh 扱いで通す）

### Phase 1: recovery 相互検証・fail-fast 実装
- [x] `packages/server/src/persistent-room.ts` `recoverSequencerState`: `documentId` 引数追加＋persisted documentId（snapshot 優先・無ければ oplog 先頭 entry）× 要求 documentId 照合で throw（D2-a・AC1）
- [x] `packages/server/src/persistent-room.ts`: 封筒 revision＝内側 currentRevision＝document.revision の三者一致検査で throw（D2-b・AC3）
- [x] `packages/server-hono/src/server.ts` `startServer`: restoreFrom×persistenceDir 併用を throw（D2-c・AC3）＋recoverSequencerState へ documentId を伝播
- [x] 🔬 機械検証: negative テスト（誤公開シナリオで throw）＋正常系 green（`persistent-room.test.ts`・`server.persistence.test.ts`）
- [x] 😈 DA批判レビュー
- [x] Codexレビュー（必須・high）

## ログ

### 2026-07-15（着手・実装・検証）
- **着手承認=ユーザー（2026-07-15「片付けよう」）**。Phase 0 精査で決定事項 D1〜D4 を確定（P2-4 併合実施・fail-fast 3 点・エラー語彙=サーバー側既存 throw に整合・Codex 必須 high）。出自証拠パスを DD-018 アーカイブ後の実パス（`doc/archived/DD/DD-018/...`）へ是正。
- **実装**:
  - `packages/server/src/persistent-room.ts` `recoverSequencerState`: `documentId` 引数追加。persisted 側 documentId（snapshot.documentId 優先・無ければ oplog 先頭 entry.documentId）× 要求 documentId の照合で throw（AC1）。空 dir（persisted 無し・oplog 空）は照合対象なしで通過（過剰拒否防止）。封筒 revision＝内側 snapshot.currentRevision＝snapshot.document.revision の三者一致検査で throw（AC3）。
  - `packages/server-hono/src/server.ts` `startServer`: restoreFrom×persistenceDir 併用を throw（AC3・P2-4）＋recoverSequencerState へ documentId 伝播。
  - 既存 caller へ documentId 伝播: `persistent-room.test.ts`（3）・`persistence-fault.test.ts`・`tests/invariants/collab/persistence.invariant.test.ts`・`scripts/dd014/measure-recovery.mts`。
- **テスト追加**: `persistent-room.test.ts`（documentId 不一致 snapshot/oplog 両経路 throw・同一 ID positive・空 dir 通過・封筒 revision 不一致 throw の 5 件）／`server.persistence.test.ts`（誤公開シナリオ end-to-end throw＝A の内容を B として公開しない・AC2 同一 ID 再開・restoreFrom×persistenceDir 排他 throw の 2 it）。
- **機械検証 green**: `npm run typecheck`／`npm run lint`（eslint＋boundary baselined=10 new=0）／`npm run test`（**737 pass / 79 files**・既知 flaky ws-convergence.smoke も pass）／`npm run build`。AC1（negative＋positive）・AC2・AC3 を機械固定。
- **stage2-backlog.md**: P2-3/P2-4 を「DD-018-1 で回収済」へ更新（取り消し線）。
- **Codexレビュー（必須・high・1回）**: 依頼書 `doc/DD/DD-018-1/codex-review-request.md`／結果 `doc/DD/DD-018-1/codex-review-result.md`。**findings 2 件（P1×1・P2×1）**。
  - ✅**P1 反映（oplog 全 entry の documentId 照合）**: 当初は snapshot.documentId（無ければ oplog 先頭 entry）のみ照合＝旧版で別 ID 起動した残骸（doc-A snapshot＋doc-B tail）を doc-A 再開時に見逃し、混在 tail を replay し得た。→ **snapshot.documentId 照合＋全 oplog entry の documentId 照合**（既存の revision 連番検査と同一走査に畳み込み・追加コスト無し）へ強化。混在ログ negative テストを追加（`persistent-room.test.ts`「oplog に別 documentId の entry が混在したら fail-fast」）。到達性×実害＝到達性は低い（先行 misconfig 起因）が誤公開の実害＝防御を厚くする価値あり・低コストゆえ反映。
  - ✅**P2 反映（DD-INDEX 再生成）**: `bash scripts/dd-index-gen.sh` 実行済。
  - 見送り findings: なし。
- **P1 反映後の再検証 green**: typecheck／lint（baselined=10 new=0）／targeted 28 tests／full `npm run test` = 738 pass（1 flaky = ws-convergence.smoke〔timeout 境界・persistenceDir 非使用＝本DD無関係・DD-014 既知〕は再実行で pass）／build。

### 2026-07-15（完了・アーカイブ）
- ユーザー指示「片付けよう」の趣旨に基づき完了→アーカイブ→コミットまで実施（要判断なし・仕様/AC変更なし）。
- 知見の昇格判定: 該当なし（「persisted 照合は snapshot だけでなく oplog 全 entry を同一走査で照合」は本DDの recovery 設計固有＝DD本体とテストが正本。engineering-patterns への新規昇格なし）。
- 仕様書同期: `doc/spec/` 不在のためスキップ（公開 API 不変・ServeOptions 変更なし。挙動追加は本DDと negative テストが記録）。
- ステータス=完了 → アーカイブ（`doc/archived/DD/`）。

### 2026-07-15（起票）
- DD-018 判定（Codex P1#2 追認）で起票。**起票のみ＝着手はユーザー判断**（DD-018 要確認E: 子DD起票まで自動・着手はユーザー）。Alpha ブロッカー扱いの是非も要ユーザー判断（DD-018 総合判定は非ブロッカーとしつつ透明化のため本DDへ切り出し）。
- 出自証拠: `doc/archived/DD/DD-014_永続化・snapshot復元.md`（既知制約 P2-3/P2-4）・`doc/archived/DD/DD-018/codex-review-result.md`（P1#2）・`doc/archived/DD/DD-018/stage1-gate-checklist.md`（C節 K7）。〔2026-07-15 着手時に DD-018 アーカイブ移動後の実パス `doc/archived/DD/DD-018/...` へ是正〕

---

## DA批判レビュー記録

### Phase 1 DA批判レビュー（2026-07-15）

**DA観点**: fail-fast で最も壊れやすいのは「過剰拒否で正常復旧を殺す」点と「照合をすり抜ける経路」。

| # | 観点 | 判定・対応 |
|---|------|-----------|
| 1 | 正常な同一 documentId 再開を誤って拒否しないか | ✅ AC2 positive テストで固定（`server.persistence.test.ts` 同一 'doc-A' 再開が recovery 成功）。照合は persisted 側が存在する時のみ |
| 2 | 空 persistenceDir（fresh 起動）を拒否しないか | ✅ `persisted 無し＋oplog 空` は persistedDocumentId=undefined ゆえ照合せず通過（unit テストで固定） |
| 3 | restoreFrom 単独（persistenceDir なし）を拒否しないか | ✅ 排他は両指定時のみ。既存 `restart-restore.test.ts`（restoreFrom 単独）が全 green＝回帰なし |
| 4 | documentId 照合をすり抜ける経路（snapshot 有だが未検査／snapshot 無 oplog 有） | ✅ snapshot 経路・oplog-only 経路の両方で throw を negative テスト化。照合は totalOps 計算直後・両分岐の前に一括実施 |
| 5 | 封筒 revision 検査が checksum を通り抜ける論理不整合を捕えるか | ✅ checksum 自己整合な改竄 snapshot（封筒 revision 99・内側 3）を実注入し throw を確認（「通るように書いた」だけでない） |
| 6 | 既存の revision 連番/snapshot>oplog 検査と順序矛盾しないか | ✅ 新検査は `persisted !== undefined` 分岐内・`snapshotRevision > totalOps` 検査の前に配置。oplog 連番検査は先行（totalOps 確定時）で不変 |

> Codex（必須・high）findings は下記ログの Codex 節に triage 記録。
