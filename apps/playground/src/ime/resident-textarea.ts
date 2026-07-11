// 常駐 textarea（DD-002 Phase 3・状態機械本統合）。
//
// Phase 2 の最小版（暫定 commit/cancel）を廃し、編集状態機械（editor-state-machine）の
// 出力エフェクトで textarea・cell-store・選択（activeCell）を駆動する。activeCell の
// 所有権は状態機械へ一本化した（DA #2）。DOM イベントは「記録（preventDefault 前）→
// 状態機械への入力へ変換 → dispatch → エフェクト適用」の薄いアダプタに徹する。
//
// §11.3 常駐 textarea 原則を守る:
// - グリッドに 1 個だけ生成し破棄しない（destroy まで保持）
// - display:none / visibility:hidden / ゼロサイズにしない
// - アクティブセル位置へ配置（IME 候補ウィンドウの基準をセル近傍に保つ）
// - Navigation 中は値を空にし、直接入力で置換編集
// - F2 / ダブルクリック時だけ既存値を設定
// - composition 中に value / selection / DOM 親を変更しない（背景色・アウトラインの paint のみ許容・I-3）

import type {
  EventRecorder,
  RecordedEventType,
  RecorderContext,
  RecorderEventSnapshot,
  TraceEnvironment,
} from './event-recorder';
import {
  type EditorStateMachine,
  type Effect,
  createEditorStateMachine,
} from './editor-state-machine';
import { type CellPosition, type GridLayout, cellKey, cellRect } from '../grid/geometry';
import { type CellStore } from '../grid/cell-store';

export interface ResidentEditorOptions {
  /** textarea を配置するスクロールコンテナ（position: relative・グリッドと一緒にスクロール）。 */
  readonly host: HTMLElement;
  /** pointerdown を記録する範囲（通常は host 全体）。 */
  readonly pointerTarget: HTMLElement;
  readonly layout: GridLayout;
  readonly store: CellStore;
  readonly recorder: EventRecorder;
  /** 記録時の環境を供給する（trace-panel の ime 手入力を反映）。 */
  readonly getEnvironment: () => TraceEnvironment;
  /** activeCell / 競合 / 記録が変化するたびに呼ぶ（Canvas 再描画・パネル更新）。 */
  readonly onViewChange?: () => void;
}

export interface ResidentEditor {
  /** 常駐 textarea へフォーカスする（入力受け口を 1 本に保つ・I-5）。 */
  focus(): void;
  /** 現在のアクティブセル（状態機械が正・DA #2）。 */
  getActiveCell(): CellPosition;
  /** 競合インジケーター対象セルのキー集合（§11.7・描画用）。 */
  getConflictCells(): ReadonlySet<string>;
  /** IME 変換中か（main の pointer 判断・エビデンス用）。 */
  isComposing(): boolean;
  /** Canvas クリック（main が hitTest 済み。null=ヘッダー/範囲外）。状態機械の pointerdown へ写す。 */
  pointerdownCell(cell: CellPosition | null): void;
  /** Canvas ダブルクリック（既存値編集開始）。 */
  doubleClickCell(cell: CellPosition): void;
  /** リモート更新の投入（Phase 4 シミュレーター）。store 反映 + 競合マーク（§11.7）。 */
  applyRemoteUpdate(cell: CellPosition, value: string | null): void;
  /** リスナー解除と textarea 除去。 */
  destroy(): void;
}

/** 編集中セルの背景（下地の確定値を隠す。paint のみで composition を壊さない）。 */
const EDITING_BACKGROUND = '#ffffff';
/** グリッドのセル文字と揃えるフォント（grid-view と一致させる）。 */
const CELL_FONT = '13px system-ui, sans-serif';
/** 競合インジケーター色（grid-view の conflict と揃える）。 */
const CONFLICT_COLOR = '#d93025';

/**
 * 常駐 textarea を生成し、編集状態機械と本統合する。
 */
