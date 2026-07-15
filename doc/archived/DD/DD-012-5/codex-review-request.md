# Codexレビュー依頼: DD-012-5 Excel風テキスト表示（オーバーフロー・折り返し・自動行高）

別モデル視点で、以下の未コミット差分を **findings 優先**（仕様一致・境界・回帰・テスト不足・IME不変・性能）でレビューしてください。修正は実装側（Claude）が行うので、指摘の列挙と重大度に集中してください。

## 目的・スコープ

Excel 風のセルテキスト表示を実装する（親 DD-012 / DD `doc/DD/DD-012-5_オーバーフロー表示折り返し自動行高.md`）:
1. **オーバーフロー（描画のみ・データ不変）**: 左寄せ描画の文字列セルは、右隣の連続空セルへはみ出して全文表示。右隣に非空セルが来る手前・pane（固定行列）境界・viewport clip で止め、収まらなければ末尾 `…` 省略。数値（右寄せ）は対象外。可視範囲の左外にあるはみ出し元も行ごとに最大 20 列遡って描画。
2. **折り返し＋自動行高**: `GridMountOptions.wrapColumns?: readonly string[]`（ColumnId 文字列）指定列は、はみ出さず文字単位（CJK 前提）に折り返し、収まらない行は必要な高さへ自動拡張（値短縮・削除で自動縮小）。**手動リサイズ済みの行は手動優先**。**自動高は layout イベントに含めない（環境・フォント依存の導出値）**。wrap 列は mount 時固定。

## 確定仕様（変更不可・準拠を確認したい）

- D1 wrap は列単位（`wrapColumns` mount option）。D2 オーバーフロー対象=左寄せ文字列のみ・pane/clip/非空セルで停止・データ不変。D3 左外流入は最大 **20 列**遡り。D4 行分割=文字単位・値×幅 LRU キャッシュ。D5 自動行高トリガー=①bootstrap 一括 ②セル値変更（ローカル/リモート/rollback）③列幅変更 ④wrap は mount 固定・**手動優先**。D6 一括計算の予算目安 ≦200ms（超過時フォールバック判断は実測記録）。D7 自動高は layout に含めない。
- 最重要不変: IME（変換中に textarea の value/selection/DOM 親へ触れない・#8/I-3）。ClientSession が唯一の正本、DocumentView は状態を持たない読み取りアダプター（#2）。R7（Facade 公開シグネチャに内部型を出さない）。

## 対象差分（主なファイル）

- `packages/render/src/text-overflow.ts`（新規・走査純関数）＋`.test.ts`
- `packages/render/src/text-cache.ts`（`wrapLines` 追加）＋`.test.ts`
- `packages/render/src/base-layer.ts`（オーバーフロー／wrap 描画・共有 textCache・fits 高速パス・左外流入 pass）
- `packages/grid/src/auto-row-height.ts`（新規・自動高算出）＋`.test.ts`
- `packages/grid/src/document-view.ts`（自動高別レイヤ・手動優先合成・再計算 API・bootstrap 一括）
- `packages/grid/src/session-sync.ts`（wrap passthrough・リモート/reject トリガー）
- `packages/grid/src/mount-controller.ts`（wrapColumns 配線・共有 textCache・isWrapColumn・ローカル/列幅/DPR トリガー・spacer 同期）
- `packages/grid/src/index.ts`（`wrapColumns` 公開オプション）
- showcase: `features.json`・`demo/scenarios.ts`・`demo/main.ts`／`CHANGELOG.md`／playground E2E（`text-display.spec.ts`・helpers・main.ts の `?wrap=`）

## 特に見てほしい観点（findings 優先）

1. **仕様一致**: D2〜D7 の準拠。特にオーバーフローの停止条件（非空セル手前・pane 境界・clip）、左外流入の 20 列境界・pane 境界（frozenColCount）越え防止、自動高の手動優先（D5）と layout 非混入（D7）。
2. **トリガー網羅（D5）**: ローカル楽観適用・リモート SetCells・rollback(reject)・列幅変更・bootstrap・DPR/font 変更で自動高が漏れなく更新されるか。逆に過剰再計算（毎フレーム全走査等）の性能退行が無いか。
3. **totalSize⇔スクロール整合**: 自動高で行高が変わったとき spacer（scrollable 範囲）が同期され、末尾までスクロール可能か。スクロール飛びの懸念。
4. **描画正しさ**: 二重描画・pane clip 越え・数値/wrap の除外漏れ・fits 高速パスの分岐漏れ・DPR。
5. **IME 不変・#2/R7**: 自動高変更が IME draft/textarea に波及しないか。DocumentView が状態を増やしていないか（自動高は導出値として妥当か）。公開シグネチャに内部型が出ていないか。
6. **境界/回帰**: 空文字・maxWidth<=0・超長単一文字・構造Op（行挿入削除）後の RowId 追従・override 消去の相互作用。既存 DD-012-4（手動リサイズ）との競合。
7. **テスト不足**: 上記のうちユニット/E2E で未カバーな重要ケース。

## 検証状況（参考）

`npm test`=794 pass / typecheck / lint＋boundary(new=0) / test:invariants=40（IME 含む）/ test:e2e(playground)=12（text-display 含む）/ test:e2e:showcase=3 全 green。D6 一括計算 node 実測: 現実密度 ~140ms、最悪(全5万行 unique wrap)=1121ms（full batch 採用・境界明記）。
