// ③列指向配列型（密データ向け）— ADR-011 ③。
// 列ごとに rows 長の密配列を確保する。全て正準数値の列は Float64Array + present マスクで持つ
// （数値列のメモリ効率）。それ以外は通常の (string|undefined)[]。
// get は「元の文字列」を厳密復元する: 数値列は String(Number)===元 の正準生成前提（data-gen）で
// String(number) を返すため等価性を壊さない。非正準値が set されたら該当列を文字列列へ変換する。

import {
  BYTES_PER_CHAR,
  type CellStoreCandidate,
  type CellStoreConfig,
  type GeneratedCell,
  type RangeVisitor,
} from '../cell-store';

interface StringColumn {
  kind: 'string';
  data: (string | undefined)[];
}
interface NumberColumn {
  kind: 'number';
  data: Float64Array;
  present: Uint8Array;
}
type Column = StringColumn | NumberColumn;

/** String(Number(s))===s を満たす正準数値文字列か。 */
export function isCanonicalNumber(s: string): boolean {
  if (s === '') return false;
  const n = Number(s);
  return Number.isFinite(n) && String(n) === s;
}

export function createColumnarStore(config: CellStoreConfig): CellStoreCandidate {
  const { rows, cols } = config;
  const columns = new Array<Column | undefined>(cols);
  let nonEmpty = 0;
  let valueChars = 0; // 文字列列の値文字数
  let numberColCount = 0;
  let stringColCount = 0;

  const materializeString = (col: number): StringColumn => {
    const c: StringColumn = { kind: 'string', data: new Array<string | undefined>(rows) };
    columns[col] = c;
    stringColCount += 1;
    return c;
  };

  const convertNumberToString = (col: number, numCol: NumberColumn): StringColumn => {
    const data = new Array<string | undefined>(rows);
    for (let i = 0; i < rows; i += 1) {
      if (numCol.present[i]) {
        const s = String(numCol.data[i]);
        data[i] = s;
        valueChars += s.length;
      }
    }
    const c: StringColumn = { kind: 'string', data };
    columns[col] = c;
    numberColCount -= 1;
    stringColCount += 1;
    return c;
  };

  const setInternal = (row: number, col: number, value: string): void => {
    const existing = columns[col];
    if (value === '') {
      if (existing === undefined) return;
      if (existing.kind === 'string') {
        const prev = existing.data[row];
        if (prev !== undefined) {
          valueChars -= prev.length;
          existing.data[row] = undefined;
          nonEmpty -= 1;
        }
      } else if (existing.present[row]) {
        existing.present[row] = 0;
        nonEmpty -= 1;
      }
      return;
    }
    if (existing === undefined) {
      const c = materializeString(col);
      c.data[row] = value;
      valueChars += value.length;
      nonEmpty += 1;
      return;
    }
    if (existing.kind === 'number') {
      if (isCanonicalNumber(value)) {
        if (!existing.present[row]) nonEmpty += 1;
        existing.present[row] = 1;
        existing.data[row] = Number(value);
        return;
      }
      const c = convertNumberToString(col, existing);
      const prev = c.data[row];
      if (prev === undefined) nonEmpty += 1;
      else valueChars -= prev.length;
      c.data[row] = value;
      valueChars += value.length;
      return;
    }
    // string column
    const prev = existing.data[row];
    if (prev === undefined) nonEmpty += 1;
    else valueChars -= prev.length;
    existing.data[row] = value;
    valueChars += value.length;
  };

  return {
    label: 'columnar',
    get(row, col) {
      const column = columns[col];
      if (column === undefined) return '';
      if (column.kind === 'string') return column.data[row] ?? '';
      return column.present[row] ? String(column.data[row]) : '';
    },
    set(row, col, value) {
      setInternal(row, col, value);
    },
    bulkLoad(cells) {
      // まだ未確保の列は列単位でまとめ、全て正準数値なら Float64Array 列にする。
      const buckets = new Map<number, GeneratedCell[]>();
      for (const cell of cells) {
        if (cell.value === '') continue;
        if (columns[cell.col] !== undefined) {
          setInternal(cell.row, cell.col, cell.value);
          continue;
        }
        let b = buckets.get(cell.col);
        if (b === undefined) {
          b = [];
          buckets.set(cell.col, b);
        }
        b.push(cell);
      }
      for (const [col, colCells] of buckets) {
        const allNumeric = colCells.every((c) => isCanonicalNumber(c.value));
        if (allNumeric) {
          const data = new Float64Array(rows);
          const present = new Uint8Array(rows);
          for (const c of colCells) {
            data[c.row] = Number(c.value);
            present[c.row] = 1;
          }
          columns[col] = { kind: 'number', data, present };
          numberColCount += 1;
        } else {
          const data = new Array<string | undefined>(rows);
          for (const c of colCells) {
            data[c.row] = c.value;
            valueChars += c.value.length;
          }
          columns[col] = { kind: 'string', data };
          stringColCount += 1;
        }
        nonEmpty += colCells.length;
      }
    },
    queryRange(rowStart, rowEnd, colStart, colEnd, visit: RangeVisitor) {
      if (rowEnd <= rowStart || colEnd <= colStart) return 0;
      let visited = 0;
      for (let col = colStart; col < colEnd; col += 1) {
        const column = columns[col];
        if (column === undefined) continue;
        if (column.kind === 'string') {
          for (let row = rowStart; row < rowEnd; row += 1) {
            const value = column.data[row];
            if (value !== undefined) {
              visit(row, col, value);
              visited += 1;
            }
          }
        } else {
          for (let row = rowStart; row < rowEnd; row += 1) {
            if (column.present[row]) {
              visit(row, col, String(column.data[row]));
              visited += 1;
            }
          }
        }
      }
      return visited;
    },
    nonEmptyCount() {
      return nonEmpty;
    },
    approxMemoryBytes() {
      // 数値列: Float64Array(rows*8)+present(rows*1)。文字列列: 参照(rows*8)+値文字。
      return (
        numberColCount * rows * 9 +
        stringColCount * rows * 8 +
        valueChars * BYTES_PER_CHAR
      );
    },
  };
}
