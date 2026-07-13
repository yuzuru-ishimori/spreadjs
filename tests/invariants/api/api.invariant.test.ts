// 公開API 不変条件スイート（§2.3 公開API不変条件）。DD-011 設置・実充足は DD-016/017。
//
// 最小ケース: Facade（grid・server-hono）の公開 value surface が最小 allowlist に一致し、
// 内部パッケージのシンボル（core の createDocument 等）が Facade から漏れていないこと
// （§2.3「Stable/Experimental/Internal 区分」「破壊的変更検出」・R7 と対）。
// export surface の snapshot 契約は tests/contract/facade-surface.test.ts。
import { describe, expect, it } from 'vitest';

import * as grid from '@nanairo-sheet/grid';
import * as serverHono from '@nanairo-sheet/server-hono';

// Facade skeleton（stub）が公開してよい value export の allowlist。実 API 確定は DD-016。
const GRID_ALLOWED = ['mount', 'GRID_FACADE_STAGE'];
const SERVER_HONO_ALLOWED = ['serve', 'SERVER_HONO_FACADE_STAGE'];

// consumer へ漏れてはいけない内部シンボルの代表（core Internal）。
const INTERNAL_SYMBOLS = ['createDocument', 'applyOperation', 'documentHash', 'decodeClientMessage'];

describe('invariant/api: Facade 公開面が Internal を漏らさない', () => {
  it('grid の value export は最小 allowlist に一致する', () => {
    expect(Object.keys(grid).sort()).toEqual([...GRID_ALLOWED].sort());
  });

  it('server-hono の value export は最小 allowlist に一致する', () => {
    expect(Object.keys(serverHono).sort()).toEqual([...SERVER_HONO_ALLOWED].sort());
  });

  it('内部パッケージのシンボルは Facade から export されていない', () => {
    for (const sym of INTERNAL_SYMBOLS) {
      expect(Object.prototype.hasOwnProperty.call(grid, sym)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(serverHono, sym)).toBe(false);
    }
  });
});
