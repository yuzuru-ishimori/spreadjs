import { describe, expect, it } from 'vitest';

import { documentHash, getCell, isTombstoned } from '@nanairo-sheet/sheet-core';

import { Sequencer, freshSequencerState } from './sequencer';
import type { SequencerState } from './sequencer';
import {
  SNAPSHOT_VERSION,
  deserializeSnapshot,
  serializeSnapshot,
  verifySnapshotIntegrity,
} from './snapshot';
import type { SnapshotData } from './snapshot';
import {
  COLUMNS,
  col,
  createManualClock,
  deleteRows,
  envelope,
  insertRows,
  row,
  setCells,
  str,
} from './test-support';

// row-1..3・いくつかのセル・削除・no-op を含む Sequencer を作る（現実的な状態）。
function buildSequencer(): Sequencer {
  const seq = new Sequencer(freshSequencerState(COLUMNS), createManualClock(1000));
  seq.submit(envelope({ clientId: 'cA', clientSequence: 1, operationId: 'i1', operation: insertRows(null, ['row-1']) }));
  seq.submit(envelope({ clientId: 'cA', clientSequence: 2, operationId: 'i2', operation: insertRows(row('row-1'), ['row-2']) }));
  seq.submit(envelope({ clientId: 'cA', clientSequence: 3, operationId: 's1', operation: setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('hello') }]) }));
  seq.submit(envelope({ clientId: 'cB', clientSequence: 1, operationId: 'd1', operation: deleteRows([row('row-2')]) }));
  seq.submit(envelope({ clientId: 'cB', clientSequence: 2, operationId: 'noop1', operation: deleteRows([row('row-2')]) })); // no-op（再 Delete）
  return seq;
}

// JSON 直列化の往復（実シリアライズ経路の再現）。deserializeSnapshot の入力は SnapshotData。
function jsonRoundTrip(data: SnapshotData): SnapshotData {
  const restored: SnapshotData = JSON.parse(JSON.stringify(data));
  return restored;
}

// DD-010 CG-2 証拠用: tombstone 行が **セルを保持**した状態・削除済みアンカーへの挿入を含む Sequencer。
// InsertRows/DeleteRows/tombstone/削除済みアンカー挿入を全て通し、round-trip・replay の安定 ID 整合を検証する。
function buildStableIdSequencer(): Sequencer {
  const seq = new Sequencer(freshSequencerState(COLUMNS), createManualClock(1000));
  seq.submit(envelope({ clientId: 'cA', clientSequence: 1, operationId: 'i1', operation: insertRows(null, ['row-1']) }));
  seq.submit(envelope({ clientId: 'cA', clientSequence: 2, operationId: 'i2', operation: insertRows(row('row-1'), ['row-2']) }));
  seq.submit(envelope({ clientId: 'cA', clientSequence: 3, operationId: 'i3', operation: insertRows(row('row-2'), ['row-3']) }));
  seq.submit(envelope({ clientId: 'cA', clientSequence: 4, operationId: 's1', operation: setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('one') }]) }));
  seq.submit(envelope({ clientId: 'cA', clientSequence: 5, operationId: 's2', operation: setCells([{ rowId: row('row-2'), columnId: col('col-a'), value: str('two') }]) }));
  seq.submit(envelope({ clientId: 'cA', clientSequence: 6, operationId: 's3', operation: setCells([{ rowId: row('row-3'), columnId: col('col-b'), value: str('three') }]) }));
  // row-2 を tombstone（row-2 はセル 'two' を保持したまま）。
  seq.submit(envelope({ clientId: 'cB', clientSequence: 1, operationId: 'd1', operation: deleteRows([row('row-2')]) }));
  // 削除済みアンカー row-2 の直後へ新行 row-new を挿入（S-D2）。
  seq.submit(envelope({ clientId: 'cB', clientSequence: 2, operationId: 'i4', operation: insertRows(row('row-2'), ['row-new']) }));
  seq.submit(envelope({ clientId: 'cB', clientSequence: 3, operationId: 's4', operation: setCells([{ rowId: row('row-new'), columnId: col('col-c'), value: str('new') }]) }));
  return seq;
}

