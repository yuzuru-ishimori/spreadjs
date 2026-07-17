# ADR-0024: クライアント主導 Undo（補償 SetCells・undoRequest プロトコル不採用）

- **Status**: Proposed（DD-020-3 で実装・Codex high レビュー済み。Accepted 化は共同編集の高度 Undo 要件が確定した段階）
- **関連**: 計画書 §15（Undo/Redo・§15.1 補償 Operation・§15.2 undoRequest プロトコル案・§15.4 条件付き Undo・§15.5 Redo）／ADR-0008（楽観適用＋rollback/replay）／DD-020（Clipboard アンブレラ・親③）／DD-020-3（本 ADR の実装）／DD-024（単独グリッドモード＝Stage 2 主 consumer）

## 背景・課題

計画書 §15.2 は Undo を**サーバー主導の undoRequest / undoAccepted プロトコル**（サーバーが操作ログを検証し「対象がその後変更されていない」ことを判定して巻き戻す）として素描していた。しかし本製品の Stage 2 主 consumer は**単独グリッドモード（DD-024・共同編集サーバー無し）**であり、サーバー主導 Undo は次の不整合を生む:

- 単独モードにはサーバーが無く、undoRequest の受け手がいない → Undo の別経路が必要になる（主 consumer で主経路が使えない）。
- protocol / server / 永続化の変更が大きく、共同編集固有の操作ログ検証の実装コストが高い。

一方 Undo の支配的リスクは **R-07（補償が他者の後続更新をサイレント上書きする）**。「対象セルがその後変更されていないときだけ Undo を通す」条件（§15.4）を、既存の OCC（`stale-cell-revision`）で自然に満たせないかが論点。

## 選択肢

| 選択肢 | 概要 | 長所 | 短所 |
|--------|------|------|------|
| (A) undoRequest プロトコル（計画書 §15.2） | サーバーが操作ログを検証し巻き戻す | 共同編集で「他者操作を含む正確な Undo 履歴検証」が可能 | protocol/server/永続化の変更大／**単独モードに別経路が必要**（主 consumer で使えない）／実装コスト大 |
| **(B) クライアント主導・補償 SetCells（採用）** | クライアントが確定単位ごとに逆値＋自分の確定 revision を保持し、Undo=逆値を beforeRevision 付き SetCells で submit。既存 OCC が条件を検証 | **protocol/server/永続化の変更ゼロ**／単独・共同で**同一機構**（`GridBackendSession.submitLocalOperation` 経由）／§15.1「文書全体を巻き戻さず補償 Operation を生成」と一致／OCC が §15.4 の条件付き Undo をセル単位で実現（他者変更は全体 reject＝R-07 対策） | 他クライアントの操作は Undo できない（自分の操作のみ・§15.1 の MVP 範囲）／サーバー側の操作ログ検証は無い（クライアント信頼） |

## 決定

**(B) クライアント主導・補償 SetCells** を採用する（protocol 変更なし）。

- **逆値の捕捉**: 確定単位 chokepoint（`packages/grid/src/mount-controller.ts` の `submitSetCells`）で **submit 直前に committed から前値を読む**。`InverseSeed`（apply 戻り値）は使わない（collab の楽観適用と standalone の即時適用で経路が異なるため・両モード同一経路へ統一）。
- **補償の beforeRevision（R-07 の要）**: 「元操作確定時 revision を素直に凍結」するのではなく、**ownedRevision マップ（＝自分の最後の確定操作がそのセルへ付与した revision）**を beforeRevision に使う。
  - ownedRevision は**自分の op の正確な ACK revision**で更新する（collab は own echo が運ぶ revision＝`session-sync` の own-echo 検出。committed の事後読取ではないため、同一 echo batch に他者 op が混ざっても foreign revision を owned と誤認しない）。standalone は即時確定 revision。
  - これにより「同一セルを 2 回編集 → 2 回 Undo」で自分の補償 ACK が revision を bump しても**自傷 reject しない**（連続編集 Undo が成立）。一方 **他者**が変更した revision は owned と一致しないため OCC（`validateSetCells` の `stale-cell-revision`）が**全体 reject** し、サイレント上書きを防ぐ（強制 Undo なし）。
- **pending/直列化**: `pendingCount===0`（自分の全 op が確定）を Undo/Redo の必要条件にする＝「pending 中の op は Undo 対象外（親⑥）」と「in-flight 補償の直列化（ownedRevision 競合回避）」を同時に満たす。
- **拒否時**: 補償が OCC で reject されたらスタックから除去＋通知（公開語彙 `undo-blocked` / `redo-blocked`）。強制 Undo はしない（同条件の再試行は同結果）。
- **Redo**: Undo の逆（順値の再適用）。新規通常操作で Redo スタックを破棄する（§15.5）。

## protocol 無変更の根拠

- Undo/Redo は既存の `SetCellsOperation`（`beforeRevision` セル単位）・`validateOperation`（`stale-cell-revision`）・`GridBackendSession.submitLocalOperation`（楽観適用／即時適用の共通契約）・`rejected` イベント（GridConflict）だけで構成される。**新規 wire メッセージ・server 実装・永続化・IME 状態機械の遷移追加はゼロ**。
- 公開面の追加は `GRID_CONFLICT_CODES` への `undo-blocked` / `redo-blocked`（union 追加のみ・既存コードの意味変更なし・R7 維持）のみ。
- ゆえに Codex effort は high（xhigh の protocol/永続化/状態機械変更条件に非該当）。将来 protocol 変更が必要になれば停止して xhigh へ昇格する（DD-020-3 ヘッダ条項）。

## 既知の未保証境界（L5・DD-020-3 と一致）

- **自分の操作のみ・セッション内**（reload で履歴消滅・§15.1 MVP）。他クライアントの操作の Undo・強制 Undo・永続 Undo 履歴は対象外。
- **サーバー側の操作ログ検証は無い**（クライアントが逆値・revision を保持）。共同編集で「他者操作を跨ぐ正確な Undo 履歴」が要件化したら (A) undoRequest を再検討する（将来課題として境界化）。
- **再接続中に accepted された自分の op**（own echo を伴わない reconcile 経由で pending から除去された op）は ownedRevision を確定できず、その op の Undo は保守的に OCC reject されうる（サイレント上書きより安全側＝データ喪失なし）。
- **メモリ**: 逆値は保持エントリ分（深さ 100）だけ CellScalar を保持する。巨大 paste（最大 100,000 セル）を多数 Undo 履歴に残すとメモリが増える（総セル数に比例）。ownedRevision マップはセッション内の編集済み distinct セル数に比例（int 1 個/セル・軽微）。

## 将来の再検討条件

- 共同編集で「他者操作を含む Undo 履歴の正確性」や「サーバー権威の Undo 検証」が要件化 → (A) undoRequest プロトコルを再評価（本 ADR を Superseded 化）。
- 行操作（DD-021）の Undo 拡大時に、削除行の復元（un-tombstone）を補償で表現できるか（現状 SetCells のみ・行操作の Undo は §15.3 MVP 後）。
