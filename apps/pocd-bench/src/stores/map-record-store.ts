// 参考: 二段 Map × CellRecord（DD-010 移行 **前** の製品文書表現＝Map<RowId, Map<ColumnId, CellRecord>>）。
// AC6 の再検討用。DD-006 の chunked-rowslot（文字列格納の PoC ストア）ではなく、**製品が実際に持っていた
// 値モデル（CellRecord = CellScalar + lastChangedRevision）** を二段 Map で保持したときの桁を測り、
// slot キー CellStore（chunked-rowslot-stable）が「移行前の製品表現」に対して回帰していないことを示す。
// row=RowId・col=ColumnId の代理として number をキーに使う（構造の桁比較が目的）。

import { type CellStoreCandidate } from '../cell-store';

// 移行前 core の CellRecord と **同一のオブジェクト形状**（value=判別ユニオン{kind,value} と
// lastChangedRevision の入れ子＝1 セルあたりオブジェクト 2 個）。heap 比較を等価にするため（DD-010 Codex[P2]）。
interface Rec {
  value: { kind: 'string'; value: string };
  lastChangedRevision: number;
}

function makeRec(value: string): Rec {
  return { value: { kind: 'string', value }, lastChangedRevision: 1 };
}

// 引数なし（CellStoreFactory へは引数の少ない関数として代入可能）。map-record は次元設定を使わない。
export function createMapRecordStore(): CellStoreCandidate {
  // 二段 Map（行→(列→CellRecord)）。移行前 core の cells 表現（Map<RowId,Map<ColumnId,CellRecord>>）と同型。
  const rows = new Map<number, Map<number, Rec>>();
  let count = 0;

  return {
    label: 'map-record',
    get(row, col) {
      return rows.get(row)?.get(col)?.value.value ?? '';
    },
    set(row, col, value) {
      let rowMap = rows.get(row);
      if (value === '') {
        if (rowMap?.delete(col)) count -= 1;
        return;
      }
      if (rowMap === undefined) {
        rowMap = new Map();
        rows.set(row, rowMap);
      }
      if (!rowMap.has(col)) count += 1;
      rowMap.set(col, makeRec(value));
    },
    bulkLoad(cells) {
      for (const cell of cells) {
        if (cell.value === '') continue;
        let rowMap = rows.get(cell.row);
        if (rowMap === undefined) {
          rowMap = new Map();
          rows.set(cell.row, rowMap);
        }
        if (!rowMap.has(cell.col)) count += 1;
        rowMap.set(cell.col, makeRec(cell.value));
      }
    },
    queryRange(rowStart, rowEnd, colStart, colEnd, visit) {
      if (rowEnd <= rowStart || colEnd <= colStart) return 0;
      let visited = 0;
      for (let row = rowStart; row < rowEnd; row += 1) {
        const rowMap = rows.get(row);
        if (rowMap === undefined) continue;
        for (const [col, rec] of rowMap) {
          if (col < colStart || col >= colEnd) continue;
          visit(row, col, rec.value.value);
          visited += 1;
        }
      }
      return visited;
    },
    nonEmptyCount() {
      return count;
    },
    approxMemoryBytes() {
      // CellRecord 入れ子オブジェクト（2 個）＋列 Map ＋行 Map の概算。CellStore の概算係数と桁を揃える。
      let valueChars = 0;
      for (const rowMap of rows.values()) {
        for (const rec of rowMap.values()) valueChars += rec.value.value.length;
      }
      // 概算: 値文字×2 ＋ セルあたり CellRecord/CellScalar/Map エントリ ~64B ＋ 行 Map ~64B。
      return valueChars * 2 + count * 64 + rows.size * 64;
    },
  };
}
