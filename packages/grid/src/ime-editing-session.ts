// ime-editing-session（DD-005 Phase 3 中核・DOM 非依存）: DD-002 の editor-state-machine（IME 状態機械）を
// 統合ページの ClientSession/DocumentView へ結線する。IME の正しさ（composition・順序A/B・I-1〜I-5）は
// 状態機械をそのまま再利用し、この層は **RowId/ColumnId での編集対象所有（#4）・cell-level beforeRevision の
// Commit（#3/#7）・サーバー更新に対する IME 不変（#8）・削除退避（AC4）** を担う。
//
// 【最重要原則】ClientSession だけが Document State の唯一の正本。この層は Document State を持たない。
//   - 編集対象は表示 index ではなく RowId/ColumnId + 編集開始 revision（EditTarget）で保持する（#4/#3）。
//   - Commit は draft → resolveCommit（生存確認→beforeRevision→SetCells）→ submit（ClientSession）へ。
//   - サーバー Operation（AC2 同一セル更新・rollback/replay）は IME 状態へ一切反映しない（#8）。
//     反映するのは Document State（Canvas）のみ。IME draft へサーバー値を入れない。
//   - 編集対象行が削除されたら（AC4）draft を退避（divertedDrafts）し無効 RowId へ Commit しない（黙って破棄しない）。
//
// テスト容易性: textarea を TextareaPort で抽象化し（value/selection/配置/見た目）、node 環境で
//   #8 不変・AC4 退避・#7 Commit 順序を DOM なしでユニット検証できる（ime-editing-session.test.ts）。

import type { CellPosition, GridLayout } from '@nanairo-sheet/ime';
import {
  type EditPhase,
  type EditorEvent,
  type EditorStateMachine,
  type Effect,
  createEditorStateMachine,
} from '@nanairo-sheet/ime';

import type { CellRect } from '@nanairo-sheet/render';

import {
  captureEditStartRevision,
  draftToScalar,
  isEditTargetStale,
  isRowLive,
  resolveCommit,
  type EditTarget,
} from './commit-bridge';

import type { PresenceUpdate } from '@nanairo-sheet/collab';
import type { CellAddressById, SelectionById, SetCellsOperation, SheetDocument } from '@nanairo-sheet/core';
import type { ColumnId, OperationId, RowId } from '@nanairo-sheet/types';

/** textarea への出力口（本番は実 textarea をラップ・テストは fake）。value/selection は composition 中は書かない（I-3）。 */
export interface TextareaPort {
  getValue(): string;
  /** 既存値編集の初期値設定・Navigation の空化のみ（composition 中は呼ばない・I-3）。 */
  setValue(value: string): void;
  setSelectionRange(start: number, end: number): void;
  focus(): void;
  /** 配置（null=隠す）。position のみ・value/selection/DOM 親は不変（I-3）。 */
  place(rect: CellRect | null): void;
  /** 見た目モード（true=編集中の白地・false=Navigation の透明）。 */
  setEditingVisual(editing: boolean): void;
  /** 競合枠（#9・paint のみ・composition 中も可）。 */
  setConflict(conflict: boolean): void;
}

/** ClientSession/DocumentView への読み取り口（committed=権威 / 表示=view / index↔RowId）。 */
export interface EditingDocumentPort {
  /** committed（サーバー確定・権威）文書。startRevision/生存/staleness に使う。 */
  getCommittedDocument(): SheetDocument;
  /** 表示値（既存値編集の初期値。view=committed+pending の描画値）。 */
  displayText(rowId: RowId, columnId: ColumnId): string;
  /** 表示 index → RowId/ColumnId（現在の表示 Axis）。 */
  rowIdAt(index: number): RowId | undefined;
  colIdAt(index: number): ColumnId | undefined;
  /** RowId/ColumnId → 表示 index（無ければ -1）。#4 の再解決に使う。 */
  rowIndexOf(rowId: RowId): number;
  colIndexOf(columnId: ColumnId): number;
}

