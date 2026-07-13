// Facade 公開面 contract test（骨格）。DD-011 設置・実 API 確定は DD-016。
//
// Facade（grid・server-hono）の **export surface（公開 value シンボル名）** を snapshot 契約として固定する。
// 意図しない export の追加/削除で fail する（＝公開 API の破壊的変更検出・§2.3 公開API不変条件）。
//
// 【意図的な変更の手順】
//   1. Facade の公開 export を変える（DD-016 等）。
//   2. `npx vitest run tests/contract -u` で snapshot を更新する。
//   3. 変更を CHANGELOG（Experimental `0.x`・ADR-0015）へ記録し、DD の公開API影響へ明記する。
// snapshot 更新なしに surface を変えると本テストが fail する（レビュー無しの契約変更を防ぐ）。
//
// 注記: 本骨格は **value export 名**を固定する（stub 段階で最も安く破壊的変更を捕捉できる面）。
// 型シグネチャ全体（引数・戻り値の型）の contract は、実 API が入る DD-016 で `.d.ts`/API extractor
// ベースへ拡張する（R7 型漏洩検査と対）。
import { describe, expect, it } from 'vitest';

import * as grid from '@nanairo-sheet/grid';
import * as serverHono from '@nanairo-sheet/server-hono';

function valueSurface(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).sort();
}

describe('contract: Facade export surface snapshot', () => {
  it('@nanairo-sheet/grid の公開 value surface', () => {
    expect(valueSurface(grid)).toMatchSnapshot();
  });

  it('@nanairo-sheet/server-hono の公開 value surface', () => {
    expect(valueSurface(serverHono)).toMatchSnapshot();
  });
});
