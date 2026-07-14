// 開発用WSサーバーアダプター（Hono + @hono/node-server + ws）。phase4-design.md の HTTP/WS 配線・接続ライフサイクル・
// heartbeat/TTL sweep 駆動・起動/停止 API・後始末を実装する。**実クロック・実タイマー・Node API・ws/hono を使う唯一の層**
// （Room/Sequencer/Presence の注入クロック設計は不変＝server.ts が {now: Date.now} と setInterval を注入・駆動する）。
//
// server-core（Room）はトランスポート非依存で Outbound[] を返す。本アダプターは connectionId↔WebSocket を対応づけ、
// Outbound を fan-out し、close/error/TTL sweep で presenceRemoved を配信する。protocol-subset §1/§5/§6/§7 準拠。

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Server as HttpServer } from 'node:http';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';

import { documentHash } from '@nanairo-sheet/core';
import type {
  ClientMessage,
  ClientMessageExceptJoin,
  ClientOperationEnvelope,
  JoinMessage,
} from '@nanairo-sheet/core';
import {
  FileOpLogStore,
  FileSnapshotStore,
  PersistentRoom,
  Room,
  Sequencer,
  deserializeSnapshot,
  freshSequencerState,
  recoverSequencerState,
  serializeSnapshot,
} from '@nanairo-sheet/server';
import type {
  Clock,
  OpLogStore,
  Outbound,
  OutboundTarget,
  RecoveryReport,
  SnapshotData,
  SnapshotStore,
} from '@nanairo-sheet/server';
import {
  createColumnId,
  createDocumentId,
  createOperationId,
  createRowId,
  createTransactionId,
} from '@nanairo-sheet/types';
import type { RowId } from '@nanairo-sheet/types';
import { decodeClientMessage } from '@nanairo-sheet/core';

import {
  DEFAULT_INTEGRATION_DATASET,
  integrationColumnOrder,
  seedIntegrationDataset,
} from './seed-dataset';
import type { IntegrationDatasetConfig } from './seed-dataset';
import { rawDataToString } from './ws-frame';

const DEFAULT_PORT = 8787; // playground(5173) と非衝突（指示 3）
const DEFAULT_SEED_ROWS = 5;
const DEFAULT_HEARTBEAT_MILLIS = 5_000; // §9.3
const DEFAULT_TTL_MILLIS = 15_000; // §9.3
const DEFAULT_SWEEP_MILLIS = 5_000;
const PROTOCOL_VERSION = 1;

type NodeServer = ReturnType<typeof serve>;

export interface StartServerOptions {
  port?: number; // 既定 8787。0 = OS 任せのランダムポート（テスト・指示 3）
  host?: string; // 既定 '127.0.0.1'
  documentId?: string; // 既定 'demo-doc'
  columnOrder?: string[]; // 既定 ['col-a','col-b','col-c']
  seedRows?: number; // 既定 5（初期グリッド row-1..row-N）
  heartbeatMillis?: number; // 既定 5000（/config でデモへ伝える）
  ttlMillis?: number; // 既定 15000（Room presence TTL）
  sweepMillis?: number; // 既定 5000（sweep 実タイマー間隔）
  restoreFrom?: SnapshotData; // 指定時: snapshot＋log から復元起動（seed をスキップ・revision 継続・S-K2/K4）
  integrationDataset?: IntegrationDatasetConfig | boolean; // DD-005 Phase 2: 50,000行×200列・非空約10万を投入（true=既定規模）
  persistenceDir?: string; // DD-014: 指定時にファイル永続化（oplog＋snapshot）を有効化。再起動で snapshot＋tail から復旧する
  snapshotIntervalOps?: number; // DD-014: N op ごとに非同期 snapshot 生成（既定 1,000）
}

export interface RunningServer {
  port: number;
  url: string;
  documentId: string;
  hash(): string; // 現在の権威文書 hash（smoke の収束 assert 用）
  snapshot(): SnapshotData; // 検査用
  connectionCount(): number; // リーク検査用（後始末後 0）
  recovery?: RecoveryReport; // DD-014: 永続化有効時の再起動復旧内訳（snapshot revision・tail replay 数）
  close(): Promise<void>; // 全 ws terminate → wss.close → http server.close → clearInterval → oplog/snapshot close
}