/** AC4 で退避された draft（Conflict Queue 相当の証跡・黙って破棄しない）。 */
export interface DivertedDraft {
  readonly rowId: RowId;
  readonly columnId: ColumnId;
  readonly draft: string;
  readonly reason: 'target-deleted';
}

/** 表示 index → 配置矩形（null=画面外/削除で隠す）。DOM 層が ViewportTransform で実装する。 */
export type ResolveRect = (rowIndex: number, colIndex: number) => CellRect | null;

export interface ImeEditingSessionConfig {
  readonly document: EditingDocumentPort;
  readonly port: TextareaPort;
  /** SetCells を ClientSession へ submit（楽観適用→pending→送信）。OperationId を返す（reject 追跡用）。 */
  readonly submit: (operation: SetCellsOperation) => OperationId | void;
  /** 状態機械の navigation 境界（rowCount/columnCount のみ使用。pixel は未使用）。 */
  readonly layout: GridLayout;
  /** activeCell/editingCell/selection が変わったら Presence を送る。 */
  readonly onPresenceChange?: (update: PresenceUpdate) => void;
  /** 描画/配置の再要求（selection・編集状態・競合が変わったとき）。 */
  readonly onChange?: () => void;
}

export interface ImeEditingSession {
  /** DOM アダプタが EditorEvent を投入する。戻り値=消費した（keydown なら preventDefault すべき）。 */
  handleEvent(event: EditorEvent): boolean;
  getEditingTarget(): EditTarget | null;
  getActiveCell(): CellPosition;
  isComposing(): boolean;
  getPhase(): EditPhase;
  getDraft(): string;
  /** #9: 編集中に committed 側で対象セルが更新されたか（インジケーター表示条件）。IME には触れない。 */
  isConflicting(): boolean;
  /** AC4 で退避された draft（非破棄の証跡）。 */
  divertedDrafts(): readonly DivertedDraft[];
  /** 直近 submit の OperationId（reject を Conflict Queue と突き合わせる・#9）。 */
  lastSubmittedOperationId(): OperationId | undefined;
  /** サーバー Operation 適用後に呼ぶ（#8 不変の維持・AC4 削除退避の検知）。 */
  noteServerUpdate(): void;
  /** placement を再計算して port へ反映（scroll/構造Op 後・rAF 単位・RowId 再解決 #4）。 */
  refreshPlacement(resolveRect: ResolveRect): void;
}

