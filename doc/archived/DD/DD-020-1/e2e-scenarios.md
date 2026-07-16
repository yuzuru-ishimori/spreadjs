# DD-020-1 E2E シナリオ（範囲選択・範囲クリア）

> Phase 0 🎭 成果物。自然言語の「前提 → 操作 → 期待結果」で合意し、Phase 1/2 の Red（`apps/playground/e2e/range-selection.spec.ts`）へ機械化する。
> 実行環境は既存の統合 E2E ハーネス（poc-integration.html・実 WS サーバー 50,000行×200列・SEED_NONEMPTY=3000）。
> 選択状態の観測は debug API（`selectionRange()`/`dragRange()`・test-support 経由）で行う（Canvas 描画は DOM から読めないため）。

## S1: ドラッグ矩形選択（AC1）

- 前提: グリッド ready。セル (2,2) と (5,4) が可視。
- 操作: セル (2,2) の中心で pointerdown → (5,4) の中心まで pointermove（複数 step）→ pointerup。
- 期待:
  - move 中（up 前）: `dragRange()` = {rowStart:2,rowEnd:6,colStart:2,colEnd:5}（ライブ矩形）。`selectionRange()` は null のまま（未確定）。
  - up 後: `selectionRange()` = {2,6,2,5} が確定、`dragRange()` = null。
  - activeCell は (2,2)（pointerdown した anchor）のまま。

## S2: クリック（ドラッグなし）は単一選択（AC1 系）

- 前提: S1 の続き（範囲確定済み）。
- 操作: セル (3,3) をクリック（down→同セルで up）。
- 期待: `selectionRange()` = null（単一選択へ戻る）。activeCell = (3,3)。

## S3: Shift+クリック拡張（AC2）

- 前提: セル (2,2) をクリック済み（activeCell=(2,2)・範囲なし）。
- 操作: Shift を押しながらセル (4,3) をクリック。
- 期待: `selectionRange()` = {2,5,2,4}。activeCell は (2,2) のまま（anchor 固定）。

## S4: Shift+矢印拡張（AC3）

- 前提: セル (2,2) をクリック済み。
- 操作: Shift+ArrowDown ×2 → Shift+ArrowRight ×1。
- 期待: `selectionRange()` = {2,5,2,4}（focus 端のみ (4,3) へ拡張）。activeCell = (2,2) 不変。
- 追加操作: Shift+ArrowUp ×2 → focus が (2,3) へ戻る → `selectionRange()` = {2,3,2,4}。

## S5: 選択解除（AC4）

- 前提: S4 の状態（範囲あり）。
- 操作と期待（それぞれ独立に確認）:
  1. 通常 ArrowDown → 範囲解除（null）・activeCell が 1 下へ移動。
  2. 別セルの通常クリック → 範囲解除・activeCell 移動。
  3. Escape → 範囲解除・activeCell 不変。
  4. 印字入力（'x' タイプ）で編集開始 → 範囲解除。Escape で編集取消後も範囲は復活しない。
  5. 同一セル（anchor）を再クリック → 範囲解除（activeCell 不変でも解除される）。

## S6: 範囲 Delete＝原子クリア（AC5 正常系）

- 前提: セル (10,2)〜(11,3) の 4 セルへ既知の値を入力済み（committed 確認済み）。範囲 {10,12,2,4} を選択。
- 操作: Delete キー。
- 期待:
  - 4 セルの committed 値がすべて '' になる（他クライアントでも同値＝収束）。
  - committedRevision が **ちょうど +1**（1 SetCells＝原子 batch）。
  - 選択範囲は維持される（Delete は解除トリガーではない）。
  - 範囲内の空セルは operation に含まれない（unit で検証・E2E は revision +1 で代替観測）。

## S7: 範囲 Delete＝OCC 全体 reject（AC5 競合系）

- 前提: クライアント A/B が同一文書に接続。A がセル (20,2) と (20,3) に値を入力し committed 済み。A が範囲 {20,21,2,4} を選択。
- 操作:
  1. A を simulateDrop で切断（offline・自動再接続抑止）。
  2. B がセル (20,2) を別の値で確定（B→サーバー committed）。
  3. A（offline のまま）が Delete → ローカル楽観適用（pending=1・A の見た目はクリア）。
  4. A を simulateReconnect で再接続。
- 期待:
  - A の SetCells は stale-cell-revision（範囲内 1 セルの先行変更）で **全体 reject**（部分適用なし）。
  - A に rejected イベントが届く（Conflict Queue +1）。公開 code は reject 経路により
    `revalidation-failed`（再接続 catch-up 後のローカル再検証＝本シナリオの主経路）または
    `cell-conflict`（server 判定 stale-cell-revision）。通知の観測は `GridInstance.subscribe`（公開契約）で行う
    （#int-status は後続の connection/pending イベントで上書きされるため断定観測に使わない）。
  - 文書は無変更のまま収束: (20,2)=B の値・(20,3)=A の元の値（A/B の committedHash 一致）。

## S8: 上限超過の実行前拒否（AC6）

- 前提: A1 (0,0) をクリック → 最下行までスクロール → Shift+クリックで (49999,2) を選択（50,000行×3列=150,000 セル > 100,000）。
- 操作: Delete キー。
- 期待:
  - operation は submit されない（committedRevision 不変・pendingCount 不変）。
  - rejected イベント（公開 code=range-too-large）が emit され、#int-status に表示される。
  - 選択範囲は維持される（縮めて再実行できる）。

## S9: composition 中の選択操作・Delete 非干渉（AC7・synthetic）

- 前提: セル (30,2) で synthetic composition を開始し変換中（isComposing=true・draft='にほん'）。
- 操作と期待:
  1. Shift+ArrowDown → 範囲拡張は起きない（`selectionRange()` null のまま）・draft/composing 不変（状態機械が SuppressKey）。
  2. Delete キー → グリッドの範囲クリアは発火しない（committedRevision 不変）・composing 維持（textarea 既定動作のみ）。
  3. 変換確定 → 通常どおり commit できる（draft が失われていない）。
- 補足: 範囲選択中に composition を開始した場合（編集開始）は AC4 により単一選択へ戻る（S5-4 と同型）。

## 観測手段（機械化の前提）

- `selectionRange()` / `dragRange()`: GridDebugApi へ追加（`{rowStart,rowEnd,colStart,colEnd} | null`）。
- activeCell / isComposing / draft / committedRevision / pendingCount / committedCell: 既存 debug API。
- rejected 通知: playground の #int-status テキスト（renderStatus が conflict.code を表示）。
- 座標: `cellRectAt(row,col)` + `.nsheet-scroller` boundingBox から page 座標を算出（resize.spec.ts と同じ方式）。
