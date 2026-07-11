// snapshot＋Operation ログの JSON エクスポート/インポート（サーバー再起動模擬・S-K1〜K4）。
// エクスポート内容は {document(正準構造), operationLog, currentRevision, ackCache, clientSequenceTable} を全部含める
// （指示 5）。no-op の ACK はログから再構築できないため ackCache の明示エクスポートが必須（DA D17）。
// Presence は非永続（§9）ゆえ含めない。SheetDocument の Map/二段 Map は JSON セーフな配列へ変換する。

import { applyOperation, createDocument, documentHash } from '@nanairo-sheet/sheet-core';
import type {
  CellScalar,
  RowMeta,
  ServerOperationEnvelope,
  SheetDocument,
} from '@nanairo-sheet/sheet-core';
import { createColumnId, createOperationId, createRowId } from '@nanairo-sheet/sheet-types';
import type { ColumnId, RowId } from '@nanairo-sheet/sheet-types';

import type { SequencerState } from './sequencer';

interface SerializedRowMeta {
  id: string;
  slot: number;
  tombstone: boolean;
  lastChangedRevision: number;
}
interface SerializedRowCells {
  rowId: string;
  columns: Array<{ columnId: string; value: CellScalar; lastChangedRevision: number }>;
}
interface SerializedDocument {
  revision: number;
  rowOrder: string[];
  rowMeta: SerializedRowMeta[];
  columnOrder: string[];
  cells: SerializedRowCells[];
}

/** JSON セーフなスナップショット表現（Map→配列・二段 cells→配列）。 */
export interface SnapshotData {
  version: 1;
  document: SerializedDocument;
  operationLog: ServerOperationEnvelope[]; // 平坦オブジェクト（RowId 等は実行時 string）でそのまま JSON セーフ
  currentRevision: number;
  ackCache: Array<{ operationId: string; revision: number }>;
  clientSequenceTable: Array<{ clientId: string; lastSequence: number }>;
}

/** Sequencer 状態を JSON セーフな SnapshotData へ直列化する。 */
export function serializeSnapshot(state: SequencerState): SnapshotData {
  return {
    version: 1,
    document: serializeDocument(state.document),
    operationLog: [...state.operationLog],
    currentRevision: state.currentRevision,
    ackCache: [...state.ackCache].map(([operationId, revision]) => ({ operationId, revision })),
    clientSequenceTable: [...state.clientSequenceTable].map(([clientId, lastSequence]) => ({
      clientId,
      lastSequence,
    })),
  };
}

/** SnapshotData を Sequencer 復元入力（SequencerState）へ復元する（S-K2）。revision も復元し継続する（S-K4）。 */
export function deserializeSnapshot(data: SnapshotData): SequencerState {
  const ackCache = new Map<ReturnType<typeof createOperationId>, number>();
  for (const entry of data.ackCache) {
    ackCache.set(createOperationId(entry.operationId), entry.revision);
  }
  const clientSequenceTable = new Map<string, number>();
  for (const entry of data.clientSequenceTable) {
    clientSequenceTable.set(entry.clientId, entry.lastSequence);
  }
  return {
    document: deserializeDocument(data.document),
    operationLog: [...data.operationLog],
    currentRevision: data.currentRevision,
    ackCache,
    clientSequenceTable,
  };
}

/**
 * 整合検証: 復元 document とログ replay の整合を多面で確認する（S-K1/K2・DA D7・Codex [P2]）。
 * - **content hash 一致**: 復元 document の hash == ログを空文書から replay した文書の hash（no-op はログ非追記＝replay 不変）。
 * - **構造一致**: rowOrder（tombstone 含む）・各行 tombstone・revision が復元と replay で一致（hash 盲点＝空行/tombstone
 *   のみの破損を検知・D12）。
 * - **revision 整合**: ログ revision が 1..N 連番（`log[i].revision===i+1`）・`currentRevision===ログ長`・
 *   `document.revision===currentRevision`。改竄された currentRevision（飛び番）を検知し、復元後の飛び番 revision で
 *   クライアントが欠落 revision を永久に待つ事故を防ぐ。
 */
