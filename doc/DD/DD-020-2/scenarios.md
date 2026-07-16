# DD-020-2 テスト設計（Red 先行・自然言語シナリオ）

親=DD-020 / 本子DD=clipboard copy/cut/paste。フル委譲モード（オーケストレータ確認で合意扱い・結果はDDログへ記録）。
検証層: **Phase 1**=core parser/serializer unit＋fuzz＋property（DOM 非依存）／**Phase 2**=grid clipboard-controller unit＋2クライアント収束／**Phase 3**=Playground E2E（実 Clipboard round-trip・Excel 方言注入）＋invariants。

---

## 1. TSV parser 受理仕様表（AC1・`parseClipboardText`）

出力は `string[][]`（矩形とは限らない＝jagged 可）。行区切りは CRLF/LF 両対応、末尾改行1個は行にしない。

| # | 入力（\t=タブ, ␍␊=CRLF, ␊=LF） | 期待 matrix | 論点 |
|---|--------------------------------|-------------|------|
| P-1 | `a\tb␊c\td` | `[[a,b],[c,d]]` | 基本 TSV・LF 行区切り |
| P-2 | `a\tb␍␊c\td` | `[[a,b],[c,d]]` | CRLF 行区切り（Excel 標準） |
| P-3 | `a\tb␍␊` | `[[a,b]]` | 末尾 CRLF1個は空行にしない |
| P-4 | `a\tb␍␊␍␊c` | `[[a,b],[''],[c]]` | 内部の空行は保持（末尾のみ trim） |
| P-5 | `a\t` | `[[a,'']]` | 末尾タブ＝末尾に空セル |
| P-6 | `a\t\tb` | `[[a,'',b]]` | 中間の空セルを保持 |
| P-7 | `"a\tb"\tc` | `[[a\tb,c]]` | 引用内タブは区切りにしない（リテラル） |
| P-8 | `"line1␊line2"\tc` | `[[line1␊line2,c]]` | 引用内改行はセル内改行（行にしない・Excel Alt+Enter） |
| P-9 | `"a""b"` | `[[a"b]]` | 引用内 `""` は 1 個の `"` へアンエスケープ |
| P-10 | `""` | `[['']]` | 空の引用セル＝1 個の空セル |
| P-11 | `abc`（改行なし） | `[[abc]]` | 単一セル・行終端なし |
| P-12 | `` (空文字列) | `[]` | 空クリップボード＝matrix 空（paste は noop） |
| P-13 | `a\tb\tc␊d\te`（列数不整合） | `[[a,b,c],[d,e]]` | jagged 保持（欠けは skip 対象=決定(d)） |
| P-14 | 巨大単一セル（100k 文字） | `[[<100k>]]` | 巨大文字列で壊れない（§20.2） |
| P-15 | `"unterminated`（閉じ引用なし） | `[[unterminated]]` | 寛容: 未終端引用は残りをリテラル扱い |

## 2. serializer 仕様（AC2・`serializeMatrix`）

- 行区切り=CRLF（`\r\n`）、列区切り=タブ。
- **タブ / CR / LF / `"` を含むセルのみ** `"` で引用し、内部 `"` は `""` へエスケープ。それ以外は素通し。
- round-trip: 末尾が空セル/空行でない矩形 M について `parseClipboardText(serializeMatrix(M)) === M`（property test・fuzz 生成）。
  - 既知の非可逆（degenerate）: 末尾行の末尾セルが空だと TSV 曖昧性で復元されない（末尾空 trim 規約）。property 生成器は末尾セルを非空にして回避。

## 3. 型変換境界値（AC4・paste は `parseCellInput` へ委譲）

parser は文字列 matrix を返すのみ。paste 時に各セルを `parseCellInput` で CellScalar 化する（正本は core・DD-012-1）。

| 入力 | 期待 kind | 論点 |
|------|-----------|------|
| `123` / `0` / `-5` | number | 整数 |
| `1,234` / `1,234.5` | number | 3桁区切り |
| `2026-07-16` / `2026/7/3` | date | 実在暦日・正準化 |
| `090-1234-5678` | string | 電話番号（偽陽性防止） |
| `ABC-123` | string | 型番（英字混在） |
| `2026-13-01` | string | 非実在日付 |
| `` (空) | blank | 空セル＝blank |

## 4. paste フロー（clipboard-controller unit・grid）

前提: 表示 index 空間 [0,rowCount)×[0,colCount)。選択は `selectedRange(active)`（DD-020-1）。

