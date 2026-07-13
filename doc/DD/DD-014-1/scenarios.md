# DD-014-1 テストシナリオ（Red 設計・自然言語）

親DD-014 の Codex xhigh P1 findings（P1-3〜P1-7）を解消し CG-3 を解除する。各シナリオは AC↔テストへ対応する。

## S1: クライアント snapshot bootstrap（AC1・P1-6/P1-7）
- **S1-1 fresh join は全 replay しない**: 大規模文書（bulk 構築）を持つ room へ committed.revision=0 のクライアントが join → サーバーは `bootstrap`（document@frontier）を 1 通返し `operations`（全 operationLog）を返さない。クライアントの committed が R に一致（hash 一致）し、適用したサーバー op 数（appliedServerOpCount）は 0。
  - 実装: `packages/collab/src/bootstrap.test.ts`「AC1: fresh join は bootstrap で committed を確立し全 operationLog を replay しない」／`packages/server/src/durable-frontier.test.ts`「非空文書への fresh join は bootstrap を返し operations を返さない」／`packages/server/src/room.test.ts`「DD-014-1 AC1: 非空文書への fresh join は bootstrap を返し全 operationLog を送らない」
- **S1-2 bootstrap 後の tail のみ適用**: bootstrap@R 後に R+1.. の operations を受信 → committed が前進し appliedServerOpCount=tail 長のみ。参照文書と hash 一致。
- **S1-3 順序入れ替え**: tail が bootstrap より先着 → buffer 保留 → bootstrap で R 確立 → drain で連続適用（二重適用0）。
- **S1-4 空文書 R=0**: fresh join でも server は bootstrap を送らず通常 operations 経路（後方互換）。
- **S1-5 partial join（reconnect）**: lastAppliedRevision>0 は bootstrap を返さず tail（operations）のみ。

## S2: durable frontier 読取ゲート（AC2・P1-3）
- **S2-1 in-flight 窓の非観測**: revision 1 を durable 化後、revision 2 を submit（Sequencer は同期前進で currentRevision=2）だが append 未解決＝未 durable。この窓で join/requestCatchup/`durableSnapshot()`/welcome はいずれも frontier(=1) 以下しか観測しない（bootstrap.revision=1・snapshot.currentRevision=1・operationLog=[1]）。append 解決後に frontier=2 へ前進し観測可能になる。
  - 実装: `durable-frontier.test.ts`「append 待機中（in-flight）は join/catch-up/durableSnapshot が未 durable revision を観測しない」

## S3: snapshot barrier（AC3・P1-4/P2-5）
- **S3-1 barrier で延期→durable 化後に生成**: snapshotIntervalOps=2。1 件 durable 化後、2 件目を in-flight（frontier=1・current=2）にすると barrier で snapshot 未生成。append 解決（frontier=2=current）後に生成され snapshot.revision=2（≦frontier）。
  - 実装: `durable-frontier.test.ts`「in-flight で currentRevision>frontier のとき snapshot を生成せず、durable 化後に生成する」
- **S3-2 P2-5 再判定**: 既存 `persistent-room.test.ts`「N op ごとに snapshot が非同期生成される」に加え、生成完了 finally での maybeSnapshot 再帰で蓄積分を再評価（tail 無限肥大なし）。

## S4: room poisoning（AC4・P1-5）
- **S4-1 append 失敗→write 停止・欠番0**: revision 1 を durable 化後、append を 1 回失敗注入 → handleMessage が throw・poisoned=true。以降の submit は poisoned で reject（Sequencer を前進させない）。oplog は revision 1 のみ（失敗した 2・拒否した 3 は書かれず＝欠番なし）。frontier も 1 のまま。
  - 実装: `durable-frontier.test.ts`「append 失敗後は後続 submit を reject し oplog に欠番を作らない」

## S5: 実ブラウザー再読込復元 E2E（AC8）
- **S5-1 編集→確定→再読込→復元**: 統合ページ（50,000 行）でセルを編集・確定（pending 0・committed 反映まで待つ）→ `page.reload()` → 新 ClientSession が fresh join → bootstrap で復元。bootstrapRevision>0・appliedServerOpCount=0（tail 無し＝全 replay 非依存）・編集済み確定値が復元・50,000 行復元。
  - 実装: `apps/playground/e2e/reload-bootstrap.spec.ts`（headless chromium・証跡 `reload-01/02-*.png`）

## S6: bootstrap 計測（AC1/AC8・Evidence full）
- **S6-1**: 20,000 個別 SetCells op で構築した権威文書へ fresh join → bootstrap 1 通・appliedServerOpCount=0・復元 4.8ms。対照の全 operationLog replay は 20,001 op 適用・26.3s。→ 全 replay 非依存を定量実証。
  - 実装: `scripts/dd014-1/measure-bootstrap.mts`（生ログ `bootstrap-perf-raw.txt`）
