// @nanairo-sheet/server-hono — 同期サーバーの唯一の公開面（Facade・Experimental 0.x・ADR-0015）。
//
// Hono + @hono/node-server + ws による実 WS サーバー（Room/Sequencer/PersistentRoom を配線）を serve() で起動する。
// 内部実装（startServer/RunningServer・StartServerOptions・SnapshotData/RecoveryReport）は ./server が持ち、本 index は
// consumer 向けに **最小の公開契約**へ整形する（R7: SnapshotData/RecoveryReport・restoreFrom・integrationDataset 等の
// 内部型/デモ専用オプションは露出しない）。

import { startServer } from './server';

/** 診断エントリの重大度（server-hono 診断 hook）。 */
export type ServeDiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

/** serve 診断エントリ（onDiagnostic opt-in 時のみ生成）。 */
export interface ServeDiagnostic {
  readonly level: ServeDiagnosticLevel;
  /** 安定した診断イベント識別子（'serve-started' / 'serve-stopped'）。 */
  readonly code: string;
  readonly message: string;
  /** epoch ms。 */
  readonly timestamp: number;
}

/** 診断ログ hook（opt-in・既定無出力）。 */
export type ServeDiagnosticHook = (entry: ServeDiagnostic) => void;

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
  /**
   * 診断ログ hook（opt-in・既定無出力・最小）。指定すると serve 起動/停止の診断エントリが配信される。
   * 未指定なら診断は生成されない。汎用テレメトリ基盤は Stage 2（接続単位の診断は現状 connectionCount() で代替）。
   */
  readonly onDiagnostic?: ServeDiagnosticHook;
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
  // 診断 hook（opt-in・既定無出力）。hook の例外は本体へ波及させない（副次機能）。
  const onDiagnostic = options.onDiagnostic;
  const diag = (level: ServeDiagnosticLevel, code: string, message: string): void => {
    if (onDiagnostic === undefined) {
      return;
    }
    try {
      onDiagnostic({ level, code, message, timestamp: Date.now() });
    } catch {
      // 診断 hook の失敗は無視する。
    }
  };
  const running = await startServer({
    port: options.port,
    host: options.host,
    documentId: options.documentId,
    columnOrder: options.columnOrder !== undefined ? [...options.columnOrder] : undefined,
    seedRows: options.seedRows,
    persistenceDir: options.persistenceDir,
  });
  diag('info', 'serve-started', `listening ${running.url} (documentId=${running.documentId})`);
  return {
    port: running.port,
    url: running.url,
    documentId: running.documentId,
    connectionCount: () => running.connectionCount(),
    stop: async () => {
      await running.close();
      diag('info', 'serve-stopped', `stopped ${running.url}`);
    },
  };
}