export function createImeEditingSession(config: ImeEditingSessionConfig): ImeEditingSession {
  const doc = config.document;
  const port = config.port;

  let machine: EditorStateMachine = buildMachine();
  let editingTarget: EditTarget | null = null;
  const diverted: DivertedDraft[] = [];
  let lastOperationId: OperationId | undefined;
  let lastPresenceKey = '';

  function buildMachine(initialCell?: CellPosition): EditorStateMachine {
    return createEditorStateMachine({
      layout: config.layout,
      initialCell: initialCell ?? { row: 0, col: 0 },
      getCellValue: (cell) => {
        const rowId = doc.rowIdAt(cell.row);
        const columnId = doc.colIdAt(cell.col);
        if (rowId === undefined || columnId === undefined) {
          return '';
        }
        return doc.displayText(rowId, columnId);
      },
    });
  }

  function buildPresenceUpdate(): PresenceUpdate {
    // 編集中は editingTarget（RowId 安定）を activeCell/selection の源にする。他クライアントが構造Op（行挿入等）を
    // 起こして表示 index がずれても、他者へ publish する activeCell は正しい編集セルを指す（#4・Codex P1 の presence 部）。
    // 非編集時は状態機械の activeCell（表示 index）を RowId/ColumnId へ解決する。
    const active = machine.getActiveCell();
    const activeRowId = editingTarget !== null ? editingTarget.rowId : doc.rowIdAt(active.row);
    const activeColId = editingTarget !== null ? editingTarget.columnId : doc.colIdAt(active.col);
    const activeCell: CellAddressById | undefined =
      activeRowId !== undefined && activeColId !== undefined
        ? { rowId: activeRowId, columnId: activeColId }
        : undefined;
    const editingCell: CellAddressById | undefined =
      editingTarget !== null ? { rowId: editingTarget.rowId, columnId: editingTarget.columnId } : undefined;
    const selectionRanges: SelectionById[] =
      activeCell !== undefined
        ? [
            {
              startRowId: activeCell.rowId,
              startColumnId: activeCell.columnId,
              endRowId: activeCell.rowId,
              endColumnId: activeCell.columnId,
            },
          ]
        : [];
    return { activeCell, selectionRanges, editingCell };
  }

  function emitPresenceIfChanged(): void {
    if (config.onPresenceChange === undefined) {
      return;
    }
    const update = buildPresenceUpdate();
    const key = JSON.stringify([update.activeCell, update.editingCell]);
    if (key === lastPresenceKey) {
      return;
    }
    lastPresenceKey = key;
    config.onPresenceChange(update);
  }

  /** 現在の committed に対して編集対象セルが更新されたか（#9・IME には触れない純算出）。 */
  function conflicting(): boolean {
    return editingTarget !== null && isEditTargetStale(doc.getCommittedDocument(), editingTarget);
  }

  /** 表示 index のセルから EditTarget を作る（BeginEdit を経ない Commit 用・beforeRevision は現行を凍結）。 */
  function resolveTargetFromCell(cell: CellPosition): EditTarget | null {
    const rowId = doc.rowIdAt(cell.row);
    const columnId = doc.colIdAt(cell.col);
    if (rowId === undefined || columnId === undefined) {
      return null;
    }
    return { rowId, columnId, startRevision: captureEditStartRevision(doc.getCommittedDocument(), rowId, columnId) };
  }

  /** #7 Commit: 生存確認 → beforeRevision（凍結済み）→ SetCells → submit。削除済みは退避（#4）。 */
  function performCommit(draftText: string, effectCell: CellPosition): void {
    // 通常は編集開始（BeginEdit）で凍結した editingTarget を使う。ただし Navigation の Delete（S-A4）は
    // BeginEdit を経ずに Commit（空クリア）を出すため editingTarget が無い → effect.cell から対象を解決する
    // （無効セルなら submit しない）。これが無いと Delete が no-op になる（Codex P2）。
    const target = editingTarget ?? resolveTargetFromCell(effectCell);
    if (target === null) {
      return;
    }
    const outcome = resolveCommit(doc.getCommittedDocument(), target, draftToScalar(draftText));
    if (outcome.kind === 'submit') {
      const id = config.submit(outcome.operation);
      lastOperationId = id ?? undefined;
    } else {
      // target-deleted: 無効 RowId へ Commit しない → draft を退避（黙って破棄しない・#4）。
      diverted.push({ rowId: target.rowId, columnId: target.columnId, draft: draftText, reason: 'target-deleted' });
    }
    editingTarget = null;
  }

  /** AC4: 編集対象行が削除された → draft を退避し状態機械を安全なセルで作り直す（composition は破棄）。 */
  function abortToDiverted(target: EditTarget): void {
    diverted.push({ rowId: target.rowId, columnId: target.columnId, draft: machine.getDraft(), reason: 'target-deleted' });
    editingTarget = null;
    const active = machine.getActiveCell();
    machine = buildMachine({ row: active.row, col: active.col });
    port.setValue('');
    port.setEditingVisual(false);
    port.setConflict(false);
    port.place(null); // 削除セルは表示できない → 次 refreshPlacement で navigation セルへ
    emitPresenceIfChanged();
    config.onChange?.();
  }

  function applyEffect(effect: Effect): void {
    switch (effect.type) {
      case 'BeginEdit': {
        // 編集開始: 表示 index → RowId/ColumnId 解決 → editingTarget（startRevision 凍結・#3/#4）。
        const rowId = doc.rowIdAt(effect.cell.row);
        const columnId = doc.colIdAt(effect.cell.col);
        if (rowId === undefined || columnId === undefined) {
          editingTarget = null;
          break;
        }
        const startRevision = captureEditStartRevision(doc.getCommittedDocument(), rowId, columnId);
        editingTarget = { rowId, columnId, startRevision };
        if (effect.mode === 'existing') {
          // F2/ダブルクリックのときだけ既存値を載せる（§11.3・§11.4・キャレット末尾）。
          port.setValue(effect.initialValue);
          port.setSelectionRange(effect.initialValue.length, effect.initialValue.length);
        }
        // mode='replace' は value を触らない（直接入力/composition の生値をそのまま使う・I-3）。
        port.setEditingVisual(true);
        port.focus();
        break;
      }
      case 'Commit':
        // 値の正は最終 input 後の draft（I-1）。compositionend だけで Commit しない（状態機械が担保・#7）。
        // effect.cell は BeginEdit を経ない Navigation Delete の対象解決に使う（editingTarget 優先）。
        performCommit(effect.value, effect.cell);
        break;
      case 'Move':
      case 'MoveTo':
      case 'Cancel':
        // Navigation へ戻る（編集終了）。value/見た目は reconcile が Navigation で空・透明化する。
        editingTarget = null;
        break;
      case 'UpdateDraft':
      case 'MarkConflict':
      case 'SetPendingNavigation':
      case 'ClearPendingNavigation':
      case 'SuppressKey':
        // UpdateDraft: textarea は browser（DOM）が値の正 → port.value を書かない（I-1/I-3）。
        // MarkConflict は統合では使わない（競合はサーバー beforeRevision 判定に一本化・#8）。
        break;
    }
  }

  /** エフェクト適用後の見た目整合（Navigation=空/透明・編集=白・競合枠は committed 判定）。 */
  function reconcile(): void {
    if (!machine.isComposing()) {
      if (machine.getPhase() === 'Navigation') {
        if (port.getValue() !== '') {
          port.setValue('');
        }
        port.setEditingVisual(false);
      } else {
        port.setEditingVisual(true);
      }
    }
    port.setConflict(conflicting());
  }

  function applyEffects(effects: readonly Effect[]): void {
    for (const effect of effects) {
      applyEffect(effect);
    }
    reconcile();
    emitPresenceIfChanged();
    config.onChange?.();
  }

  return {
    handleEvent(event) {
      const effects = machine.dispatch(event);
      applyEffects(effects);
      return effects.length > 0;
    },
    getEditingTarget: () => editingTarget,
    getActiveCell: () => machine.getActiveCell(),
    isComposing: () => machine.isComposing(),
    getPhase: () => machine.getPhase(),
    getDraft: () => machine.getDraft(),
    isConflicting: () => conflicting(),
    divertedDrafts: () => diverted,
    lastSubmittedOperationId: () => lastOperationId,
    noteServerUpdate() {
      const target = editingTarget;
      if (target === null) {
        return;
      }
      if (!isRowLive(doc.getCommittedDocument(), target.rowId)) {
        // AC4: 編集対象行が削除された → 退避（#4）。
        abortToDiverted(target);
        return;
      }
      // 生存セルへのサーバー SetCells（AC2）・rollback/replay: IME 状態には一切触れない（#8）。
      // #9 の競合表示は isConflicting() が committed から都度算出するため、ここでは状態を持たない。
    },
    refreshPlacement(resolveRect) {
      let rowIndex: number;
      let colIndex: number;
      if (editingTarget !== null) {
        // #4: RowId 再解決（構造Op で display index がずれても同一 RowId を追う）。
        rowIndex = doc.rowIndexOf(editingTarget.rowId);
        colIndex = doc.colIndexOf(editingTarget.columnId);
      } else {
        const active = machine.getActiveCell();
        rowIndex = active.row;
        colIndex = active.col;
      }
      port.place(resolveRect(rowIndex, colIndex));
    },
  };
}
