import { describe, expect, it } from 'vitest';

import { displayRowOrder, documentHash } from '@nanairo-sheet/sheet-core';
import {
  Sequencer,
  freshSequencerState,
  serializeSnapshot,
  verifySnapshotIntegrity,
} from '@nanairo-sheet/sheet-server-core';
import { createColumnId } from '@nanairo-sheet/sheet-types';

import {
  generateIntegrationCells,
  integrationColumnOrder,
  seedIntegrationDataset,
  type IntegrationDatasetConfig,
} from './seed-dataset';

const SMALL: IntegrationDatasetConfig = { rows: 200, cols: 20, nonEmpty: 500, seed: 4242, batchSize: 128 };

function seed(config: IntegrationDatasetConfig): Sequencer {
  const columnOrder = integrationColumnOrder(config.cols);
  const sequencer = new Sequencer(freshSequencerState(columnOrder), { now: () => 0 });
  seedIntegrationDataset(sequencer, 'demo-doc', config);
  return sequencer;
}

describe('seed-dataset（DD-005 統合シード・決定論）', () => {
  it('generateIntegrationCells は同一シードで完全一致（決定論）', () => {
    const a = generateIntegrationCells(SMALL);
    const b = generateIntegrationCells(SMALL);
    expect(a).toEqual(b);
    expect(a.length).toBe(SMALL.nonEmpty);
  });

  it('非空セルは (rowId,columnId) が一意で行→列に数値昇順で整列済み', () => {
    const cells = generateIntegrationCells(SMALL);
    const keys = new Set(cells.map((c) => `${String(c.rowId)}/${String(c.columnId)}`));
    expect(keys.size).toBe(cells.length); // 位置は一意（dedup 済み）
    const rowNum = (id: string): number => Number(id.slice('row-'.length));
    const colNum = (id: string): number => Number(id.slice('col-'.length));
    for (let i = 1; i < cells.length; i += 1) {
      const prev = cells[i - 1];
      const cur = cells[i];
      const prevRow = rowNum(String(prev.rowId));
      const curRow = rowNum(String(cur.rowId));
      const ordered = prevRow < curRow || (prevRow === curRow && colNum(String(prev.columnId)) < colNum(String(cur.columnId)));
      expect(ordered).toBe(true); // (row,col) 数値昇順（chunk-store append の前提）
    }
  });

  it('列は col-0..col-(cols-1)', () => {
    const order = integrationColumnOrder(3);
    expect(order).toEqual([createColumnId('col-0'), createColumnId('col-1'), createColumnId('col-2')]);
  });

  it('seed 後の文書は rows 行・非空セル数一致（InsertRows＋SetCells 反映）', () => {
    const sequencer = seed(SMALL);
    const doc = sequencer.document;
    expect(displayRowOrder(doc).length).toBe(SMALL.rows);
    let nonEmpty = 0;
    for (const rowCells of doc.cells.values()) {
      nonEmpty += rowCells.size;
    }
    expect(nonEmpty).toBe(SMALL.nonEmpty);
  });

  it('二重 seed は同一 documentHash（サーバー/クライアント replay の決定論）', () => {
    expect(documentHash(seed(SMALL).document)).toBe(documentHash(seed(SMALL).document));
  });

  it('operationLog を空文書から replay すると seed 文書と一致（= join 時の client replay 経路）', () => {
    const snapshot = serializeSnapshot(seed(SMALL).exportState());
    const integrity = verifySnapshotIntegrity(snapshot);
    expect(integrity.ok).toBe(true);
    expect(integrity.documentHash).toBe(integrity.replayHash);
  });
});
