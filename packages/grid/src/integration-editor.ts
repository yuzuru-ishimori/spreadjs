// integration-editor（DD-005 Phase 3・DOM アダプタ）: 統合ページの常駐 textarea（§11.3）を生成し、
// DOM イベント → ime-editing-session（状態機械の結線）→ エフェクト適用の薄いアダプタに徹する。
// IME の正しさと Commit/#8/#4 のロジックは ime-editing-session（DOM 非依存・ユニット検証済み）にあり、
// このファイルは「実 textarea への value/selection/配置/見た目の反映」と「ViewportTransform での配置」だけを担う。
//
// §11.3 常駐 textarea 原則:
//   - グリッドに 1 個だけ生成し destroy まで保持（value/selection/DOM 親は composition 中に触らない・I-3）。
//   - Navigation では透明＋pointer-events:none（クリックは下の scroller へ通す＝入力受け口は保持）。
//   - Editing では白地＋pointer-events:auto。
//   - 可視セルへ ViewportTransform で配置し scroll 中も追従（AC3・§13.5）。画面外は隠す（仮想スクロール）。
//
// #9 競合表示: 競合枠（textarea outline）に加え、textarea より **上の z-index** の badge に他者の確定値を出す
//   （textarea がセル全面を覆ってもサーバー値と A の draft が同時に識別できる）。

import type { CellPosition, GridLayout } from '@nanairo-sheet/ime';
import type { EditorEvent } from '@nanairo-sheet/ime';
import type { CellRect, ViewportTransform } from '@nanairo-sheet/render';

import { computeEditorPlacement, type PlacementConfig } from './editor-placement';
import {
  createImeEditingSession,
  type EditingDocumentPort,
  type ImeEditingSession,
} from './ime-editing-session';

import type { PresenceUpdate } from '@nanairo-sheet/collab';
import type { SetCellsOperation } from '@nanairo-sheet/core';
import type { OperationId } from '@nanairo-sheet/types';

const CELL_FONT = '13px system-ui, sans-serif';
const EDITING_BACKGROUND = '#ffffff';
const CONFLICT_COLOR = '#d93025';
const EDITOR_Z = '10';
const BADGE_Z = '12'; // textarea より上（#9: 競合表示を隠さない）

export interface IntegrationEditorConfig {
  /** textarea/badge を配置するコンテナ（position:relative の stage）。 */
  readonly host: HTMLElement;
  readonly document: EditingDocumentPort;
  readonly submit: (operation: SetCellsOperation) => OperationId | void;
  readonly layout: GridLayout;
  readonly onPresenceChange?: (update: PresenceUpdate) => void;
  readonly onChange?: () => void;
}

export interface IntegrationEditor {
  readonly session: ImeEditingSession;
  /** scroller の pointerdown（main が hitTest 済み。null=ヘッダー/範囲外）。 */
  pointerdownCell(cell: CellPosition | null): void;
  /** scroller の dblclick（既存値編集開始）。 */
  doubleClickCell(cell: CellPosition): void;
  /** rAF ごとに配置を更新（scroll 追従・RowId 再解決・#4/AC3）。 */
  refreshPlacement(transform: ViewportTransform, placement: PlacementConfig): void;
  focus(): void;
  destroy(): void;
}