/**
 * RoomBridge が駆動する Room 相当（Room＝同期／PersistentRoom＝submit のみ durable のため Promise を返す）。
 * handleMessage が Promise を返す場合、dispatch は durable 化（fsync）後に行われる（DD-014 durable ACK 契約）。
 */
interface RoomController {
  handleJoin(join: JoinMessage): { connectionId: string; outbound: Outbound[] };
  handleMessage(connectionId: string, message: ClientMessageExceptJoin): Outbound[] | Promise<Outbound[]>;
  handleDisconnect(connectionId: string): Outbound[];
  sweep(): Outbound[];
  activeConnectionIds(): readonly string[];
}

/**
 * connectionId ↔ WebSocket を対応づけ、Room の Outbound[] を fan-out するブリッジ。
 * 接続ライフサイクル（accept → join → 確立 → close/error）と TTL sweep を実装する（phase4-design §2/§3）。
 */
class RoomBridge {
  private readonly wsByConnection = new Map<string, WebSocket>();
  private readonly connectionByWs = new Map<WebSocket, string>();

  constructor(private readonly room: RoomController) {}

  /** 新規 WS を受理し、メッセージ・切断を購読する（connectionId は最初の join で確定）。 */
  onConnect(ws: WebSocket): void {
    ws.on('message', (data: RawData) => {
      this.onMessage(ws, data);
    });
    ws.on('close', () => {
      this.onClose(ws);
    });
    ws.on('error', () => {
      this.onClose(ws); // error は close を誘発するが、両発火でも onClose は冪等（DA D28）
    });
  }

  connectionCount(): number {
    return this.connectionByWs.size;
  }

  /** TTL sweep を発火し presenceRemoved を配信、失効接続の ws を close する（実タイマーから呼ぶ）。 */
  sweep(): void {
    this.dispatch(this.room.sweep());
    const active = new Set(this.room.activeConnectionIds());
    for (const [connectionId, ws] of [...this.wsByConnection]) {
      if (!active.has(connectionId)) {
        this.wsByConnection.delete(connectionId);
        this.connectionByWs.delete(ws);
        ws.close(1000, 'presence ttl expired'); // 続く close イベントは connectionByWs 削除済みゆえ no-op（冪等）
      }
    }
  }

  private onMessage(ws: WebSocket, data: RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawDataToString(data));
    } catch {
      this.closeSocket(ws, 1008, 'invalid json'); // 不正 JSON は切断（§エラーハンドリング）
      return;
    }
    const message = decodeClientMessage(parsed);
    if (message === undefined) {
      this.closeSocket(ws, 1008, 'unrecognized message');
      return;
    }
    try {
      this.route(ws, message);
    } catch (error) {
      // 1 接続のメッセージ処理失敗を他接続へ波及させない（当該接続のみ切断・P08: 握りつぶさない）。
      console.error(`RoomBridge: message handling failed: ${errorMessage(error)}`);
      this.closeSocket(ws, 1011, 'internal error');
    }
  }

  private route(ws: WebSocket, message: ClientMessage): void {
    const existing = this.connectionByWs.get(ws);
    if (message.type === 'join') {
      if (existing !== undefined) {
        return; // 二重 join は無視
      }
      const { connectionId, outbound } = this.room.handleJoin(message);
      this.wsByConnection.set(connectionId, ws);
      this.connectionByWs.set(ws, connectionId);
      this.dispatch(outbound); // welcome → operations → presenceSnapshot をこの順で（§8.2）
      return;
    }
    if (existing === undefined) {
      return; // join 前の非 join メッセージは無視（接続は維持）
    }
    const result = this.room.handleMessage(existing, message);
    if (result instanceof Promise) {
      // durable 境界（oplog fsync）解決後に ACK/broadcast を dispatch する（DD-014 durable ACK 契約）。
      // 書込失敗時は当該接続のみ切断（他接続へ波及させない・P08）。
      result.then((outbound) => this.dispatch(outbound)).catch((error: unknown) => {
        console.error(`RoomBridge: durable submit failed: ${errorMessage(error)}`);
        this.closeSocket(ws, 1011, 'internal error');
      });
      return;
    }
    this.dispatch(result);
  }

  private onClose(ws: WebSocket): void {
    const connectionId = this.connectionByWs.get(ws);
    if (connectionId === undefined) {
      return; // 未 join or 既に削除済み（close/error 両発火・sweep close の冪等・DA D28）
    }
    this.connectionByWs.delete(ws);
    this.wsByConnection.delete(connectionId);
    this.dispatch(this.room.handleDisconnect(connectionId)); // presenceRemoved（others）即時・§9.3
  }

  private closeSocket(ws: WebSocket, code: number, reason: string): void {
    this.onClose(ws); // 先に room/マップから外し presenceRemoved を配信してから close
    ws.close(code, reason);
  }

  private dispatch(outbound: Outbound[]): void {
    for (const item of outbound) {
      for (const connectionId of this.resolveTargets(item.target)) {
        const ws = this.wsByConnection.get(connectionId);
        if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(item.message));
        }
      }
    }
  }

  private resolveTargets(target: OutboundTarget): string[] {
    switch (target.kind) {
      case 'connection':
        return [target.connectionId];
      case 'others':
        return this.room.activeConnectionIds().filter((id) => id !== target.exceptConnectionId);
      case 'all':
        return [...this.room.activeConnectionIds()];
    }
  }
}