describe('K. スナップショット export/import（S-K1/K2）', () => {
  it('S-K1: export は document/log/currentRevision/ackCache/clientSequenceTable を全部含む', () => {
    const seq = buildSequencer();
    const data = serializeSnapshot(seq.exportState());
    expect(data.currentRevision).toBe(4); // accepted 4 件（no-op は非消費）
    expect(data.operationLog.map((e) => e.revision)).toEqual([1, 2, 3, 4]); // 連続・no-op 非追記
    // ackCache に no-op の ACK も含む（ログから再構築できない＝明示 export 必須・指示 5/DA D17）
    expect(data.ackCache.map((a) => a.operationId).sort()).toEqual(['d1', 'i1', 'i2', 'noop1', 's1']);
    expect(data.ackCache.find((a) => a.operationId === 'noop1')?.revision).toBe(4); // no-op ACK=処理時 currentRevision
    expect(data.clientSequenceTable).toEqual(
      expect.arrayContaining([
        { clientId: 'cA', lastSequence: 3 },
        { clientId: 'cB', lastSequence: 2 },
      ]),
    );
  });

  it('S-K2: import した文書の hash が停止前と一致（構築経路非依存・S-B2 と同根）', () => {
    const seq = buildSequencer();
    const hashBefore = documentHash(seq.document);
    const data = jsonRoundTrip(serializeSnapshot(seq.exportState()));
    const restored = new Sequencer(deserializeSnapshot(data), createManualClock());
    expect(documentHash(restored.document)).toBe(hashBefore);
    expect(restored.currentRevision).toBe(seq.currentRevision);
  });

  it('整合検証: document hash == ログ replay hash（DA D7・no-op はログに無いが一致）', () => {
    const seq = buildSequencer();
    const data = jsonRoundTrip(serializeSnapshot(seq.exportState()));
    const result = verifySnapshotIntegrity(data);
    expect(result.ok).toBe(true);
    expect(result.documentHash).toBe(result.replayHash);
  });
});

describe('K. 復元後の継続（S-K3/K4）', () => {
  it('S-K4: 復元後の新規 Operation は revision R+1 から継続（単調維持）', () => {
    const seq = buildSequencer(); // currentRevision=4
    const data = jsonRoundTrip(serializeSnapshot(seq.exportState()));
    const restored = new Sequencer(deserializeSnapshot(data), createManualClock());
    const outcome = restored.submit(envelope({ clientId: 'cA', clientSequence: 4, operationId: 'new', operation: setCells([{ rowId: row('row-1'), columnId: col('col-b'), value: str('after') }]) }));
    expect(outcome.status).toBe('accepted');
    if (outcome.status !== 'accepted') throw new Error('unreachable');
    expect(outcome.ack.revision).toBe(5); // R+1
    expect(restored.currentRevision).toBe(5);
  });

  it('S-K3 基盤: 復元後 operationsSince(R\') が R\'+1..R を返す（再接続 catch-up の材料）', () => {
    const seq = buildSequencer();
    const data = jsonRoundTrip(serializeSnapshot(seq.exportState()));
    const restored = new Sequencer(deserializeSnapshot(data), createManualClock());
    expect(restored.operationsSince(2).map((e) => e.revision)).toEqual([3, 4]);
  });
});

describe('CG-2 証拠（DD-010）: 安定 ID serialization round-trip・replay 整合', () => {
  it('[AC3] serialize→JSON→deserialize round-trip で hash・構造（rowOrder/tombstone/slot/revision）一致', () => {
    const seq = buildStableIdSequencer();
    const hashBefore = documentHash(seq.document);
    const before = seq.document;
    const data = jsonRoundTrip(serializeSnapshot(seq.exportState()));
    expect(data.version).toBe(SNAPSHOT_VERSION);
    const restored = new Sequencer(deserializeSnapshot(data), createManualClock());
    const after = restored.document;

    // hash 一致
    expect(documentHash(after)).toBe(hashBefore);
    // 構造一致: rowOrder（tombstone 含む全行）
    expect(after.rowOrder.map(String)).toEqual(before.rowOrder.map(String));
    // rowMeta: slot / tombstone / lastChangedRevision
    for (const rowId of before.rowOrder) {
      const b = before.rowMeta.get(rowId)!;
      const a = after.rowMeta.get(rowId)!;
      expect(a.slot).toBe(b.slot);
      expect(a.tombstone).toBe(b.tombstone);
      expect(a.lastChangedRevision).toBe(b.lastChangedRevision);
    }
    // 全セル一致（tombstone 行 row-2 のセル 'two' も保全されていること＝安定 ID 保全の核）
    for (const rowId of before.rowOrder) {
      for (const columnId of before.columnOrder) {
        expect(getCell(after, rowId, columnId)).toEqual(getCell(before, rowId, columnId));
      }
    }
    expect(isTombstoned(after, row('row-2'))).toBe(true);
    expect(getCell(after, row('row-2'), col('col-a'))).toEqual({ value: str('two'), lastChangedRevision: 5 });
    expect(after.revision).toBe(before.revision);
  });

  it('[AC4] 空文書から operationLog 全 replay → 復元文書と hash・構造一致・revision 連番・二重適用なし', () => {
    const seq = buildStableIdSequencer();
    const data = jsonRoundTrip(serializeSnapshot(seq.exportState()));
    const result = verifySnapshotIntegrity(data);
    expect(result.ok).toBe(true);
    expect(result.documentHash).toBe(result.replayHash);
    // revision 連番（1..N・currentRevision===N）
    expect(data.operationLog.map((e) => e.revision)).toEqual(
      Array.from({ length: data.operationLog.length }, (_v, i) => i + 1),
    );
    expect(data.currentRevision).toBe(data.operationLog.length);
    expect(data.document.revision).toBe(data.currentRevision);
  });

  it('[要確認2] version 不一致の snapshot は deserialize で fail-fast（互換層なし・ADR-0015）', () => {
    const seq = buildStableIdSequencer();
    const data = jsonRoundTrip(serializeSnapshot(seq.exportState()));
    const legacy = { ...data, version: 1 } as unknown as SnapshotData;
    expect(() => deserializeSnapshot(legacy)).toThrow(/version/);
  });

  it('[Codex P2] 重複 slot の snapshot は deserialize で fail-fast（安定 ID 破損検知）', () => {
    const seq = buildStableIdSequencer();
    const data = jsonRoundTrip(serializeSnapshot(seq.exportState()));
    // 2 行に同一 slot を割り当てて安定 ID を破損させる。
    if (data.document.rowMeta.length >= 2) {
      data.document.rowMeta[1]!.slot = data.document.rowMeta[0]!.slot;
    }
    expect(() => deserializeSnapshot(data)).toThrow(/slot/);
  });

  it('[Codex P2] rowMeta に無い行のセルを含む snapshot は deserialize で fail-fast（データ欠落を黙認しない）', () => {
    const seq = buildStableIdSequencer();
    const data = jsonRoundTrip(serializeSnapshot(seq.exportState()));
    data.document.cells.push({ rowId: 'ghost-row', columns: [{ columnId: 'col-a', value: str('x'), lastChangedRevision: 1 }] });
    expect(() => deserializeSnapshot(data)).toThrow(/rowMeta/);
  });
});

