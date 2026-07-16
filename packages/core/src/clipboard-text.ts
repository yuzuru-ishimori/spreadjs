// clipboard-text（DD-020-2 Phase 1）: クリップボード TSV の parser / serializer（純関数・依存ゼロ・fuzz 可能）。
//
// 【設計方針】
// - **DOM・時刻・乱数に依存しない純粋関数**（core 所有＝クリップボード外部入力の正準変換。計画書 §20.1）。
// - 型変換（number/date/string）はここでは行わない。parser は文字列 matrix を返すだけで、paste 側が
//   `parseCellInput`（型変換の正本・DD-012-1）へ 1 セルずつ委譲する（責務分離・偽陽性の一元管理）。
// - 引用/改行/巨大文字列は fuzz 対象（§20.2）。serialize→parse の round-trip を property test で担保する。
//
// 【TSV 方言（受理・parseClipboardText）】計画書 §20.1・scenarios.md §1:
//   - 列区切り=タブ（\t）／行区切り=CRLF または LF（lone CR も防御的に行区切り）。末尾改行 1 個は行にしない。
//   - `"` 引用セル: セル先頭の `"` から開始し、引用内のタブ/改行は**リテラル**（区切りにしない）、`""` は 1 個の
//     `"` へアンエスケープ。閉じ `"` で引用終了。非先頭の `"` はリテラル文字（Excel は引用セルを必ず先頭から引用する）。
//   - 未終端引用（閉じ `"` が来ない）は寛容に「残りをリテラル扱い」で確定する（データを失わない）。
//   - 空文字列は matrix 空 `[]`（paste は noop）。列数不整合（jagged）は行ごとの列数のまま保持する。
//
// 【serialize（serializeMatrix）】scenarios.md §2:
//   - 行区切り=CRLF（Excel 互換）／列区切り=タブ。タブ / CR / LF / `"` を含むセルのみ `"` 引用し、内部 `"` は `""`。
//   - 値は表示文字列（cell-commit の value と同じ round-trip 規約）。round-trip は「末尾列が非空」の矩形で保存される
//     （末尾が空セル/空行のときは TSV の末尾 trim 曖昧性で復元されない＝既知の degenerate・§2 注記）。

/**
 * クリップボード TSV テキストを矩形（jagged 可）の文字列 matrix へ解析する（DD-020-2 AC1）。
 * 型変換はしない（呼び出し側が parseCellInput へ委譲する）。空文字列は `[]`。
 */
export function parseClipboardText(text: string): string[][] {
  if (text === '') {
    return [];
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  // 現在の行境界以降、実在するセルの蓄積を始めたか（引用開始 or 文字追加）。末尾判定に使う:
  // `""`（引用空セル）は cell='' でも「実在する空セル」として確定し、末尾改行 1 個の空行と区別する。
  let cellStarted = false;
  let i = 0;
  const n = text.length;

  const endCell = (): void => {
    row.push(cell);
    cell = '';
    cellStarted = false; // セルを row へ確定 → 次セルは未開始
  };
  const endRow = (): void => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        // 引用内の `""` は 1 個の `"`（エスケープ）。単独の `"` は引用終了。
        if (i + 1 < n && text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      // 引用内のタブ/改行はリテラル（区切りにしない・Excel Alt+Enter のセル内改行を保持）。
      cell += ch;
      i += 1;
      continue;
    }
    // 非引用状態。
    if (ch === '"' && cell === '') {
      // セル先頭の `"` のみ引用開始（非先頭の `"` はリテラル文字＝下の default で積む）。
      inQuotes = true;
      cellStarted = true; // 引用空セル `""` を実在セルとして確定するため
      i += 1;
      continue;
    }
    if (ch === '\t') {
      endCell();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      endRow();
      // CRLF は 2 文字で 1 区切り。lone CR（古い Mac 方言）は 1 文字で 1 区切り（防御）。
      i += i + 1 < n && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch;
    cellStarted = true;
    i += 1;
  }

  // 末尾の pending 行を確定する。ただし入力がちょうど行区切りで終わった場合（実在セル無し）は末尾の
  // 空行を作らない（末尾改行 1 個は行にしない・P-3）。末尾タブ（row に確定済みセルあり）・末尾非改行・
  // 引用空セル（cellStarted）は確定する。
  if (cellStarted || cell !== '' || row.length > 0) {
    endRow();
  }
  return rows;
}

/** タブ / CR / LF / `"` を含むセルのみ引用が必要（内部 `"` は `""` へエスケープ）。 */
function needsQuoting(value: string): boolean {
  return value.includes('\t') || value.includes('\n') || value.includes('\r') || value.includes('"');
}

function serializeCell(value: string): string {
  if (needsQuoting(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * 文字列 matrix を クリップボード TSV テキストへ直列化する（DD-020-2 AC2）。
 * 行区切り=CRLF・列区切り=タブ。特殊文字（タブ/改行/`"`）を含むセルのみ `"` 引用する。
 */
export function serializeMatrix(matrix: readonly (readonly string[])[]): string {
  return matrix.map((row) => row.map(serializeCell).join('\t')).join('\r\n');
}
