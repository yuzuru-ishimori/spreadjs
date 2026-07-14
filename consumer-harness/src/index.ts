// 独立 consumer（雛形）。**Facade だけ**を使い、内部パッケージ（core/collab/server/types/…）へは触れない。
// pack 済み tarball から `@nanairo-sheet/grid`・`@nanairo-sheet/server-hono` をインストールし、
// mount/serve の**型シグネチャが解決できること**を tsc --noEmit で確認する（stub の実行はしない）。
//
// これは「fixture の言い換え」ではない: S1-3 不合格条件（workspace link・source path 直接参照・
// 内部 package 直接 import）を含まないことを scripts/consumer-harness.sh が機械検査する点が違う。
// 実挙動（serve→mount→日本語入力→共同編集→destroy/再mount）の実証は DD-016-2 の consumer-app が担当する。
//
// 【DD-016-2 P2-1】確定公開 API（0.1.0-experimental）へ追随:
//   grid   : mount(target, options): GridInstance（sync 返却）・GridMountOptions.serverUrl 必須・GRID_API_VERSION
//   server : serve(options?): Promise<ServerInstance>（async）・SERVER_HONO_API_VERSION

import { mount, GRID_API_VERSION } from '@nanairo-sheet/grid';
import type { GridMountOptions, GridInstance, GridMountTarget } from '@nanairo-sheet/grid';
import { serve, SERVER_HONO_API_VERSION } from '@nanairo-sheet/server-hono';
import type { ServeOptions, ServerInstance } from '@nanairo-sheet/server-hono';

/** Facade の公開型・シグネチャが consumer から解決できることを示すサンプル。 */
export function describeSdk(): string {
  // serverUrl は必須（省略すると型エラー＝S1-3 の「開発サーバー暗黙設定依存」を型で塞ぐ）。
  const gridOptions: GridMountOptions = { serverUrl: 'http://127.0.0.1:8787', documentId: 'demo-doc' };
  const serveOptions: ServeOptions = { port: 8080 };

  // 値（関数）を公開シグネチャ型へ代入して型互換を確認する（stub の実行はしない）。
  const mountFn: (target: GridMountTarget, options: GridMountOptions) => GridInstance = mount;
  // serve は async（Promise<ServerInstance> を返す）。
  const serveFn: (options?: ServeOptions) => Promise<ServerInstance> = serve;

  return [
    GRID_API_VERSION,
    SERVER_HONO_API_VERSION,
    gridOptions.serverUrl,
    gridOptions.documentId ?? '',
    String(serveOptions.port),
    typeof mountFn,
    typeof serveFn,
  ].join(' ');
}
