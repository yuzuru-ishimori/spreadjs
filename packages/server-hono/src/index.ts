// @nanairo-sheet/server-hono — 同期サーバーの唯一の公開面（Facade・Experimental 0.x・ADR-0015）。
//
// Hono + @hono/node-server + ws による実 WS サーバー（Room/Sequencer/PersistentRoom を配線）を serve() で起動する。
// 内部実装（startServer/RunningServer・StartServerOptions・SnapshotData/RecoveryReport）は ./server が持ち、本 index は
// consumer 向けに **最小の公開契約**へ整形する（R7: SnapshotData/RecoveryReport・restoreFrom・integrationDataset 等の
// 内部型/デモ専用オプションは露出しない）。

import { startServer } from './server';

/** serve 時オプション（Experimental 0.x・内部 StartServerOptions の公開最小サブセット）。 */
export interface ServeOptions {
  /** listen ポート（既定 8787。0=OS 任せのランダムポート＝テスト）。 */
  readonly port?: number;
  /** listen ホスト（既定 '127.0.0.1'）。 */
  readonly host?: string;
  /** ドキュメント ID（既定 'demo-doc'）。 */
  readonly documentId?: string;
  /** 列順（既定 ['col-a','col-b','col-c']）。 */
  readonly columnOrder?: readonly string[];
  /** 初期グリッド行数（既定 5）。 */
  readonly seedRows?: number;
  /** 指定でファイル永続化（oplog＋snapshot）を有効化する。再起動で snapshot＋tail から復旧する。 */
  readonly persistenceDir?: string;
}

/** serve が返すハンドル（consumer lifecycle 契約）。 */
export interface ServerInstance {
  readonly port: number;
  readonly url: string;
  readonly documentId: string;
  /** 現在の接続数（診断用）。 */
  connectionCount(): number;
  /** サーバーを停止し接続・永続化ハンドルを解放する。 */
  stop(): Promise<void>;
}

/** 公開 API バージョン（Experimental 0.x・ADR-0015）。 */
export const SERVER_HONO_API_VERSION = '0.1.0-experimental' as const;

/** 同期サーバーを起動する（listening 後に解決＝port 0 対応で async）。 */
export async function serve(options: ServeOptions = {}): Promise<ServerInstance> {
  const running = await startServer({
    port: options.port,
    host: options.host,
    documentId: options.documentId,
    columnOrder: options.columnOrder !== undefined ? [...options.columnOrder] : undefined,
    seedRows: options.seedRows,
    persistenceDir: options.persistenceDir,
  });
  return {
    port: running.port,
    url: running.url,
    documentId: running.documentId,
    connectionCount: () => running.connectionCount(),
    stop: () => running.close(),
  };
}
