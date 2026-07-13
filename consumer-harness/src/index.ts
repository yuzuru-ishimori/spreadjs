// 独立 consumer（雛形）。**Facade だけ**を使い、内部パッケージ（core/collab/server/types/…）へは触れない。
// pack 済み tarball から `@nanairo-sheet/grid`・`@nanairo-sheet/server-hono` をインストールし、
// mount/serve の**型シグネチャが解決できること**を tsc --noEmit で確認する（stub の実行はしない）。
//
// これは「fixture の言い換え」ではない: S1-3 不合格条件（workspace link・source path 直接参照・
// 内部 package 直接 import）を含まないことを scripts/consumer-harness.sh が機械検査する点が違う。
// 実在社内アプリへの統合（S1-3 本実証）は DD-016 が担当する。

import { mount, GRID_FACADE_STAGE } from '@nanairo-sheet/grid';
import type { GridMountOptions, GridInstance, GridMountTarget } from '@nanairo-sheet/grid';
import { serve, SERVER_HONO_FACADE_STAGE } from '@nanairo-sheet/server-hono';
import type { ServeOptions, ServerInstance } from '@nanairo-sheet/server-hono';

/** Facade の公開型・シグネチャが consumer から解決できることを示すサンプル。 */
export function describeSdk(): string {
  const gridOptions: GridMountOptions = { documentId: 'demo-doc' };
  const serveOptions: ServeOptions = { port: 8080 };

  // 値（関数）を公開シグネチャ型へ代入して型互換を確認する（stub の実行はしない）。
  const mountFn: (target: GridMountTarget, options: GridMountOptions) => GridInstance = mount;
  const serveFn: (options: ServeOptions) => ServerInstance = serve;

  return [
    GRID_FACADE_STAGE,
    SERVER_HONO_FACADE_STAGE,
    gridOptions.documentId,
    String(serveOptions.port),
    typeof mountFn,
    typeof serveFn,
  ].join(' ');
}
