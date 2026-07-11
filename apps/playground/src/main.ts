// playground の土台。描画ロジック（グリッド・IME）は後続 PoC の DD で実装する。
// ここでは (1) workspace 参照 @spreadjs/sheet-types が解決できること、
// (2) Canvas 2D コンテキストが取得でき枠線付きの空グリッドを 1 枚描けること
// だけを確認する。
import { createDocumentId, type DocumentId } from '@spreadjs/sheet-types';

// 論理サイズ（CSS ピクセル）。高 DPI 端末では backing store をスケールする。
const CSS_WIDTH = 800;
const CSS_HEIGHT = 480;

function mountEmptyGrid(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('Canvas 2D コンテキストを取得できません');
  }

  const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  canvas.style.width = `${CSS_WIDTH}px`;
  canvas.style.height = `${CSS_HEIGHT}px`;
  canvas.width = Math.round(CSS_WIDTH * dpr);
  canvas.height = Math.round(CSS_HEIGHT * dpr);
  context.scale(dpr, dpr);

  // 空グリッドの外枠だけ描く（内部の行・列・セルは後続 PoC で描画する）。
  // 0.5 オフセットで 1px の線をくっきり見せる。
  context.strokeStyle = '#8a8a8a';
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, CSS_WIDTH - 1, CSS_HEIGHT - 1);
}

const canvas = document.querySelector<HTMLCanvasElement>('#grid');
if (canvas === null) {
  throw new Error('#grid の Canvas 要素が見つかりません');
}

// sheet-types のブランド型を 1 箇所使い、workspace 参照が機能することを示す。
// 生成ロジックは PoC の DD で実装するため、ここではプレースホルダー ID を持たせる。
const documentId: DocumentId = createDocumentId('playground-doc');
canvas.dataset.documentId = documentId;

mountEmptyGrid(canvas);