/** 開発用WSサーバーを起動する。listening 後に実ポートを含む RunningServer で resolve する（port 0 対応）。 */
export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const host = options.host ?? '127.0.0.1';
  const documentId = options.documentId ?? 'demo-doc';
  // DD-005 統合データセット指定時は列順・シードを 50,000行×200列へ切り替える（既存の小規模デモとは排他）。
  const datasetConfig = resolveDataset(options.integrationDataset);
  const columnOrderStrings =
    datasetConfig !== undefined
      ? integrationColumnOrder(datasetConfig.cols).map((c) => String(c))
      : options.columnOrder ?? ['col-a', 'col-b', 'col-c'];
  const seedRows = options.seedRows ?? DEFAULT_SEED_ROWS;
  const heartbeatMillis = options.heartbeatMillis ?? DEFAULT_HEARTBEAT_MILLIS;
  const ttlMillis = options.ttlMillis ?? DEFAULT_TTL_MILLIS;
  const sweepMillis = options.sweepMillis ?? DEFAULT_SWEEP_MILLIS;
  const port = options.port ?? DEFAULT_PORT;

  const columnOrder = columnOrderStrings.map((c) => createColumnId(c));
  const clock: Clock = { now: () => Date.now() }; // アダプター層のみ実クロック（指示 1）

  // DD-014 永続化（persistenceDir 指定時）: 再起動復旧＝最新 snapshot（document@R）＋oplog tail（revision>R）で復元。
  let oplog: OpLogStore | undefined;
  let snapshotStore: SnapshotStore | undefined;
  let recovery: RecoveryReport | undefined;
  let recoveredState: ReturnType<typeof freshSequencerState> | undefined;
  if (options.persistenceDir !== undefined) {
    oplog = new FileOpLogStore(join(options.persistenceDir, 'oplog.jsonl'));
    snapshotStore = new FileSnapshotStore(join(options.persistenceDir, 'snapshots'));
    const recovered = await recoverSequencerState({ oplog, snapshotStore, columnOrder });
    recovery = recovered.report;
    if (recovered.report.totalOps > 0) {
      recoveredState = recovered.state; // 既存文書を復元（seed しない）
    }
  }

  // 復元起動: restoreFrom（in-memory 検査用）指定時は snapshot＋log から Sequencer 状態を再構築する。
  // 永続化復元が優先（recoveredState）。いずれも無ければ空＋seed。
  const initialState =
    recoveredState ??
    (options.restoreFrom !== undefined ? deserializeSnapshot(options.restoreFrom) : freshSequencerState(columnOrder));
  const sequencer = new Sequencer(initialState, clock);
  const room = new Room(sequencer, {
    clock,
    idGenerator: { next: () => randomUUID() }, // connectionId は実 UUID
    ttlMillis,
  });
  // fresh（復元でも restoreFrom でもない）ときだけ seed する。永続化有効時は seed op を durable に oplog へ追記し、
  // 次回再起動の復旧で seed 済み文書を再現できるようにする（seed が oplog に無いと edit の baseRevision が破綻する）。
  const isFresh = recoveredState === undefined && options.restoreFrom === undefined;
  if (isFresh) {
    if (datasetConfig !== undefined) {
      seedIntegrationDataset(sequencer, documentId, datasetConfig);
    } else {
      seedInitialRows(sequencer, documentId, seedRows);
    }
    if (oplog !== undefined) {
      await oplog.append(sequencer.exportState().operationLog); // seed を durable 化（revision 1..k）
    }
  }

  // 永続化有効時は PersistentRoom（durable ACK 境界＋snapshot 生成）で Room を包む。
  const persistentRoom =
    oplog !== undefined && snapshotStore !== undefined
      ? new PersistentRoom(room, sequencer, oplog, snapshotStore, clock, {
          documentId,
          snapshotIntervalOps: options.snapshotIntervalOps,
        })
      : undefined;
  const bridge = new RoomBridge(persistentRoom ?? room);
  const demoHtml = loadDemoHtml();
  // 検査/復元用 snapshot: 永続化有効時は durable frontier 以下に制限する（未 fsync revision を `/snapshot`・
  // RunningServer.snapshot() から観測させない・DD-014-1 P1-3）。無効時は現在状態（全 in-memory が読取可能）。
  const readSnapshot = (): SnapshotData =>
    persistentRoom !== undefined ? persistentRoom.durableSnapshot() : serializeSnapshot(room.exportState());

  const app = new Hono();
  // dev サーバー: playground 統合ページは別オリジン（Vite dev の別ポート）から /config・/snapshot を fetch するため
  // CORS を許可する（開発用途のみ。DD-005 Phase 2 headed smoke でクロスオリジン fetch のブロックが判明し追加）。
  app.use('*', cors());
  app.get('/', (c) => c.html(demoHtml));
  app.get('/health', (c) => c.text('ok'));
  // columnOrder はブラウザークライアント（playground 統合ページ）が ClientSession を同一列順で構築するために配る。
  app.get('/config', (c) => c.json({ documentId, heartbeatMillis, columnOrder: columnOrderStrings }));
  app.get('/snapshot', (c) => c.json(readSnapshot()));

  const { server, boundPort } = await new Promise<{ server: NodeServer; boundPort: number }>(
    (resolve, reject) => {
      const created = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
        resolve({ server: created, boundPort: info.port });
      });
      created.once('error', reject); // listen 失敗（ポート使用中等）は reject
    },
  );
  server.on('error', (error: Error) => {
    console.error(`collaboration-server: runtime error: ${error.message}`);
  });

  if (!(server instanceof HttpServer)) {
    await closeServer(server, undefined, undefined);
    throw new Error('collaboration-server: expected a Node http.Server for WebSocket upgrade');
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws);
    });
  });
  wss.on('connection', (ws: WebSocket) => {
    bridge.onConnect(ws);
  });

  const sweepTimer = setInterval(() => {
    bridge.sweep();
  }, sweepMillis);

  const url = `http://${host}:${boundPort}`;
  return {
    port: boundPort,
    url,
    documentId,
    hash: () => documentHash(sequencer.document),
    snapshot: () => readSnapshot(),
    connectionCount: () => bridge.connectionCount(),
    recovery,
    close: () => closeServer(server, wss, sweepTimer, persistentRoom),
  };
}

