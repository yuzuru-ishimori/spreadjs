# DD-005 Phase 2・Phase 3 実装アドバイス

DD-005 Phase 2以降について、現在の方針には同意しています。

Phase 1の `sheet-collaboration` 抽出は、挙動保存リファクタとして成立しています。ここを再設計せず、Phase 2・Phase 3の統合へ進めてください。

そのうえで、以下を実装・詳細設計・DAレビュー・Codexレビュー上の重要事項として扱ってください。

---

## 1. 状態の所有権を最初に固定する

統合後に複数の正本を作らないでください。

### Document State

- `ClientSession` の committed＋pending viewを唯一の正とする
- サーバーOperation、ACK、reject、rollback／replayの結果はここへ集約する

### Render State

- Document Stateから導出する破棄可能なキャッシュとする
- 正本にはしない
- 必要ならいつでもDocument Stateから再構築できること

### IME Draft

- 常駐textarea内のローカル状態を唯一の正とする
- Operation受信、rollback／replay、rejectで上書きしない
- IME変換中の未確定文字列をDocument Stateへ入れない

### Editing Target

- display indexではなく `RowId + ColumnId` で保持する
- 行挿入・削除後は固定IDから表示位置を再解決する

### Presence

- Document Stateとは独立した非永続状態として扱う
- activeCell、selectionRanges、editingCellを共有する
- textarea内の文字列やキャレット位置は共有しない

Phase 2の詳細設計では、各状態について以下を明記してください。

- 所有者
- 更新契機
- 派生元
- 永続化の有無
- 同期対象か
- 破棄・再構築可能か

---

## 2. `document-view` を第二のCellStoreにしない

`document-view.ts` は次のいずれかに限定してください。

- ClientSession文書をCanvas側から読むためのAdapter
- 描画高速化のための派生キャッシュ

独自にOperationを適用したり、ClientSessionとは別の永続的セル状態を保持したりしないでください。

次の三重管理は禁止です。

- ClientSessionの文書
- Canvas用の独自文書
- IME側の旧cell-store

Canvas用キャッシュを持つ場合は、いつでもClientSessionの状態から再構築可能であることを条件としてください。

---

## 3. `beforeRevision` はセル単位のrevisionを使う

編集開始時に保持するのは、原則として文書全体のrevisionではなく、対象セルの `lastChangedRevision` です。

```ts
const editStartRevision = targetCell.lastChangedRevision;
```

これを `SetCells.changes[].beforeRevision` に使用してください。

別セルの更新だけで同一セル競合にならないことを、ユニットテストへ含めてください。

---

## 4. 構造Operation後はRowIdで位置を再解決する

上方への行挿入後に、現在のdisplay indexを維持してはいけません。

```text
editingRowId
→ 更新後のAxisでdisplay indexを再解決
→ textarea位置を再算出
```

という順序にしてください。

編集対象行が削除された場合は、

- index範囲外になったか

ではなく、

- `editingRowId` がtombstoneになったか
- `displayRowOrder` から消えたか

で判定してください。

削除された場合は、以下の挙動にしてください。

- textarea draftをConflict Queueへ退避
- 無効なRowIdへのCommitを禁止
- draftを黙って破棄しない
- 次の選択位置は別途ルールで決定する

---

## 5. SetCellsと構造Operationの更新コストを分ける

通常のセル更新ごとに、50,000行のAxisや10万セルを全再構築しないでください。

最低限、次のように分けてください。

```text
SetCells
  → 対象セルの差分更新
  → dirty regionのみinvalidate
  → 必要な可視セルだけ再描画

InsertRows / DeleteRows
  → Axis更新または再構築
  → scroll anchor補正
  → editing RowId / Presenceを再解決
  → geometryをinvalidate
```

PoCのため、構造変更時にAxis全再構築することは許容します。

ただし、通常の `SetCells` 受信でも全再構築する設計にはしないでください。

---

## 6. 初期snapshot経路を計測する

統合ページは50,000行×200列・非空約10万セルのため、合否条件でなくても以下を計測・記録してください。

- snapshot JSONサイズ
- サーバー生成時間
- HTTP転送時間
- JSON parse時間
- ClientSession初期化時間
- Axis構築時間
- 初回Canvas描画までの時間
- 初回操作可能になるまでの時間

これはDD-007の既知制約と、Phase 1の初期ロード設計に使用します。

---

## 7. IME確定からOperation送信までの順序を守る

Commitは次の順序としてください。

```text
1. 最終inputを受信
2. textarea.valueを確定draftとして取得
3. 対象RowId / ColumnIdの生存を確認
4. 編集開始時のbeforeRevisionを取得
5. SetCellsを生成
6. ClientSessionへsubmit
7. ACKまたはrejectを受信
8. reject時は入力値をConflict Queueへ保持
```

`compositionend` だけを根拠にCommitしないでください。

