# Codex レビュー依頼: DD-020-2 clipboard copy/cut/paste

## 目的（DD の狙い）

外部アプリ（Excel 等）⇄ グリッド間・グリッド内の copy/cut/paste を提供する。TSV parser・型変換（`parseCellInput` 委譲）・
**原子的 SetCells**（全成功/全失敗）＋OCC（beforeRevision セル単位照合）・上限・敷き詰め・公開エラー語彙まで一貫実装する。
親=DD-020（アンブレラ）。前提=DD-020-1 完了（選択レンジ `selectionCtrl.selectedRange` / `range-ops.buildRangeClear` /
上限定数 `SETCELLS_MAX_CELLS` / 公開拒否語彙 `range-too-large`）。後続=DD-020-3（Undo/Redo）が本DDの chokepoint を使う。

## スコープと確定済み決定事項（この方針からの逸脱は指摘してほしいが、方針自体は合意済み）

- ① 貼り付け上限=**100,000 セル**（実行前拒否）。② 行/列端はみ出し=**全体拒否**（切り捨て＝部分適用の排除）。
- ④ cut=提供（copy＋即時範囲クリア。Excel の移動セマンティクスにしない）。⑤ 書き出し=text/plain（TSV）のみ。
- (d) 不整合列数 TSV の欠けセル=変更対象に含めない（skip・空文字上書きしない）。present な空セルは blank 上書き（区別する）。
- 敷き詰め=**matrix 1×1 かつ複数セル選択 → 選択範囲全体へ敷き詰め**／それ以外は選択左上アンカーから matrix サイズ
  （一般タイル展開 2×2→4×4 は対象外＝将来拡張）。
- 経路: ClipboardEvent（clipboardData）主経路（navigator.clipboard 不使用）。**Navigation 位相かつ非 composing のみ**
  Command 化し、Editing/Composing はブラウザ既定（textarea 内テキスト編集）へ委譲（IME 不変 I-3・CG-1 維持）。
- beforeRevision=**paste/cut 実行時点の committed lastChangedRevision**（未書込=0）。

## 対象差分

`git diff 59ce9bc..HEAD`（本子DDの全 3 コミット）。中心ファイル:
- `packages/core/src/clipboard-text.ts`（`parseClipboardText` 状態機械・`serializeMatrix`・純関数）
- `packages/grid/src/clipboard-controller.ts`（`shouldInterceptClipboard`・`serializeSelectionToTsv`・`buildPaste`）
- `packages/grid/src/integration-editor.ts`（ClipboardEvent listener＝IME 資産の常駐 textarea と共有）
- `packages/grid/src/mount-controller.ts`（`performCopy/Cut/Paste`・位相裁定・確定単位 chokepoint `submitSetCells`）
- `packages/grid/src/error-codes.ts`（`paste-too-large`・`paste-out-of-bounds`）

## 設計意図（レビューで前提にしてよい点）

- parser は型変換しない（`parseCellInput` へ委譲＝偽陽性の一元管理）。空文字列→`[]`（paste noop）。引用空セル `""` は実在空セル。
- Navigation の paste は buildPaste の全 outcome（submit/too-large/out-of-bounds/noop）で **必ず消費**（preventDefault）。
  未消費だと browser 既定が textarea へペーストテキストを流し込み Navigation input が編集を開始してしまうため。
- cut は `buildRangeClear` を先に評価し too-large なら copy もせず全体拒否（クリップボード不変）。copy 自体は上限なし
  （read-only・SetCells を作らない）。
- 確定単位 chokepoint=`submitSetCells`（単一 commit・範囲クリア・paste・cut のクリアが全通過）。DD-020-3 が逆値捕捉に使う。

## 重点的に確認してほしい観点（findings 優先・到達性×実害で）

1. **仕様一致**: 敷き詰め条件（1×1×複数選択）・はみ出し全体拒否・上限実行前拒否・jagged skip vs present空 blank・
   beforeRevision の取り方が上記決定事項どおりか。取りこぼし・取り違えがないか。
2. **原子性/OCC（データ喪失・サイレント上書き）**: paste/cut が部分適用しうる経路はないか。beforeRevision の取り方で
   他者更新を黙って上書きする穴はないか。
3. **TSV parser の堅牢性**: 引用/エスケープ/CRLF/LF/末尾改行/未終端引用/巨大文字列でデータ化け・喪失・O(n^2)・
   スタック超過が起きないか。round-trip の非可逆ケースの実害。
4. **IME 非干渉（I-3・CG-1）**: composition 中/編集中に clipboard がグリッド Command 化して textarea の
   value/selection/draft を壊す経路がないか。ClipboardEvent 配線が既存 keydown/IME 経路に与える副作用。
5. **公開 I/F/権限**: 公開語彙追加（operationId 空文字規約）・R7（内部型の非露出）・contract snapshot の妥当性。
6. **回帰リスク**: mount-controller への配線が既存の範囲選択（DD-020-1）・resize・IME 経路に与える回帰。
7. **テスト不足**: unit/E2E/invariant で抜けている境界（特に到達可能で実害のあるもの）。

## 制約

- protocol 変更・IME 状態機械の遷移追加はしていない（していたら停止して xhigh 昇格の条項＝指摘対象）。
- コミット済み。修正は実装側（Claude）が行う。Codex はレビュー専用でリポジトリを変更しない。
