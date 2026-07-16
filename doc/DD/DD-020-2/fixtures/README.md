# DD-020-2 TSV fixtures（実 Excel text/plain 方言の書き起こし）

`parseClipboardText` が受理すべき TSV 方言の実ペイロード見本（L5 証跡）。`.gitattributes` の `-text` で
EOL 無変換（byte 完全）に固定している（引用内改行・CRLF 行区切りの検証が git の LF↔CRLF 変換で崩れないため）。

厳密な byte 検証は `packages/core/src/clipboard-text.test.ts` の明示エスケープ定数で決定化し、本 fixture は
「ファイル経由 parse が実 Excel 方言で成立する」ことの実証と、人間が方言を目視確認するための証跡を担う。

| ファイル | バイト内容（\t=タブ, ␍␊=CRLF, ␊=LF） | 方言 |
|---------|------------------------------------|------|
| `jagged.tsv` | `a\tb\tc␊d␊e\tf␊` | 列数不整合（3/1/2 列）＝欠けセルは paste で skip（決定(d)） |
| `excel-quotes.tsv` | `"a""b"\tc␍␊"tab␉inside"\td␍␊` | `""` エスケープ・引用内タブ |
| `excel-numbers-dates.tsv` | `1\t2026-07-16\t1,234␍␊-5\t2026/7/3\t90-1234-5678␍␊` | 数値/日付/桁区切り（型変換素材・電話番号は string） |
| `excel-cell-newline.tsv` | `"line1␊line2"\tplain␍␊x\ty␍␊` | 引用セル内改行（Excel Alt+Enter 相当） |
| `excel-empty-trailing.tsv` | `a\t\tb␍␊p\t␍␊␍␊z␍␊` | 空セル・末尾タブ・空行 |

再現: `bash` で `printf` により生成（DD-020-2 Phase 1 ログ参照）。