export function createResidentEditor(options: ResidentEditorOptions): ResidentEditor {
  const { host, pointerTarget, layout, store, recorder } = options;
  const abort = new AbortController();
  const { signal } = abort;

  const machine: EditorStateMachine = createEditorStateMachine({
    layout,
    initialCell: { row: 0, col: 0 },
    getCellValue: (cell) => store.get(cell),
  });

  const textarea = document.createElement('textarea');
  textarea.className = 'cell-editor';
  textarea.setAttribute('aria-label', 'セル入力');
  textarea.rows = 1;
  textarea.spellcheck = false;
  textarea.autocapitalize = 'off';
  textarea.style.position = 'absolute';
  textarea.style.margin = '0';
  textarea.style.padding = '0 6px';
  textarea.style.border = 'none';
  textarea.style.outline = 'none';
  textarea.style.background = 'transparent';
  textarea.style.font = CELL_FONT;
  textarea.style.lineHeight = `${layout.cellHeight}px`;
  textarea.style.color = '#202124';
  textarea.style.resize = 'none';
  textarea.style.overflow = 'hidden';
  textarea.style.whiteSpace = 'pre';
  textarea.style.boxSizing = 'border-box';
  textarea.style.zIndex = '5';
  host.appendChild(textarea);

  // --- textarea 配置・見た目（composition 中は value/位置を触らない・I-3） ---

  const place = (): void => {
    if (machine.isComposing()) {
      return;
    }
    const rect = cellRect(layout, machine.getActiveCell());
    textarea.style.left = `${rect.x}px`;
    textarea.style.top = `${rect.y}px`;
    textarea.style.width = `${rect.width}px`;
    textarea.style.height = `${rect.height}px`;
  };

  const focus = (): void => {
    textarea.focus();
  };

  /**
   * §11.6 スクロール追従（方式2）: コンテナスクロール時も textarea をセル位置へ再配置する。
   * cellRect はスクロール非依存のコンテンツ座標なので、位置のみ再設定する（value/selection/
   * DOM 親は変更しない・I-3）。composition 中も安全に呼べる（強制 blur/commit をしない）。
   */
  const followScroll = (): void => {
    const rect = cellRect(layout, machine.getActiveCell());
    textarea.style.left = `${rect.x}px`;
    textarea.style.top = `${rect.y}px`;
    textarea.style.width = `${rect.width}px`;
    textarea.style.height = `${rect.height}px`;
  };

  /** エフェクト適用後の見た目整合（Navigation=空/透明・編集=白・競合=赤枠）。 */
  const reconcile = (): void => {
    if (!machine.isComposing()) {
      place();
      if (machine.getPhase() === 'Navigation') {
        if (textarea.value !== '') {
          textarea.value = '';
        }
        textarea.style.background = 'transparent';
      } else {
        textarea.style.background = EDITING_BACKGROUND;
      }
    }
    // 競合アウトライン（paint のみ・composition 中も可）。編集セル＝activeCell に競合マークが立つ。
    const conflicted = machine.getConflictCells().has(cellKey(machine.getActiveCell()));
    textarea.style.outline = conflicted ? `2px solid ${CONFLICT_COLOR}` : 'none';
  };

  const applyEffect = (effect: Effect): void => {
    switch (effect.type) {
      case 'BeginEdit':
        place();
        if (effect.mode === 'existing') {
          // F2 / ダブルクリックのときだけ既存値を載せる（§11.3・§11.4）。キャレット末尾。
          textarea.value = effect.initialValue;
          const caret = textarea.value.length;
          textarea.setSelectionRange(caret, caret);
        }
        // mode='replace' は value を触らない（直接入力の生値 / composition をそのまま使う・I-3）。
        textarea.style.background = EDITING_BACKGROUND;
        focus();
        break;
      case 'Commit':
        // 値の正は input 後の draft（I-1）。整形しない。
        store.set(effect.cell, effect.value);
        break;
      case 'Move':
      case 'MoveTo':
      case 'Cancel':
        // Navigation へ戻る: 空・透明にして activeCell へ再配置し、フォーカスを保つ（I-5）。
        place();
        textarea.value = '';
        textarea.style.background = 'transparent';
        textarea.style.outline = 'none';
        focus();
        break;
      case 'UpdateDraft':
      case 'MarkConflict':
      case 'SetPendingNavigation':
      case 'ClearPendingNavigation':
      case 'SuppressKey':
        // UpdateDraft: textarea は生値が正のため書き換えない（I-1/I-3）。
        // MarkConflict: 見た目は reconcile が反映。SuppressKey: preventDefault は keydown 側で実施。
        break;
    }
  };

  const applyEffects = (effects: readonly Effect[]): void => {
    for (const effect of effects) {
      applyEffect(effect);
    }
    reconcile();
    options.onViewChange?.();
  };

  // --- 記録（イベント受信直後・preventDefault より前に呼ぶ = DA #5） ---

  const phaseLabel = (): string => {
    const phase = machine.getPhase();
    if (phase === 'Navigation') {
      return 'Navigation';
    }
    if (phase === 'Composing') {
      return 'Composing';
    }
    return 'Editing';
  };

  const currentContext = (): RecorderContext => ({
    environment: options.getEnvironment(),
    state: phaseLabel(),
    activeCell: machine.getActiveCell(),
  });

  const readSnapshotBase = (
    type: RecordedEventType,
  ): Pick<RecorderEventSnapshot, 'type' | 'timestamp' | 'value' | 'selectionStart' | 'selectionEnd'> => ({
    type,
    timestamp: Math.round(performance.now()),
    value: textarea.value,
    selectionStart: textarea.selectionStart,
    selectionEnd: textarea.selectionEnd,
  });

  const record = (snapshot: RecorderEventSnapshot): void => {
    recorder.record(snapshot, currentContext());
  };

  const recordKeyboard = (type: 'keydown' | 'keyup', event: KeyboardEvent): void => {
    record({ ...readSnapshotBase(type), key: event.key, code: event.code, isComposing: event.isComposing });
  };

  const recordInput = (type: 'beforeinput' | 'input', event: InputEvent): void => {
    record({ ...readSnapshotBase(type), inputType: event.inputType, data: event.data, isComposing: event.isComposing });
  };

  const recordComposition = (
    type: 'compositionstart' | 'compositionupdate' | 'compositionend',
    event: CompositionEvent,
  ): void => {
    record({ ...readSnapshotBase(type), data: event.data });
  };

  const recordSimple = (type: 'focus' | 'blur' | 'pointerdown'): void => {
    record(readSnapshotBase(type));
  };

  // --- DOM リスナー（記録 → 状態機械 dispatch → エフェクト適用） ---

  textarea.addEventListener(
    'compositionstart',
    (event) => {
      recordComposition('compositionstart', event);
      applyEffects(machine.dispatch({ type: 'compositionstart' }));
    },
    { signal },
  );
  textarea.addEventListener(
    'compositionupdate',
    (event) => {
      recordComposition('compositionupdate', event);
      applyEffects(machine.dispatch({ type: 'compositionupdate', data: event.data }));
    },
    { signal },
  );
  textarea.addEventListener(
    'compositionend',
    (event) => {
      recordComposition('compositionend', event);
      applyEffects(machine.dispatch({ type: 'compositionend', data: event.data }));
    },
    { signal },
  );
  textarea.addEventListener(
    'beforeinput',
    (event) => {
      recordInput('beforeinput', event);
      // 値の正は input（I-1）。beforeinput は記録のみで抑止しない。
    },
    { signal },
  );
  textarea.addEventListener(
    'input',
    (event) => {
      // textarea のユーザー入力は常に InputEvent（プログラム的 value 設定では発火しない）。
      if (event instanceof InputEvent) {
        recordInput('input', event);
        applyEffects(
          machine.dispatch({
            type: 'input',
            value: textarea.value,
            isComposing: event.isComposing,
            inputType: event.inputType,
          }),
        );
      }
    },
    { signal },
  );
  textarea.addEventListener(
    'keydown',
    (event) => {
      recordKeyboard('keydown', event);
      const effects = machine.dispatch({
        type: 'keydown',
        key: event.key,
        code: event.code,
        isComposing: event.isComposing,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
      // 状態機械が消費したキー（Move/Commit/Cancel/BeginEdit/SuppressKey）は既定動作を止める
      // （改行・フォーカス移動・確定 Enter の二重発火を防ぐ）。空エフェクトは既定に委ねる。
      if (effects.length > 0) {
        event.preventDefault();
      }
      applyEffects(effects);
    },
    { signal },
  );
  textarea.addEventListener(
    'keyup',
    (event) => {
      recordKeyboard('keyup', event);
      applyEffects(machine.dispatch({ type: 'keyup', key: event.key, isComposing: event.isComposing }));
    },
    { signal },
  );
  textarea.addEventListener(
    'focus',
    () => {
      recordSimple('focus');
      applyEffects(machine.dispatch({ type: 'focus' }));
    },
    { signal },
  );
  textarea.addEventListener(
    'blur',
    () => {
      recordSimple('blur');
      applyEffects(machine.dispatch({ type: 'blur' }));
    },
    { signal },
  );
  // pointerdown は textarea 外（別セルクリック）も採るため範囲を広げ、capture で最早記録する。
  // 論理的な pointerdown（セル選択・pendingNavigation 判定）は main が pointerdownCell で投入する。
  pointerTarget.addEventListener('pointerdown', () => recordSimple('pointerdown'), {
    signal,
    capture: true,
  });
  // §11.6 方式2: スクロール追従（位置のみ・composition 中も value/selection/DOM は不変）。
  host.addEventListener('scroll', followScroll, { signal });

  // 初期配置とフォーカス（入力受け口を textarea 一本に固定・DA #3）。
  place();
  focus();

  return {
    focus,
    getActiveCell: () => machine.getActiveCell(),
    getConflictCells: () => machine.getConflictCells(),
    isComposing: () => machine.isComposing(),
    pointerdownCell: (cell) => {
      const effects =
        cell === null
          ? machine.dispatch({ type: 'pointerdown', target: 'outside' })
          : machine.dispatch({ type: 'pointerdown', target: 'cell', cell });
      applyEffects(effects);
      // クリック選択後は入力受け口を textarea に戻す（変換中は自然な blur/compositionend に委ねる）。
      if (cell !== null && !machine.isComposing()) {
        focus();
      }
    },
    doubleClickCell: (cell) => {
      applyEffects(machine.dispatch({ type: 'doubleClick', cell }));
    },
    applyRemoteUpdate: (cell, value) => {
      // §11.7: リモート値は cell-store（Canvas の正）へ反映する（textarea/draft は書き換えない）。
      if (value === null) {
        store.clear(cell);
      } else {
        store.set(cell, value);
      }
      applyEffects(machine.dispatch({ type: 'remoteUpdate', cell, value }));
    },
    destroy: () => {
      abort.abort();
      textarea.remove();
    },
  };
}