export function verifySnapshotIntegrity(data: SnapshotData): {
  ok: boolean;
  documentHash: string;
  replayHash: string;
} {
  const restored = deserializeDocument(data.document);
  const columnOrder: ColumnId[] = data.document.columnOrder.map((c) => createColumnId(c));
  let replay: SheetDocument = createDocument(columnOrder);
  for (const envelope of data.operationLog) {
    replay = applyOperation(replay, envelope.operation, { revision: envelope.revision }).document;
  }
  const documentHashValue = documentHash(restored);
  const replayHashValue = documentHash(replay);

  // revision 整合: ログは accepted のみ・revision 消費ゆえ連番 1..N かつ currentRevision===N===document.revision。
  const logContiguous = data.operationLog.every((envelope, index) => envelope.revision === index + 1);
  const revisionConsistent =
    data.currentRevision === data.operationLog.length && data.document.revision === data.currentRevision;
  // 構造一致（tombstone/空行の hash 盲点対策）: rowOrder と各行 tombstone・revision を比較。
  const structureConsistent = structuralMatch(restored, replay);

  return {
    ok: documentHashValue === replayHashValue && logContiguous && revisionConsistent && structureConsistent,
    documentHash: documentHashValue,
    replayHash: replayHashValue,
  };
}

/** rowOrder（tombstone 含む）・各行 tombstone・revision の構造一致（hash 非依存・空行/tombstone 破損を検知）。 */
function structuralMatch(a: SheetDocument, b: SheetDocument): boolean {
  if (a.revision !== b.revision) {
    return false;
  }
  if (a.rowOrder.length !== b.rowOrder.length) {
    return false;
  }
  for (let i = 0; i < a.rowOrder.length; i += 1) {
    const rowId = a.rowOrder[i];
    if (String(rowId) !== String(b.rowOrder[i])) {
      return false;
    }
    if ((a.rowMeta.get(rowId)?.tombstone ?? true) !== (b.rowMeta.get(b.rowOrder[i])?.tombstone ?? true)) {
      return false;
    }
  }
  return true;
}

function serializeDocument(doc: SheetDocument): SerializedDocument {
  const rowMeta: SerializedRowMeta[] = [];
  for (const meta of doc.rowMeta.values()) {
    rowMeta.push({
      id: meta.id,
      slot: meta.slot,
      tombstone: meta.tombstone,
      lastChangedRevision: meta.lastChangedRevision,
    });
  }
  const cells: SerializedRowCells[] = [];
  for (const [rowId, rowCells] of doc.cells) {
    const columns: SerializedRowCells['columns'] = [];
    for (const [columnId, record] of rowCells) {
      columns.push({
        columnId,
        value: record.value,
        lastChangedRevision: record.lastChangedRevision,
      });
    }
    cells.push({ rowId, columns });
  }
  return {
    revision: doc.revision,
    rowOrder: [...doc.rowOrder],
    rowMeta,
    columnOrder: [...doc.columnOrder],
    cells,
  };
}

function deserializeDocument(data: SerializedDocument): SheetDocument {
  const rowMeta = new Map<RowId, RowMeta>();
  for (const meta of data.rowMeta) {
    const id = createRowId(meta.id);
    rowMeta.set(id, {
      id,
      slot: meta.slot,
      tombstone: meta.tombstone,
      lastChangedRevision: meta.lastChangedRevision,
    });
  }
  const cells = new Map<RowId, Map<ColumnId, { value: CellScalar; lastChangedRevision: number }>>();
  for (const rowCells of data.cells) {
    const rowId = createRowId(rowCells.rowId);
    const inner = new Map<ColumnId, { value: CellScalar; lastChangedRevision: number }>();
    for (const cell of rowCells.columns) {
      inner.set(createColumnId(cell.columnId), {
        value: cell.value,
        lastChangedRevision: cell.lastChangedRevision,
      });
    }
    cells.set(rowId, inner);
  }
  return {
    revision: data.revision,
    rowOrder: data.rowOrder.map((r) => createRowId(r)),
    rowMeta,
    columnOrder: data.columnOrder.map((c) => createColumnId(c)),
    cells,
  };
}
