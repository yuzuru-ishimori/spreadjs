// server-hono ServerInstance（公開 lifecycle 契約）を独立 consumer から検証する（DD-016-2 Phase 3・AC1）。
// serve()→port/url/documentId/connectionCount()→/health・/config 疎通→stop()→listen 停止 を assert する。
// pack 済み tarball 経由で解決される（内部 package は import しない）。tsx で実行する。

import assert from 'node:assert/strict';

import { serve, SERVER_HONO_API_VERSION } from '@nanairo-sheet/server-hono';

assert.equal(SERVER_HONO_API_VERSION, '0.1.0-experimental', 'SERVER_HONO_API_VERSION');

const server = await serve({ port: 0, host: '127.0.0.1', documentId: 'lifecycle-check', seedRows: 3 });
assert.ok(server.port > 0, 'random port (port:0) が割り当てられる');
assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/, 'url 形式');
assert.equal(server.documentId, 'lifecycle-check', 'documentId 反映');
assert.equal(server.connectionCount(), 0, '接続前 connectionCount=0');

const health = await fetch(`${server.url}/health`);
assert.equal(health.status, 200, '/health 200');

const configRes = await fetch(`${server.url}/config`);
assert.equal(configRes.status, 200, '/config 200');
const config = (await configRes.json()) as { documentId: string; columnOrder: string[] };
assert.equal(config.documentId, 'lifecycle-check', '/config documentId');
assert.ok(Array.isArray(config.columnOrder) && config.columnOrder.length > 0, '/config columnOrder');

await server.stop();

let stopped = false;
try {
  await fetch(`${server.url}/health`, { signal: AbortSignal.timeout(1500) });
} catch {
  stopped = true;
}
assert.ok(stopped, 'stop() 後は listen が停止し接続不能');

console.log('[consumer-app] server-hono ServerInstance lifecycle OK (serve/port/url/documentId/connectionCount/health/config/stop)');
