// consumer-app の同期サーバー起動（Playwright webServer 用・長命プロセス）。
// 独立 consumer が **公開 Facade `@nanairo-sheet/server-hono` の serve() だけ**でサーバーを立てられることを示す
// （内部 server/room/sequencer は import しない）。pack 済み tarball 経由で解決される。tsx で実行する。

import { serve } from '@nanairo-sheet/server-hono';

const port = Number(process.env.PORT ?? '8790');
const documentId = process.env.DOC_ID ?? 'consumer-doc';
const seedRows = Number(process.env.SEED_ROWS ?? '60');

const server = await serve({ port, host: '127.0.0.1', documentId, seedRows });
console.log(`[consumer-app serve] listening ${server.url} doc=${server.documentId} port=${server.port}`);

function shutdown(): void {
  void server.stop().then(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
