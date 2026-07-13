// 共同編集 不変条件スイート（§2.3 共同編集不変条件）。DD-011 設置・実充足は DD-013/014/015。
//
// 最小ケース: サーバーが確定した全順序 Operation ログを、2つの独立ドキュメントへ replay すると
// canonical hash が一致する（§2.3「サーバー全順序とクライアント最終hash一致」＋決定論的適用）。
// Room/transport を立てるフル収束・reconnect fault injection は DD-013/015。
import { describe, expect, it } from 'vitest';

import { applyOperation, createDocument, documentHash } from '@nanairo-sheet/core';
import type { DocumentOperation, SheetDocument } from '@nanairo-sheet/core';
import { COLUMNS, col, insertRows, row, setCells, str } from '@nanairo-sheet/collab/test-support';

// サーバー確定順（全順序）を1本のログとして定義する。
const orderedLog: DocumentOperation[] = [
  insertRows(null, ['r1']),
  insertRows(row('r1'), ['r2']),
  setCells([{ rowId: row('r1'), columnId: col('col-a'), value: str('あ') }]),
  setCells([{ rowId: row('r2'), columnId: col('col-b'), value: str('い') }]),
  setCells([{ rowId: row('r1'), columnId: col('col-a'), value: str('あ2') }]),
];

/** 全順序ログを空文書へ畳み込む（revision はサーバー付与＝1..n）。 */
function replay(log: DocumentOperation[]): SheetDocument {
  let doc = createDocument([...COLUMNS]);
  let revision = 0;
  for (const op of log) {
    revision += 1;
    doc = applyOperation(doc, op, { revision }).document;
  }
  return doc;
}

describe('invariant/collab: 全順序 → クライアント最終 hash 一致', () => {
  it('同一の全順序ログを独立2ドキュメントへ replay すると canonical hash が一致する', () => {
    const clientA = replay(orderedLog);
    const clientB = replay(orderedLog);
    expect(documentHash(clientA)).toBe(documentHash(clientB));
  });

  it('適用は決定論的: 同一ログの再 replay で同じ hash（replay/収束の前提）', () => {
    const first = documentHash(replay(orderedLog));
    const second = documentHash(replay(orderedLog));
    expect(second).toBe(first);
  });
});
