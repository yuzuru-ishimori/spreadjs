// P2-1 回帰ガード（DD-021-3 AC7/AC8）。厳密な実測は apps/pocd-bench の bench:row-insert（DD へ記録）。
// ここでは CI 常設できるよう「決定論の非退行」と「緩いヘッドルーム時間ガード（親⑤上限を天井にする）」だけを見る。
//
// maxSlot キャッシュ（O(1) 採番）が決定論（同一ログ→同一 hash・同一 slot 割当）を壊さないこと、および
// snapshot round-trip 後も採番カーソルが健全（重複 slot を作らない）ことを固定する。

import { describe, expect, it } from 'vitest';

import { applyOperation, replayAcceptedOperations } from './apply';
import { createDocument, slotOf } from './document';
import { deserializeDocument, serializeDocument } from './document-snapshot';
import { documentHash } from './hash';
import type { DocumentOperation } from './operations';
import { createColumnId, createRowId } from '@nanairo-sheet/types';

const cols = () => [createColumnId('c-0'), createColumnId('c-1'), createColumnId('c-2')];

function singleInsertLog(count: number, startAfter: string | null): DocumentOperation[] {
  const ops: DocumentOperation[] = [];
  let anchor = startAfter;
  for (let i = 0; i < count; i += 1) {
    const rowId = `row-${i}`;
    ops.push({ type: 'insertRows', afterRowId: anchor === null ? null : createRowId(anchor), rows: [{ rowId: createRowId(rowId) }] });
    anchor = rowId;
  }
  return ops;
}

describe('P2-1 apply 性能是正（DD-021-3・maxSlot O(1) 採番）', () => {
  it('決定論: 同一の単一行 Insert ログを replay しても hash / slot 割当が一致する', () => {
    const log = singleInsertLog(300, null).map((operation, i) => ({ operation, revision: 2 + i }));
    const a = replayAcceptedOperations(createDocument(cols()), log);
    const b = replayAcceptedOperations(createDocument(cols()), log);
    expect(documentHash(a)).toBe(documentHash(b));
    // slot は連番（0..N-1）で一意（maxSlot キャッシュが scan と同一結果を出す）。
    const slots = a.rowOrder.map((r) => slotOf(a, r));
    expect(new Set(slots).size).toBe(slots.length);
    expect(Math.max(...slots.map((s) => s ?? -1))).toBe(a.rowOrder.length - 1);
  });

  it('決定論: per-op clone 経路（applyOperation）と replay 経路が同一 hash に収束する', () => {
    const log = singleInsertLog(200, null);
    let perOp = createDocument(cols());
    log.forEach((op, i) => {
      perOp = applyOperation(perOp, op, { revision: 2 + i }).document;
    });
    const replay = replayAcceptedOperations(
      createDocument(cols()),
      log.map((operation, i) => ({ operation, revision: 2 + i })),
    );
    expect(documentHash(perOp)).toBe(documentHash(replay));
  });

  it('snapshot round-trip 後の Insert が重複 slot を作らない（maxSlot 再計算の健全性）', () => {
    const built = replayAcceptedOperations(
      createDocument(cols()),
      singleInsertLog(50, null).map((operation, i) => ({ operation, revision: 2 + i })),
    );
    const restored = deserializeDocument(serializeDocument(built));
    // 復元後に更に挿入 → 既存 slot と衝突しないこと。
    const after = applyOperation(
      restored,
      { type: 'insertRows', afterRowId: null, rows: [{ rowId: createRowId('extra') }] },
      { revision: 100 },
    ).document;
    const slots = [...after.rowMeta.values()].map((m) => m.slot);
    expect(new Set(slots).size).toBe(slots.length); // 全 slot 一意
    expect(slotOf(after, createRowId('extra'))).toBe(built.maxSlot + 1); // 単調に採番
  });

  it('緩い時間ガード: 50,000 行 + 単一行 Insert×1,000（replay 経路）が親⑤上限 2s 内（ヘッドルーム大）', () => {
    // seed 50k 行（計測対象外）。
    const seedIds = Array.from({ length: 50_000 }, (_, i) => ({ rowId: createRowId(`s-${i}`) }));
    let doc = applyOperation(createDocument(cols()), { type: 'insertRows', afterRowId: null, rows: seedIds }, { revision: 1 }).document;
    let anchor = doc.rowOrder[doc.rowOrder.length - 1] ?? null;
    const t0 = performance.now();
    for (let i = 0; i < 1_000; i += 1) {
      const rowId = createRowId(`ins-${i}`);
      doc = replayAcceptedOperations(doc, [{ operation: { type: 'insertRows', afterRowId: anchor, rows: [{ rowId }] }, revision: 2 + i }]);
      anchor = rowId;
    }
    const elapsed = performance.now() - t0;
    // 親⑤上限=2s を CI 天井に使う（実測 ~130ms・約 15 倍ヘッドルーム。厳密値は bench:row-insert を DD 記録）。
    expect(elapsed).toBeLessThan(2_000);
    expect(doc.rowOrder.length).toBe(51_000);
  });
});
