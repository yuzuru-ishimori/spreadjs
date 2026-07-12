// CellStore 候補の共通インターフェイス（DD-006 Phase 1・AC1）。
// 4実装（Map型／チャンク型2実装／列指向配列型）を同一契約で比較し、等価性を検証する。
// 計画書 §6.4・ADR-011 素材。DOM/Node 非依存の純ロジック（ブラウザーでも動く前提）。

/** 生成された 1 セル（非空）。value は元の文字列をそのまま保持する。 */
export interface GeneratedCell {
  readonly row: number;
  readonly col: number;
  readonly value: string;
}

/** 範囲クエリで 1 セルごとに呼ばれる訪問関数。 */
export type RangeVisitor = (row: number, col: number, value: string) => void;

/** CellStore 候補の生成時設定。列指向はここで次元を確定する。 */
export interface CellStoreConfig {
  readonly rows: number;
  readonly cols: number;
  /** 行スロット/列チャンクの 1 チャンク行数（既定 256・§6.4）。 */
  readonly chunkRows?: number;
}

/**
 * 4実装が満たす共通契約。
 * - `get`/`set` は「元の文字列」を保存・復元する（value は不透明。数値へ正規化しない＝等価性の前提）。
 * - `set(row,col,'')` は削除（nonEmptyCount 減）。
 * - `queryRange` は [rowStart,rowEnd)×[colStart,colEnd) の非空セルだけを visit し、件数を返す。
 * - `approxMemoryBytes` は方式間の相対比較用の概算（厳密値ではない）。
 */
export interface CellStoreCandidate {
  /** 方式ラベル（レポート/等価性テストの識別子）。 */
  readonly label: string;
  get(row: number, col: number): string;
  set(row: number, col: number, value: string): void;
  /** (row,col) 昇順のセル列を一括ロードする（末尾 append 経路の最適化を許す）。 */
  bulkLoad(cells: Iterable<GeneratedCell>): void;
  queryRange(
    rowStart: number,
    rowEnd: number,
    colStart: number,
    colEnd: number,
    visit: RangeVisitor,
  ): number;
  nonEmptyCount(): number;
  approxMemoryBytes(): number;
}

/** 候補ストアのファクトリ（次元を受け取り生成）。 */
export type CellStoreFactory = (config: CellStoreConfig) => CellStoreCandidate;

/** UTF-16 1 文字 = 2 byte。メモリ概算の共通係数。 */
export const BYTES_PER_CHAR = 2;
