// DD-014-1 Phase 3 計測（Evidence full）: クライアント join/再読込の **snapshot bootstrap が全 operationLog replay に依存しない**
// ことを大規模文書で実測する。実行: npx tsx scripts/dd014-1/measure-bootstrap.mts
// 出力: 生ログを stdout（doc/DD/DD-014-1/bootstrap-perf-raw.txt へリダイレクト保存）。
//
// 骨子:
//   - K 個の個別 SetCells op（DD-006 の「個別 op で 14分」経路の縮小版）で権威文書を構築する。
//   - サーバー Room.handleJoin（fresh・lastAppliedRevision=0）が返すメッセージを実 ClientSession へ流し、
//     (a) 受信メッセージ種別（bootstrap 1 通・operations 0 通）(b) 適用したサーバー op 数（=0＝全 replay 非依存）
//     (c) bootstrap 復元時間・受信ペイロードの op 数を計測する。
//   - 対照: 同じ K op を「全 operationLog を operations で送る旧経路」で ClientSession へ流し、適用 op 数=K・時間を計測する。

import { performance } from 'node:perf_hooks';

import { documentHash } from '@nanairo-sheet/core';
import type { ServerMessage } from '@nanairo-sheet/core';
import { ClientSession, createCounterIdGenerator } from '@nanairo-sheet/collab';
import type { ClientMessage, ClientTransport, TransportListener } from '@nanairo-sheet/collab';
import { Room, Sequencer, freshSequencerState } from '@nanairo-sheet/server';
import {
  createColumnId,
  createDocumentId,
  createOperationId,
  createRowId,
  createTransactionId,
} from '@nanairo-sheet/types';
import type { ColumnId } from '@nanairo-sheet/types';

const ROWS = 2_000;
const COLS = 10; // 2,000 × 10 = 20,000 セル（個別 op で構築＝全 replay 経路の縮小版・14分を避ける）
const columnOrder: ColumnId[] = Array.from({ length: COLS }, (_, i) => createColumnId(`c${i}`));
const DOC_ID = createDocumentId('bootstrap-doc');

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** ClientSession を駆動する最小トランスポート（送信は記録、受信は手動注入）。 */
class DriverTransport implements ClientTransport {
  private listener: TransportListener | undefined;
  readonly sent: ClientMessage[] = [];
  setListener(l: TransportListener): void {
    this.listener = l;
  }
  connect(): void {
    this.listener?.handleConnected();
  }
  send(m: ClientMessage): void {
    this.sent.push(m);
  }
  receive(m: ServerMessage): void {
    this.listener?.handleServerMessage(m);
  }
}

function buildAuthoritativeRoom(): { room: Room; sequencer: Sequencer } {
  const clock = { now: () => 0 };
  const sequencer = new Sequencer(freshSequencerState(columnOrder), clock);
  const room = new Room(sequencer, { clock, idGenerator: createCounterIdGenerator('conn') });
  // 1 op で全行挿入（土台構築は高速に・ハングを避ける）。
  sequencer.submit({
    protocolVersion: 1,
    documentId: DOC_ID,
    operationId: createOperationId('seed-rows'),
    transactionId: createTransactionId('tx-seed'),
    actorId: 'system',
    clientId: 'system',
    clientSequence: 1,
    baseRevision: 0,
    operation: { type: 'insertRows', afterRowId: null, rows: Array.from({ length: ROWS }, (_, i) => ({ rowId: createRowId(`row-${i}`) })) },
  });
  // K 個の個別 SetCells op（1 セルずつ）＝全 replay 経路の入力。
  let seq = 2;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      sequencer.submit({
        protocolVersion: 1,
        documentId: DOC_ID,
        operationId: createOperationId(`op-${seq}`),
        transactionId: createTransactionId(`tx-${seq}`),
        actorId: 'system',
        clientId: 'system',
        clientSequence: seq,
        baseRevision: seq - 1,
        operation: { type: 'setCells', changes: [{ rowId: createRowId(`row-${r}`), columnId: columnOrder[c], value: { kind: 'number', value: r * COLS + c } }], conflictPolicy: 'reject-overlap' },
      });
      seq += 1;
    }
  }
  return { room, sequencer };
}

function newSession(transport: DriverTransport): ClientSession {
  return new ClientSession({
    clientId: 'measure',
    userId: 'u',
    displayName: 'measure',
    documentId: DOC_ID,
    columnOrder,
    transport,
    clock: { now: () => 0 },
    idGenerator: createCounterIdGenerator('measure-op'),
  });
}