describe('K. 復元後の再送整合（DA 重点: ackCache/clientSequence 欠落での誤 reject 経路を塞ぐ）', () => {
  it('復元後、既 ACK 済み op の再送は duplicate（二重適用せず同一 ACK・誤 reject しない）', () => {
    const seq = buildSequencer();
    const data = jsonRoundTrip(serializeSnapshot(seq.exportState()));
    const restored = new Sequencer(deserializeSnapshot(data), createManualClock());
    // 's1'（rev=3 で ACK 済み）を復元後に再送 → duplicate・同一 revision
    const resend = restored.submit(envelope({ clientId: 'cA', clientSequence: 3, operationId: 's1', operation: setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('hello') }]) }));
    expect(resend.status).toBe('duplicate');
    if (resend.status !== 'duplicate') throw new Error('unreachable');
    expect(resend.ack.revision).toBe(3);
  });

  it('復元後、no-op op の再送も duplicate（no-op ACK が ackCache 経由で保持される・指示 5）', () => {
    const seq = buildSequencer();
    const data = jsonRoundTrip(serializeSnapshot(seq.exportState()));
    const restored = new Sequencer(deserializeSnapshot(data), createManualClock());
    const resend = restored.submit(envelope({ clientId: 'cB', clientSequence: 2, operationId: 'noop1', operation: deleteRows([row('row-2')]) }));
    expect(resend.status).toBe('duplicate');
    if (resend.status !== 'duplicate') throw new Error('unreachable');
    expect(resend.ack.revision).toBe(4); // no-op 時の currentRevision
  });

  it('復元後、clientSequence 表が継続（次 op が seq+1 で受理・戻りで誤 reject しない）', () => {
    const seq = buildSequencer();
    const data = jsonRoundTrip(serializeSnapshot(seq.exportState()));
    const restored = new Sequencer(deserializeSnapshot(data), createManualClock());
    // cB は seq=2 まで処理済み → seq=3 が期待。seq=2 の別 op（戻り）は violation、seq=3 は accepted
    const regression = restored.submit(envelope({ clientId: 'cB', clientSequence: 2, operationId: 'stale-seq', operation: insertRows(row('row-1'), ['row-x']) }));
    expect(regression.status).toBe('rejected');
    const forward = restored.submit(envelope({ clientId: 'cB', clientSequence: 3, operationId: 'ok', operation: insertRows(row('row-1'), ['row-y']) }));
    expect(forward.status).toBe('accepted');
  });

  it('DA 反例: ackCache を欠いて復元すると既 ACK 済み op の再送が誤って再適用/違反になる（export 必須の実証）', () => {
    const seq = buildSequencer();
    const full = serializeSnapshot(seq.exportState());
    // ackCache を意図的に欠落させた壊れた状態を作る（export の必要性を実証）
    const broken: SequencerState = { ...deserializeSnapshot(jsonRoundTrip(full)), ackCache: new Map() };
    const restored = new Sequencer(broken, createManualClock());
    // 's1'（本来 duplicate）が ackCache 欠落で idempotency をすり抜け → clientSequence 検査で違反（seq=3 は既に消費扱い）
    const resend = restored.submit(envelope({ clientId: 'cA', clientSequence: 3, operationId: 's1', operation: setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('hello') }]) }));
    expect(resend.status).not.toBe('duplicate'); // 欠落させると duplicate 救済が効かない＝誤 reject 経路が開く
  });
});