/** integrationDataset オプションを具体設定へ正規化する（undefined/false=無効・true=既定規模・object=既定へマージ）。 */
function resolveDataset(
  option: IntegrationDatasetConfig | boolean | undefined,
): IntegrationDatasetConfig | undefined {
  if (option === undefined || option === false) {
    return undefined;
  }
  if (option === true) {
    return DEFAULT_INTEGRATION_DATASET;
  }
  return { ...DEFAULT_INTEGRATION_DATASET, ...option };
}

/** 初期グリッド（row-1..row-N）を単一 InsertRows で投入する（デモの見える行）。 */
function seedInitialRows(sequencer: Sequencer, documentId: string, count: number): void {
  if (count <= 0) {
    return;
  }
  const rows: Array<{ rowId: RowId }> = [];
  for (let i = 1; i <= count; i += 1) {
    rows.push({ rowId: createRowId(`row-${i}`) });
  }
  const envelope: ClientOperationEnvelope = {
    protocolVersion: PROTOCOL_VERSION,
    documentId: createDocumentId(documentId),
    operationId: createOperationId('seed-rows'),
    transactionId: createTransactionId('tx-seed-rows'),
    actorId: 'system',
    clientId: 'system',
    clientSequence: 1,
    baseRevision: 0,
    operation: { type: 'insertRows', afterRowId: null, rows },
  };
  sequencer.submit(envelope);
}