| # | 前提選択 | クリップボード matrix | 期待 | AC |
|---|---------|----------------------|------|----|
| C-1 | 単一セル (2,2) | `[[x,y],[z,w]]` | (2,2)左上アンカーから 2×2 貼り付け（4 changes・parseCellInput 適用） | 3/4 |
| C-2 | 範囲 (1,1)〜(3,3)（3×3） | `[[v]]`（1×1） | 選択範囲全体 9 セルへ v を敷き詰め | 7 |
| C-3 | 単一セル (0,0) | `[[v]]`（1×1） | (0,0) の 1 セルのみ（敷き詰めは複数選択時のみ） | 3 |
| C-4 | 単一セル (rowCount-1, 0) | `[[a],[b]]`（2×1） | 下端はみ出し → **全体拒否**（out-of-bounds・submit なし） | 6 |
| C-5 | 単一セル (0, colCount-1) | `[[a,b]]`（1×2） | 右端はみ出し → **全体拒否** | 6 |
| C-6 | 単一セル (0,0) | 501×200 = 100,200 セル | 上限超過 → **実行前拒否**（too-large・submit なし） | 6 |
| C-7 | 単一セル (5,5) | jagged `[[a,b],[c]]` | (5,5)〜(6,6) 矩形のうち欠けセル (6,6) は **skip**（3 changes・空文字上書きしない） | 1/(d) |
| C-8 | 単一セル (3,3) | `[['',x]]`（present 空） | present な空セルは blank 上書き（skip しない＝欠けとは区別） | (d)対比 |
| C-9 | 単一セル (2,2) | `[]`（空 matrix） | noop（submit なし） | — |
| C-10 | 単一セル (0,0) | 型混在 `[[123,2026-07-16,abc]]` | number/date/string を parseCellInput で正しく変換 | 4 |

beforeRevision: 各 change は **paste 実行時点の committed lastChangedRevision**（未書込=0・`captureEditStartRevision` 規約）。
生成 SetCells は `conflictPolicy:'reject-overlap'`（原子・I-5）。

## 5. copy/cut（clipboard-controller unit）

| # | 操作 | 期待 |
|---|------|------|
| CP-1 | 範囲 (0,0)〜(1,1) を copy | 4 セルの表示文字列を TSV 化（`serializeMatrix`）・タブ/改行含みは引用 |
| CP-2 | 未選択（単一セル (0,1)）を copy | 1×1 の TSV（活性セルの表示文字列） |
| CU-1 | 範囲 (0,0)〜(1,1) を cut | copy と同一 TSV＋範囲クリア（`buildRangeClear`＝1 原子 SetCells・非空のみ blank） |
| CU-2 | cut は移動セマンティクスにしない | 貼り付け時に元を消す挙動なし（cut 時点で即クリア・親④） |

## 6. 位相裁定（AC10・`shouldInterceptClipboard`・純関数）

| phase | composing | 期待 |
|-------|-----------|------|
| Navigation | false | **intercept**（グリッド copy/cut/paste） |
| Navigation | true | none（IME 経路・textarea 既定） |
| EditingReplace / EditingExisting / EditingAwaitFinalInput | — | none（textarea テキスト編集＝ブラウザ既定） |
| Composing | — | none（I-3 維持） |

## 7. OCC 競合マトリクス（AC5・2クライアント収束）

| # | 状況 | 期待 |
|---|------|------|
| O-1 | A が範囲 paste（offline）→ B が範囲内 1 セルを先行確定 → A 再接続 | A の SetCells 全体 reject・部分適用なし・文書無変更・A/B hash 一致・rejected 通知 |
| O-2 | A が範囲 paste → 範囲外セルを B が変更 | A の paste は受理（範囲外の変更は競合しない＝セル単位 beforeRevision） |
| O-3 | 上限/はみ出し拒否 | SetCells を送らない（committedRevision・pendingCount 不変）・公開 code 通知 |

## 8. IME 非干渉（AC10・invariants＋E2E）

| # | 操作 | 期待 |
|---|------|------|
| I-1 | composition 中に paste イベント（合成） | グリッド paste 発火せず・draft/composing/textarea 不変（I-3）・確定後は通常 commit 可 |
| I-2 | 編集中（EditingReplace）に paste | textarea へテキスト挿入（ブラウザ既定）・グリッド Command 化しない |

## 9. standalone（AC9・E2E）

| # | 操作 | 期待 |
|---|------|------|
| S-1 | standalone で範囲 paste | cell-commit（SetCells batch 単位）発火・利用側保存契約（DD-024）成立・server 系イベント 0 |
| S-2 | standalone で cut | 範囲クリアの cell-commit（before/after 表示文字列）発火 |

## 10. fixture 一覧（`doc/DD/DD-020-2/fixtures/`・実 Excel text/plain 方言の書き起こし＝L5 証跡）

`.gitattributes` で `-text`（EOL 無変換・byte 完全）保護。EOL 依存の厳密検証は test 内の明示エスケープ定数で決定化し、fixture はファイル経由 parse の実証と人間可読な証跡を担う。

| ファイル | 内容 | 検証観点 |
|---------|------|---------|
| `excel-numbers-dates.tsv` | 数値・日付・桁区切りの矩形 | 型変換素材（P-1/型変換表） |
| `excel-cell-newline.tsv` | 引用セル内改行（Alt+Enter 相当）＋通常セル | P-8（引用内改行） |
| `excel-empty-trailing.tsv` | 空セル・末尾タブ・空行 | P-4/P-5/P-6 |
| `excel-quotes.tsv` | `""` エスケープ・引用内タブ | P-7/P-9 |
| `jagged.tsv` | 列数不整合（手書きテキスト相当） | P-13/(d) skip |

## 再現コマンド

- Phase 1: `npm run test -w @nanairo-sheet/core`（clipboard-text）
- Phase 2: `npm run test -w @nanairo-sheet/grid`（clipboard-controller）＋ `npm run test`（全 workspace）
- Phase 3: `cd apps/playground && npx playwright test clipboard` ＋ `npm run test:invariants`