export function createIntegrationEditor(config: IntegrationEditorConfig): IntegrationEditor {
  const { host } = config;
  const abort = new AbortController();
  const { signal } = abort;

  // --- 常駐 textarea（1 個・破棄しない） ---
  const textarea = document.createElement('textarea');
  textarea.className = 'int-cell-editor';
  textarea.setAttribute('aria-label', 'セル入力');
  textarea.rows = 1;
  textarea.spellcheck = false;
  textarea.autocapitalize = 'off';
  textarea.style.position = 'absolute';
  textarea.style.display = 'none';
  textarea.style.margin = '0';
  textarea.style.padding = '0 4px';
  textarea.style.border = '2px solid #1a73e8';
  textarea.style.outline = 'none';
  textarea.style.background = 'transparent';
  textarea.style.font = CELL_FONT;
  textarea.style.color = '#202124';
  textarea.style.resize = 'none';
  textarea.style.overflow = 'hidden';
  textarea.style.whiteSpace = 'pre';
  textarea.style.boxSizing = 'border-box';
  textarea.style.zIndex = EDITOR_Z;
  textarea.style.pointerEvents = 'none';
  host.appendChild(textarea);

  // --- 競合 badge（textarea より上・#9） ---
  const badge = document.createElement('div');
  badge.className = 'int-conflict-badge';
  badge.style.position = 'absolute';
  badge.style.display = 'none';
  badge.style.zIndex = BADGE_Z;
  badge.style.background = CONFLICT_COLOR;
  badge.style.color = '#fff';
  badge.style.font = '11px system-ui, sans-serif';
  badge.style.padding = '1px 5px';
  badge.style.borderRadius = '3px';
  badge.style.whiteSpace = 'nowrap';
  badge.style.pointerEvents = 'none';
  host.appendChild(badge);

  // port/badge のクロージャは session 生成後に実行されるため、前方参照を ref で保持する。
  const sessionRef: { current: ImeEditingSession | undefined } = { current: undefined };
  let currentRect: CellRect | null = null;

  // --- TextareaPort（実 DOM への反映。composition 中は value/selection を書かない・I-3） ---
  const port = {
    getValue: () => textarea.value,
    setValue: (value: string) => {
      textarea.value = value;
    },
    setSelectionRange: (start: number, end: number) => {
      textarea.setSelectionRange(start, end);
    },
    focus: () => {
      textarea.focus();
    },
    place: (rect: CellRect | null) => {
      currentRect = rect;
      if (rect === null) {
        // 画面外/削除。composition 中は隠すと IME が壊れるため、直近位置に留める。
        if (sessionRef.current?.isComposing() !== true) {
          textarea.style.display = 'none';
          badge.style.display = 'none';
        }
        return;
      }
      textarea.style.display = 'block';
      textarea.style.left = `${rect.x}px`;
      textarea.style.top = `${rect.y}px`;
      textarea.style.width = `${rect.width}px`;
      textarea.style.height = `${rect.height}px`;
      textarea.style.lineHeight = `${rect.height}px`;
    },
    setEditingVisual: (editing: boolean) => {
      textarea.style.background = editing ? EDITING_BACKGROUND : 'transparent';
      // Navigation はクリックを下の scroller へ通す（入力受け口は focus で保持）。
      textarea.style.pointerEvents = editing ? 'auto' : 'none';
      // 編集開始時は focus() が効くよう display:block を先に確定する（正しい位置は直後の refreshPlacement が置く）。
      if (editing) {
        textarea.style.display = 'block';
      }
    },
    setConflict: (conflict: boolean) => {
      textarea.style.outline = conflict ? `2px solid ${CONFLICT_COLOR}` : 'none';
      updateBadge(conflict);
    },
  };

  function updateBadge(conflict: boolean): void {
    const target = conflict ? sessionRef.current?.getEditingTarget() : undefined;
    if (target === undefined || target === null || currentRect === null) {
      badge.style.display = 'none';
      return;
    }
    const serverValue = config.document.displayText(target.rowId, target.columnId);
    badge.textContent = `⚠ 他者の確定値: ${serverValue === '' ? '(空)' : serverValue}`;
    // セル上端の外側（少し上）へ。textarea を覆わず、かつ画面上端でクランプ。
    badge.style.left = `${currentRect.x}px`;
    badge.style.top = `${Math.max(0, currentRect.y - 16)}px`;
    badge.style.display = 'block';
  }

  const session = createImeEditingSession({
    document: config.document,
    port,
    submit: config.submit,
    layout: config.layout,
    onPresenceChange: config.onPresenceChange,
    onChange: config.onChange,
  });
  sessionRef.current = session;

  // --- DOM イベント → EditorEvent → session.handleEvent（薄いアダプタ） ---
  const on = <K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void => {
    textarea.addEventListener(type, handler, { signal });
  };

  on('compositionstart', () => {
    dispatch({ type: 'compositionstart' });
  });
  on('compositionupdate', (event) => {
    dispatch({ type: 'compositionupdate', data: event.data });
  });
  on('compositionend', (event) => {
    dispatch({ type: 'compositionend', data: event.data });
  });
  on('beforeinput', (event) => {
    if (event instanceof InputEvent) {
      dispatch({ type: 'beforeinput', inputType: event.inputType, data: event.data });
    }
  });
  on('input', (event) => {
    if (event instanceof InputEvent) {
      dispatch({
        type: 'input',
        value: textarea.value,
        isComposing: event.isComposing,
        inputType: event.inputType,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
      });
    }
  });
  on('keydown', (event) => {
    const consumed = session.handleEvent({
      type: 'keydown',
      key: event.key,
      code: event.code,
      isComposing: event.isComposing,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    });
    // 状態機械が消費したキー（Move/Commit/Cancel/BeginEdit/SuppressKey）は既定動作を止める。
    if (consumed) {
      event.preventDefault();
    }
  });
  on('keyup', (event) => {
    dispatch({ type: 'keyup', key: event.key, isComposing: event.isComposing });
  });
  on('focus', () => {
    dispatch({ type: 'focus' });
  });
  on('blur', () => {
    dispatch({ type: 'blur' });
  });
  // 常駐 textarea 自身のダブルクリック（active セルの既存値編集）。
  on('dblclick', () => {
    dispatch({ type: 'doubleClick', cell: session.getActiveCell() });
  });

  function dispatch(event: EditorEvent): void {
    session.handleEvent(event);
  }

  return {
    session,
    pointerdownCell: (cell) => {
      dispatch(cell === null ? { type: 'pointerdown', target: 'outside' } : { type: 'pointerdown', target: 'cell', cell });
      if (cell !== null && !session.isComposing()) {
        textarea.focus();
      }
    },
    doubleClickCell: (cell) => {
      dispatch({ type: 'doubleClick', cell });
    },
    refreshPlacement: (transform, placement) => {
      session.refreshPlacement((rowIndex, colIndex) => {
        const p = computeEditorPlacement(transform, rowIndex, colIndex, placement);
        return p.visible ? p.rect : null;
      });
      // badge 位置も追従（競合中のみ表示）。
      updateBadge(session.isConflicting());
    },
    focus: () => {
      textarea.focus();
    },
    destroy: () => {
      abort.abort();
      textarea.remove();
      badge.remove();
    },
  };
}