最終 `input` 前の暫定値が送信される回帰を防いでください。

---

## 8. rollback／replay中もIME状態を変更しない

DAレビューとテストに、次の不変条件を追加してください。

ClientSessionのrollback／replay、リモートOperation適用、`operationRejected` 処理の前後で、IME変換中は以下が不変であること。

- `textarea.value`
- `selectionStart`
- `selectionEnd`
- textareaのDOM親
- textareaインスタンス
- editing RowId
- editing ColumnId
- composition state

CanvasとDocument Stateは更新して構いません。

ただし、IME draftへサーバー値を反映してはいけません。

---

## 9. 競合表示の視認性をheadedブラウザーで確認する

Aが編集中にBの値が確定した場合、以下が同時に識別できる必要があります。

- Canvas上のサーバー確定値
- textarea上のAのdraft
- 競合インジケーター

textareaがセル全面を覆って競合表示を隠さないよう、競合枠、バッジ、外側表示などのz-indexと描画位置を確認してください。

これはユニットテストだけでなく、headedブラウザーで証跡を残してください。

---

## 10. Phase 2詳細設計ゲートで提示するもの

大きな実装へ進む前に、次のデータフローを提示してください。

```text
snapshot / Server Operation
  → ClientSession
  → DocumentView Adapter
  → Axis / Canvas
  → Resident Textarea
  → Commit Bridge
  → ClientSession submit
  → ACK / Reject
  → Canvas / Conflict Queue
```

各矢印について以下を明記してください。

- 入力データ
- 出力データ
- 状態を所有するモジュール
- 同期処理か非同期処理か
- エラー・reject時の経路
- 再接続時の経路
- RowId / ColumnIdの維持方法
- dirty flagの種類

この所有権とデータフローが一意であれば、その後は合意済みスコープ内として自動継続して構いません。

---

## 11. 既存DDの既知制約は隠さない

DD-003で残っている以下の境界は、本DDでは解消しなくて構いません。

- client→server方向の `submitOperation` 欠落
- `clientSequence` の完全再整列未実装
- フォールト試験が主にserver→client方向

ただし、以下の形で明示してください。

- DD-005の対象外
- DD-007の既知制約
- Phase 1共同編集DDの対応候補

統合PoC成功を「すべてのネットワーク障害に対応済み」とは表現しないでください。

---

## 12. DD本文の状態を同期する

Phase 2着手前に、DD本文の以下を実態に合わせて更新してください。

- Phase 0の着手前提チェック
- DD-004の状態
- DD-003／DD-004のアーカイブ状態
- Phase 1完了状態
- 現在のテスト件数
- 現在の作業ツリー制約

これは実装を止める問題ではありませんが、後続エージェントが古い前提を読まないようにしてください。

---

## 最重要原則

最も重要なのは、次の1点です。

> `ClientSession` だけをDocument Stateの正本とし、CanvasとIMEに第二・第三の文書状態を作らないこと。

DD-005の受け入れ基準やスコープ自体は変更しません。

以上を、Phase 2・Phase 3の詳細設計、テスト、DAレビュー、Codexレビューへ反映してください。

---

## 採否・反映先（DD-005 反映記録・2026-07-12）

**評価: 12点すべて採用**（DD-005 受け入れ基準・スコープは不変）。最重要原則「ClientSession だけを Document State の正本とする」を採択。

| # | 論点 | 採否 | 反映先（DD-005 本文） |
|---|------|------|------|
| 1 | 状態所有権の固定 | ✅採用 | 「Phase 2/3 詳細設計・状態所有権」節 状態所有権表 |
| 2 | document-view=Adapter 限定 | ✅採用 | 同節 実装制約 #2 |
| 3 | cell-level beforeRevision | ✅採用（Phase 3 で protocol 対応を検証） | 同節 #3・Phase 3 commit-bridge |
| 4 | 構造Op後 RowId 再解決 | ✅採用 | 同節 #4・AC4・Phase 3 |
| 5 | SetCells/構造Op コスト分離 | ✅採用 | 同節 #5・Phase 2 |
| 6 | 初期 snapshot 計測 | ✅採用 | 同節 #6・Phase 2 タスク・DD-007 引き継ぎ |
| 7 | Commit 順序 | ✅採用 | 同節 #7・Phase 3 commit-bridge |
| 8 | rollback 中 IME 不変 | ✅採用 | 同節 #8・Phase 3 DA・AC2 |
| 9 | 競合表示 headed 確認 | ✅採用 | 同節 #9・Phase 4 証跡・実機ゲート |
| 10 | 設計ゲート（所有権・データフロー提示） | ✅採用 | 同節 データフロー＝実装前ゲート |
| 11 | 既知境界を隠さない | ✅採用（既反映） | Non-Goals・DD-007 引き継ぎ |
| 12 | DD 本文同期 | ✅採用 | 背景・Phase 0 前提チェック・ログ |
