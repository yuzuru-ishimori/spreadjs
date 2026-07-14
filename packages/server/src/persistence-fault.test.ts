// DD-014 Phase 3 fault matrix テスト: corrupt/unsupported/途中破損の各ケースで fail-fast（黙って空文書化しない）を固定する（AC6）。
// 各ケースの意図・期待は doc/DD/DD-014/fault-matrix.md に対応する。
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { documentHash } from '@nanairo-sheet/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileOpLogStore, FileSnapshotStore } from './index';
import { PersistentRoom, recoverSequencerState } from './persistent-room';
import { Room } from './room';
import { Sequencer, freshSequencerState } from './sequencer';
import { createCounterIdGenerator } from './deps';
import { COLUMNS, col, createManualClock, envelope, insertRows, row, setCells, str } from './test-support';

let dir: string;
let oplogPath: string;
let snapshotDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fault-'));
  oplogPath = join(dir, 'oplog.jsonl');
  snapshotDir = join(dir, 'snapshots');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 正常な oplog＋snapshot を作る（fault を注入する土台）。 */
async function buildValid(): Promise<{ liveHash: string; totalOps: number; snapshotRevision: number }> {
  const clock = createManualClock();
  const sequencer = new Sequencer(freshSequencerState(COLUMNS), clock);
  const room = new Room(sequencer, { clock, idGenerator: createCounterIdGenerator() });
  const oplog = new FileOpLogStore(oplogPath);
  const snapshotStore = new FileSnapshotStore(snapshotDir);
  const persistent = new PersistentRoom(room, sequencer, oplog, snapshotStore, clock, { documentId: 'doc-1' });
  persistent.handleJoin({ type: 'join', protocolVersion: 1, documentId: 'doc-1' as never, lastAppliedRevision: 0, clientId: 'client-A' });
  await persistent.handleMessage('conn-1', { type: 'submitOperation', envelope: envelope({ operationId: 'op-1', clientSequence: 1, operation: insertRows(null, ['r1', 'r2']) }) });
  await persistent.handleMessage('conn-1', { type: 'submitOperation', envelope: envelope({ operationId: 'op-2', clientSequence: 2, baseRevision: 1, operation: setCells([{ rowId: row('r1'), columnId: col('col-a'), value: str('hi') }]) }) });
  const snapshotRevision = sequencer.currentRevision;
  await persistent.forceSnapshot(); // snapshot@2
  await persistent.handleMessage('conn-1', { type: 'submitOperation', envelope: envelope({ operationId: 'op-3', clientSequence: 3, baseRevision: 2, operation: insertRows(row('r2'), ['r3']) }) });
  const liveHash = documentHash(sequencer.document);
  const totalOps = sequencer.currentRevision;
  await persistent.close();
  return { liveHash, totalOps, snapshotRevision };
}

async function recover() {
  const oplog = new FileOpLogStore(oplogPath);
  const snapshotStore = new FileSnapshotStore(snapshotDir);
  try {
    return await recoverSequencerState({ oplog, snapshotStore, columnOrder: [...COLUMNS], documentId: 'doc-1' });
  } finally {
    await oplog.close();
    await snapshotStore.close();
  }
}

describe('fault matrix — 復旧の fail-fast（AC6）', () => {
  it('ケース0（対照）: 無破損なら snapshot＋tail で正しく復旧する', async () => {
    const { liveHash, totalOps } = await buildValid();
    const recovered = await recover();
    expect(documentHash(recovered.state.document)).toBe(liveHash);
    expect(recovered.report.totalOps).toBe(totalOps);
  });

  it('ケース1 unsupported snapshot version（v3 の中身 version 改竄）→ fail-fast throw', async () => {
    await buildValid();
    // snapshot ファイルの中身 SnapshotData.version を非対応値へ改竄（checksum も外れるがまず format/checksum で捕捉）。
    const names = await readdir(snapshotDir);
    const target = join(snapshotDir, names.find((n) => n.endsWith('.json'))!);
    const text = await readFile(target, 'utf8');
    await writeFile(target, text.replace('"version":3', '"version":99'));
    await expect(recover()).rejects.toThrow();
  });

  it('ケース2 snapshot checksum 不一致（bit-rot 模擬）→ fail-fast throw', async () => {
    await buildValid();
    const names = await readdir(snapshotDir);
    const target = join(snapshotDir, names.find((n) => n.endsWith('.json'))!);
    const text = await readFile(target, 'utf8');
    // revision フィールドの数字を書き換えて checksum を外す（値は既存桁を別数字へ）。
    await writeFile(target, text.replace('"revision":2', '"revision":8'));
    await expect(recover()).rejects.toThrow(/checksum|format/);
  });

  it('ケース3 snapshot JSON 破損（途中切断）→ fail-fast throw', async () => {
    await buildValid();
    const names = await readdir(snapshotDir);
    const target = join(snapshotDir, names.find((n) => n.endsWith('.json'))!);
    const text = await readFile(target, 'utf8');
    await writeFile(target, text.slice(0, Math.floor(text.length / 2))); // 途中で切断
    await expect(recover()).rejects.toThrow();
  });

  it('ケース4 oplog 中間行破損（既 ACK 済み）→ fail-fast throw', async () => {
    await buildValid();
    const text = await readFile(oplogPath, 'utf8');
    const lines = text.trimEnd().split('\n');
    lines[0] = 'CORRUPT_LINE'; // 先頭（中間扱い）を破壊
    await writeFile(oplogPath, `${lines.join('\n')}\n`);
    await expect(recover()).rejects.toThrow(/corruption/);
  });

  it('ケース5 oplog 末尾 torn write（未 ACK）→ 破棄して有効 prefix で復旧（黙って空にしない）', async () => {
    const { snapshotRevision } = await buildValid();
    // 完全な行群の後に改行なしの途中 JSON を追記（クラッシュ模擬）。
    await writeFile(oplogPath, '{"revision":4,"operation":{"type":"set', { flag: 'a' });
    const recovered = await recover();
    // torn を 1 件破棄し、有効 prefix（snapshot＋tail）で復旧する。空文書化していない（revision >= snapshot）。
    expect(recovered.report.discardedTornRecords).toBe(1);
    expect(recovered.state.currentRevision).toBeGreaterThanOrEqual(snapshotRevision);
    expect(recovered.state.document.rowOrder.length).toBeGreaterThan(0);
  });

  it('ケース6 snapshot 欠落＋oplog 残存 → oplog 全 replay で復旧（縮退・空文書化しない）', async () => {
    const { liveHash } = await buildValid();
    await rm(snapshotDir, { recursive: true, force: true }); // snapshot 全消し
    const recovered = await recover();
    expect(documentHash(recovered.state.document)).toBe(liveHash); // 全 replay で一致
    expect(recovered.report.fromSnapshotRevision).toBeUndefined();
  });

  it('ケース7 oplog revision 不連続（欠番・改竄）→ fail-fast throw', async () => {
    await buildValid();
    // snapshot を消して全 replay 経路にし、oplog の revision を飛ばす（連番違反）。
    await rm(snapshotDir, { recursive: true, force: true });
    const text = await readFile(oplogPath, 'utf8');
    await writeFile(oplogPath, text.replace('"revision":2', '"revision":5'));
    await expect(recover()).rejects.toThrow(/連続|不連続|revision/);
  });
});
