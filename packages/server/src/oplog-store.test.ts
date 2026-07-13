// FileOpLogStore の単体テスト（DD-014 Phase 1）: durable append・group commit・torn write 破棄・中間破損 fail-fast。
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerOperationEnvelope } from '@nanairo-sheet/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileOpLogStore } from './oplog-store';

function envelope(revision: number): ServerOperationEnvelope {
  return {
    protocolVersion: 1,
    documentId: 'doc-1',
    operationId: `op-${revision}`,
    transactionId: `tx-${revision}`,
    actorId: 'user-1',
    clientId: 'client-A',
    clientSequence: revision,
    baseRevision: revision - 1,
    operation: { type: 'insertRows', afterRowId: null, rows: [{ rowId: `row-${revision}` }] },
    revision,
    acceptedAt: new Date(revision * 1000).toISOString(),
    canonicalOperation: { type: 'insertRows', afterRowId: null, rows: [{ rowId: `row-${revision}` }] },
  } as unknown as ServerOperationEnvelope;
}

describe('FileOpLogStore', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oplog-test-'));
    path = join(dir, 'oplog.jsonl');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('append→readAll が往復一致する（fsync 後に読み戻せる＝durable）', async () => {
    const store = new FileOpLogStore(path);
    await store.append([envelope(1)]);
    await store.append([envelope(2), envelope(3)]);
    await store.close();

    const reopened = new FileOpLogStore(path);
    const { entries, discardedTornRecords } = await reopened.readAll();
    await reopened.close();
    expect(entries.map((e) => e.revision)).toEqual([1, 2, 3]);
    expect(discardedTornRecords).toBe(0);
  });

  it('同一 tick 内の並行 append を group commit でまとめても順序と durability を保つ', async () => {
    const store = new FileOpLogStore(path);
    // await を挟まず並行に enqueue（同一 flush ループでバッチ化される）。
    const p = Promise.all([store.append([envelope(1)]), store.append([envelope(2)]), store.append([envelope(3)])]);
    await p;
    await store.close();
    const text = await readFile(path, 'utf8');
    const revisions = text.trim().split('\n').map((l) => (JSON.parse(l) as ServerOperationEnvelope).revision);
    expect(revisions).toEqual([1, 2, 3]); // enqueue 順（=submit 順）で保存
  });

  it('末尾の torn write（改行なし途中書き）は破棄して件数を報告する（未 ACK＝安全）', async () => {
    const store = new FileOpLogStore(path);
    await store.append([envelope(1), envelope(2)]);
    await store.close();
    // クラッシュ模擬: 完全レコード 2 件の後に改行なしの途中 JSON を追記する。
    await writeFile(path, '{"revision":3,"operation":{"type":"inser', { flag: 'a' });

    const reopened = new FileOpLogStore(path);
    const { entries, discardedTornRecords } = await reopened.readAll();
    await reopened.close();
    expect(entries.map((e) => e.revision)).toEqual([1, 2]);
    expect(discardedTornRecords).toBe(1);
  });

  it('末尾が改行なしの完全 JSON でも破棄する（commit マーカー＝改行が無い＝未 fsync・Codex P1-1）', async () => {
    const store = new FileOpLogStore(path);
    await store.append([envelope(1), envelope(2)]);
    await store.close();
    // クラッシュ模擬: 完全な JSON だが末尾改行を欠く（write が改行の直前で切れた torn write）。
    await writeFile(path, JSON.stringify(envelope(3)), { flag: 'a' });

    const reopened = new FileOpLogStore(path);
    const { entries, discardedTornRecords } = await reopened.readAll();
    await reopened.close();
    expect(entries.map((e) => e.revision)).toEqual([1, 2]); // 改行なし末尾は内容によらず破棄
    expect(discardedTornRecords).toBe(1);
  });

  it('torn tail を含むファイルへ再 append しても破損に連結しない（物理 truncate・Codex P1-1）', async () => {
    const store = new FileOpLogStore(path);
    await store.append([envelope(1), envelope(2)]);
    await store.close();
    await writeFile(path, '{"revision":3,"operation":{"type":"inser', { flag: 'a' }); // torn tail

    // 再起動相当: 新しいストアが append すると torn tail を truncate してから追記する。
    const reopened = new FileOpLogStore(path);
    await reopened.append([envelope(3)]); // 正しい revision 3 を追記
    await reopened.close();
    const verify = new FileOpLogStore(path);
    const { entries, discardedTornRecords } = await verify.readAll();
    await verify.close();
    expect(entries.map((e) => e.revision)).toEqual([1, 2, 3]); // torn tail は消え、追記が破損に連結していない
    expect(discardedTornRecords).toBe(0);
  });

  it('親ディレクトリが未作成でも append で再帰作成する（初回起動・Codex P2-2）', async () => {
    const nested = join(dir, 'sub', 'deep', 'oplog.jsonl');
    const store = new FileOpLogStore(nested);
    await store.append([envelope(1)]);
    await store.close();
    const reopened = new FileOpLogStore(nested);
    const { entries } = await reopened.readAll();
    await reopened.close();
    expect(entries.map((e) => e.revision)).toEqual([1]);
  });

  it('中間行の破損（既 ACK 済みデータ）は fail-fast で throw する（AC6）', async () => {
    // 壊れた中間行 + 正常な末尾行（改行付き）。中間破損は黙って捨てない。
    await writeFile(path, `${JSON.stringify(envelope(1))}\nNOT_JSON\n${JSON.stringify(envelope(3))}\n`);
    const store = new FileOpLogStore(path);
    await expect(store.readAll()).rejects.toThrow(/corruption/);
    await store.close();
  });

  it('存在しないファイルの readAll は空を返す（初回起動）', async () => {
    const store = new FileOpLogStore(join(dir, 'absent.jsonl'));
    const { entries } = await store.readAll();
    await store.close();
    expect(entries).toEqual([]);
  });
});
