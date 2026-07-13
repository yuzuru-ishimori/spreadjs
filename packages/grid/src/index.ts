// @nanairo-sheet/grid — Facade skeleton（stub）。
//
// DD-011（基盤実装DD）で設置した「唯一の公開面」の骨格。consumer は内部パッケージ
// （core/collab/render/selection/ime/types）を直接 import せず、この Facade だけを import する（R1）。
//
// 【B→A 昇格の境界】本ファイルは **stub に留める**。実 API（Command/Event/Options・lifecycle 契約・
// 内部パッケージの束ね）は DD-016（Facade/実consumer統合DD）で確定する。stub が実 API を固定し始めたら
// Risk Class A へ昇格する（roadmap §2.4）。ここでは「型の置き場」と mount/destroy の signature だけを置く。
//
// 【R7】内部パッケージを再エクスポートしない・公開シグネチャへ内部型を漏らさない（境界文書 §3/§4.2 R7）。
// そのため本 stub は内部パッケージへ一切依存しない（package.json も依存ゼロ）。

/** grid をマウントする DOM ターゲット（Canvas 描画のため DOM コンテナが必須）。 */
export interface GridMountTarget {
  readonly container: HTMLElement;
}

/** mount 時オプション（stub。実 Options 契約は DD-016 で確定）。 */
export interface GridMountOptions {
  /** 編集対象ドキュメント ID。 */
  readonly documentId: string;
}

/**
 * mount が返すハンドル（consumer lifecycle 契約の最小骨格・境界文書 §5）。
 * 実装（event unsubscribe・connection state・error notification 等）は DD-016。
 */
export interface GridInstance {
  readonly documentId: string;
  /** グリッドを破棄し DOM/リスナー/接続リソースを解放する。 */
  destroy(): void;
}

/**
 * Facade skeleton のステージマーカー。contract test の export surface snapshot と
 * consumer harness の疎通確認に使う（実 API バージョンは DD-016/017 で付与）。
 */
export const GRID_FACADE_STAGE = 'stage1-alpha-skeleton' as const;

/**
 * Canvas グリッドを DOM コンテナへマウントする（**stub**）。
 * 実装は DD-016。呼び出すと未実装エラーを投げる（型の疎通・contract のためだけの骨格）。
 */
export function mount(target: GridMountTarget, options: GridMountOptions): GridInstance {
  void target;
  void options;
  throw new Error(
    '@nanairo-sheet/grid: mount() は Facade skeleton の stub です（実装は DD-016）。',
  );
}
