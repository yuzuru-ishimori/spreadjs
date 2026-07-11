// ws の受信フレーム（RawData = Buffer | ArrayBuffer | Buffer[]）を UTF-8 文字列へ正規化する（Node 依存・Buffer 使用）。
// server.ts / ws-transport.ts が JSON.parse 前に使う。message-codec.ts（純粋）とは分離し、node 依存はここに閉じ込める。

import type { RawData } from 'ws';

/** ws の RawData を UTF-8 文字列へ変換する（フラグメント配列も連結）。 */
export function rawDataToString(data: RawData): string {
  if (typeof data === 'string') {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  return data.toString('utf8'); // Buffer
}