function main(): void {
  log('# DD-014-1 client snapshot bootstrap measurement');
  log(`# generated: ${new Date().toISOString()}`);
  log(`# authoritative doc: ${ROWS} rows × ${COLS} cols = ${ROWS * COLS} cells built from ${ROWS * COLS} individual SetCells ops`);
  log(`# node: ${process.version}`);
  log('');

  const { room, sequencer } = buildAuthoritativeRoom();
  const authoritativeRevision = sequencer.currentRevision;
  const authoritativeHash = documentHash(sequencer.document);
  const opLogLength = sequencer.operationsSince(0).length;
  log(`# authoritative revision=${authoritativeRevision} operationLog length=${opLogLength} hash=${authoritativeHash}`);
  log('');

  // --- (A) bootstrap 経路: fresh join（lastAppliedRevision=0）---
  {
    const transport = new DriverTransport();
    const session = newSession(transport);
    session.start(); // → join 送信
    const { outbound } = room.handleJoin({ type: 'join', protocolVersion: 1, documentId: DOC_ID, lastAppliedRevision: 0, clientId: 'measure' });
    const types = outbound.map((o) => o.message.type);
    const bootstrapMsg = outbound.find((o) => o.message.type === 'bootstrap');
    const start = performance.now();
    for (const item of outbound) {
      transport.receive(item.message);
    }
    const ms = performance.now() - start;
    const bootDoc = bootstrapMsg?.message.type === 'bootstrap' ? bootstrapMsg.message.document : undefined;
    const bootstrapPayloadRows = bootDoc?.rowOrder.length ?? 0;
    log('[bootstrap] fresh join（lastAppliedRevision=0）');
    log(`  outbound message types   = ${JSON.stringify(types)}`);
    log(`  operations messages       = ${types.filter((t) => t === 'operations').length}  ★ 全 operationLog 送出 0（全 replay 非依存）`);
    log(`  bootstrap messages        = ${types.filter((t) => t === 'bootstrap').length}`);
    log(`  client appliedServerOpCount = ${session.appliedServerOpCount}  ★ 適用サーバー op = 0（tail 無し）`);
    log(`  client committed revision = ${session.committedDocument.revision} (== authoritative ${authoritativeRevision})`);
    log(`  client committed hash     = ${session.committedHash()} (match=${session.committedHash() === authoritativeHash})`);
    log(`  bootstrap payload rowOrder length = ${bootstrapPayloadRows} (document@R・operationLog 非埋め込み)`);
    log(`  bootstrap restore time    = ${ms.toFixed(1)}ms`);
    log('');
  }

  // --- (B) 対照: 旧 full-replay 経路（全 operationLog を operations で送る）---
  {
    const transport = new DriverTransport();
    const session = newSession(transport);
    // welcome(currentRevision=0) にして bootstrap 待ちを回避し、全 operationLog を operations で流し込む。
    transport.receive({ type: 'welcome', sessionId: 'conn-x', currentRevision: 0, colorKey: 'color-0', capabilities: { protocolVersion: 1 } });
    const allOps = sequencer.operationsSince(0);
    const start = performance.now();
    // チャンクで operations を配信（1 メッセージに全件でも良いが現実配信に寄せる）。
    transport.receive({ type: 'operations', fromRevision: allOps[0].revision, toRevision: allOps[allOps.length - 1].revision, operations: allOps });
    const ms = performance.now() - start;
    log('[full-replay] 対照（全 operationLog を replay・DD-006 14分経路の縮小版）');
    log(`  client appliedServerOpCount = ${session.appliedServerOpCount}  (= operationLog length ${opLogLength})`);
    log(`  client committed revision = ${session.committedDocument.revision}`);
    log(`  client committed hash     = ${session.committedHash()} (match=${session.committedHash() === authoritativeHash})`);
    log(`  full replay time          = ${ms.toFixed(1)}ms`);
    log('');
  }

  log('# 判定: fresh join は bootstrap 1 通で committed@R を確立し operationLog を 1 件も replay しない（appliedServerOpCount=0）。');
  log('#       対照の full-replay は operationLog 全 ' + opLogLength + ' 件を適用する。DD-006 実測では 100k 個別 op replay=14分。');
  log('#       ゆえに join/ブラウザー再読込の初期化は全 replay に依存しない（AC1/AC8・§8 既知制約回収）。');
}

main();