function loadDemoHtml(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // .../src
  return readFileSync(join(here, '..', 'public', 'demo.html'), 'utf8');
}

async function closeServer(
  server: NodeServer,
  wss: WebSocketServer | undefined,
  sweepTimer: ReturnType<typeof setInterval> | undefined,
  persistentRoom?: PersistentRoom,
): Promise<void> {
  if (sweepTimer !== undefined) {
    clearInterval(sweepTimer);
  }
  if (persistentRoom !== undefined) {
    await persistentRoom.close(); // 保留中の durable 書込を確定して oplog/snapshot ハンドルを閉じる
  }
  if (wss !== undefined) {
    for (const client of wss.clients) {
      client.terminate(); // ソケットを強制解放しリーク無しでプロセスが自然終了できるように
    }
    await new Promise<void>((resolve) => {
      wss.close(() => {
        resolve();
      });
    });
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined && error !== null) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `tsx src/server.ts`（dev script）で直接起動されたときだけ待受を開始する（import 時は起動しない＝smoke が import 可能）。 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

/** env の数値（未指定・不正は undefined）。E2E 起動用のシード規模調整に使う（DD-005 Phase 4）。 */
function numEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * `--integration` 起動時のシード規模を決める（DD-005 Phase 4・E2E 起動用の最小追加）。
 * env（SEED_ROWS / SEED_COLS / SEED_NONEMPTY）が無ければ既定規模（true＝50,000行×200列×非空100,000）。
 * E2E は行数（50,000）を保ったまま非空セル数だけ絞って初期 replay を軽くする（挙動・公開API は不変）。
 */
function integrationDatasetFromEnv(): IntegrationDatasetConfig | boolean {
  const rows = numEnv('SEED_ROWS');
  const cols = numEnv('SEED_COLS');
  const nonEmpty = numEnv('SEED_NONEMPTY');
  if (rows === undefined && cols === undefined && nonEmpty === undefined) {
    return true; // 既定規模（dev:integration の通常起動）
  }
  return {
    ...DEFAULT_INTEGRATION_DATASET,
    ...(rows !== undefined ? { rows } : {}),
    ...(cols !== undefined ? { cols } : {}),
    ...(nonEmpty !== undefined ? { nonEmpty } : {}),
  };
}

if (isMainModule()) {
  const envPort = process.env.PORT;
  const port = envPort === undefined ? DEFAULT_PORT : Number(envPort);
  // DD-005 統合PoC のシード投入は `--integration` フラグ or `SEED_DATASET=integration` で有効化する。
  const integrationEnabled =
    process.argv.includes('--integration') || process.env.SEED_DATASET === 'integration';
  const integrationDataset = integrationEnabled ? integrationDatasetFromEnv() : false;
  // DD-014: PERSISTENCE_DIR 指定でファイル永続化（oplog＋snapshot）を有効化する（再起動で復旧）。
  const persistenceDir = process.env.PERSISTENCE_DIR;
  const snapshotIntervalOps = numEnv('SNAPSHOT_INTERVAL_OPS');
  startServer({ port, integrationDataset, persistenceDir, snapshotIntervalOps })
    .then((running) => {
      process.stdout.write(
        `collaboration-server listening on ${running.url} (documentId=${running.documentId})\n`,
      );
      if (running.recovery !== undefined) {
        process.stdout.write(
          `DD-014 persistence: recovered from ${persistenceDir ?? ''} (snapshot=${String(running.recovery.fromSnapshotRevision)} totalOps=${running.recovery.totalOps} tailReplayed=${running.recovery.tailReplayed} tornDiscarded=${running.recovery.discardedTornRecords})\n`,
        );
      }
      if (integrationEnabled) {
        process.stdout.write(
          `DD-005 integration dataset seeded (rows/cols/nonEmpty overridable via SEED_ROWS/SEED_COLS/SEED_NONEMPTY). WS: ws://${running.url.replace(/^https?:\/\//, '')}/ws\n`,
        );
      } else {
        process.stdout.write(
          `open two tabs with different names, e.g. ${running.url}/?name=Alice and ${running.url}/?name=Bob\n`,
        );
      }
      const shutdown = (): void => {
        void running.close().then(() => {
          process.exit(0);
        });
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((error: unknown) => {
      process.stderr.write(`collaboration-server failed to start: ${errorMessage(error)}\n`);
      process.exit(1);
    });
}
