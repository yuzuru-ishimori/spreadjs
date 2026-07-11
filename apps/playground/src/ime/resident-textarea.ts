// 最小版・常駐 textarea（DD-002 新 Phase 2）。
//
// 目的は「状態機械を作る前に実 IME の生挙動を採取する」こと。ここでは高度な制御
// （確定 Enter 抑止 = §11.5 の suppressCommitUntilKeyup 互換層など）を入れず、
// 生イベントをそのまま観察できるよう **最小の commit/cancel だけ** を行う。
// 本格的な編集状態機械（editor-state-machine.ts）は Phase 3 で実トレース確認後に作る。
//
// §11.3 常駐 textarea 原則を守る:
// - グリッドに 1 個だけ生成し破棄しない（destroy まで保持）
// - display:none / visibility:hidden / ゼロサイズにしない
// - アクティブセル位置へ配置（IME 候補ウィンドウの基準をセル近傍に保つ）
// - Navigation 中は値を空にし、直接入力で置換編集
// - F2 / ダブルクリック時だけ既存値を設定
// - composition 中に value / selection / DOM 親を変更しない（背景色の paint のみ許容）
//
// 本モジュールは DOM に依存する「配線アダプタ」。DOM 非依存のロジック（recorder の整形・
// ナビゲーション計算）は event-recorder / navigation が担う。

import type {
  EventRecorder,
  RecordedEventType,
  RecorderContext,
  RecorderEventSnapshot,
  TraceEnvironment,
} from './event-recorder';
import { type CellPosition, type GridLayout, cellRect } from '../grid/geometry';
import { type CellStore } from '../grid/cell-store';
import { type NavigationDirection, keyToDirection } from '../grid/navigation';

/** main が保持するアクティブセルへの読み書き（Phase 2 は main 所有。Phase 3 で machine へ一本化）。 */
export interface EditorSelection {
  /** 現在のアクティブセル。 */
  get(): CellPosition;
  /** アクティブセルを設定し再描画する（pointerdown 選択）。 */
  set(cell: CellPosition): void;
  /** 指定方向へ 1 セル移動し再描画する（端はクランプ）。 */
  move(direction: NavigationDirection): void;
}

export interface ResidentEditorOptions {
  /** textarea を配置するスクロールコンテナ（position: relative・グリッドと一緒にスクロール）。 */
  readonly host: HTMLElement;
  /** pointerdown を記録する範囲（通常は host 全体）。 */
  readonly pointerTarget: HTMLElement;
  readonly layout: GridLayout;
  readonly store: CellStore;
  readonly selection: EditorSelection;
  readonly recorder: EventRecorder;
  /** 記録時の環境を供給する（trace-panel の ime 手入力を反映）。 */
  readonly getEnvironment: () => TraceEnvironment;
  /** 記録・状態変化のたびに呼ぶ（パネル更新など）。 */
  readonly onActivity?: () => void;
}

export interface ResidentEditor {
  /** 常駐 textarea へフォーカスする（入力受け口を 1 本に保つ・§11.9 I-5）。 */
  focus(): void;
  /** textarea をアクティブセル位置へ再配置する。 */
  place(): void;
  /** F2 / ダブルクリック相当。既存値を読み込んで編集開始（キャレット末尾）。 */
  beginExisting(cell: CellPosition): void;
  /** 編集中なら現在の draft を確定する（移動しない。pointerdown 選択の前段）。 */
  commit(): void;
  /** 編集中か。 */
  isEditing(): boolean;
  /** IME 変換中か（変換中は移動・再配置で composition を壊さない・§11.6/I-3）。 */
  isComposing(): boolean;
  /** リスナー解除と textarea 除去。 */
  destroy(): void;
}

/** 編集中セルの背景（下地の確定値を隠す。paint のみで composition を壊さない）。 */
const EDITING_BACKGROUND = '#ffffff';
/** グリッドのセル文字と揃えるフォント（grid-view と一致させる）。 */
const CELL_FONT = '13px system-ui, sans-serif';

/**
 * 最小版・常駐 textarea を生成する。
 */
export function createResidentEditor(options: ResidentEditorOptions): ResidentEditor {
  const { host, pointerTarget, layout, store, selection, recorder } = options;
  const abort = new AbortController();
  const { signal } = abort;

  const textarea = document.createElement('textarea');
  textarea.className = 'cell-editor';
  textarea.setAttribute('aria-label', 'セル入力');
  // 1 行入力として扱う（改行はグリッド移動へ割り当てるため spellcheck 等も抑制）。
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

  // 最小の編集モード。'navigation'（未編集・空）/ 'editing'（編集中）。
  // 状態機械ではない（Phase 3）。composing は trace の状態ラベルと介入抑止の判断に使う。
  let mode: 'navigation' | 'editing' = 'navigation';
  let composing = false;

  const currentStateLabel = (): string => {
    if (mode === 'navigation') {
      return 'Navigation';
    }
    return composing ? 'Composing' : 'Editing';
  };

  const currentContext = (): RecorderContext => ({
    environment: options.getEnvironment(),
    state: currentStateLabel(),
    activeCell: selection.get(),
  });

  // --- 記録（イベント受信直後・preventDefault より前に呼ぶ = DA #5） ---

  const readSnapshotBase = (type: RecordedEventType): Pick<
    RecorderEventSnapshot,
    'type' | 'timestamp' | 'value' | 'selectionStart' | 'selectionEnd'
  > => ({
    type,
    timestamp: Math.round(performance.now()),
    value: textarea.value,
    selectionStart: textarea.selectionStart,
    selectionEnd: textarea.selectionEnd,
  });

  const record = (snapshot: RecorderEventSnapshot): void => {
    recorder.record(snapshot, currentContext());
    options.onActivity?.();
  };

  const recordKeyboard = (type: 'keydown' | 'keyup', event: KeyboardEvent): void => {
    record({
      ...readSnapshotBase(type),
      key: event.key,
      code: event.code,
      isComposing: event.isComposing,
    });
  };

  const recordInput = (type: 'beforeinput' | 'input', event: InputEvent): void => {
    record({
      ...readSnapshotBase(type),
      inputType: event.inputType,
      data: event.data,
      isComposing: event.isComposing,
    });
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

  // --- 最小の編集ライフサイクル ---

  const place = (): void => {
    // composition 中は DOM 位置を動かさない（I-3）。Navigation ではアクティブセルへ追従。
    if (composing) {
      return;
    }
    const rect = cellRect(layout, selection.get());
    textarea.style.left = `${rect.x}px`;
    textarea.style.top = `${rect.y}px`;
    textarea.style.width = `${rect.width}px`;
    textarea.style.height = `${rect.height}px`;
  };

  const focus = (): void => {
    textarea.focus();
  };

  // 直接入力（非 IME）/ compositionstart で置換編集を開始する。
  // textarea は Navigation 中は空なので、入力済み文字がそのまま draft になる（value を触らない・I-3）。
  const enterEditingReplace = (): void => {
    if (mode === 'editing') {
      return;
    }
    mode = 'editing';
    textarea.style.background = EDITING_BACKGROUND;
  };

  const endEditing = (): void => {
    mode = 'navigation';
    composing = false;
    textarea.value = '';
    textarea.style.background = 'transparent';
  };

  const commit = (): void => {
    if (mode !== 'editing') {
      return;
    }
    // 値の正は input 後の textarea.value（I-1）。整形しない。
    store.set(selection.get(), textarea.value);
    endEditing();
    place();
  };

  const commitAndMove = (direction: NavigationDirection): void => {
    commit();
    selection.move(direction);
    place();
    focus();
  };

  const cancelEdit = (): void => {
    endEditing();
    place();
    focus();
  };

  const beginExisting = (cell: CellPosition): void => {
    selection.set(cell);
    place();
    mode = 'editing';
    // F2 / ダブルクリックのときだけ既存値を設定（§11.3・§11.4）。
    textarea.value = store.get(cell);
    const caret = textarea.value.length;
    textarea.setSelectionRange(caret, caret);
    textarea.style.background = EDITING_BACKGROUND;
    focus();
    options.onActivity?.();
  };

  // --- keydown の最小制御（記録は済み。ここでは生挙動を極力変えない） ---

  const handleKeydown = (event: KeyboardEvent): void => {
    // 変換中は一切介入しない（確定 Enter を通常 Enter 扱いしない = §11.9 I-4 / 生挙動観察）。
    if (event.isComposing) {
      return;
    }

    if (mode === 'editing') {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitAndMove(event.shiftKey ? 'up' : 'down');
      } else if (event.key === 'Tab') {
        // Tab の既定（フォーカス移動）を止め、単一 textarea を維持する（I-5）。
        event.preventDefault();
        commitAndMove(event.shiftKey ? 'left' : 'right');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelEdit();
      }
      // 文字・Backspace 等は textarea の既定編集に委ねる（draft は input で反映）。
      return;
    }

    // Navigation 中。
    const direction = keyToDirection({ key: event.key, shiftKey: event.shiftKey });
    if (direction !== null) {
      // Enter/Tab/矢印 は移動（textarea への改行・フォーカス移動を止める）。
      event.preventDefault();
      selection.move(direction);
      place();
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      beginExisting(selection.get());
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      store.clear(selection.get());
      return;
    }
    // 印字可能キー等は textarea の既定入力に委ね、input/compositionstart で編集開始する
    // （§11.9: 文字キーを検出してから input を生成・focus しない）。
  };

  // --- DOM リスナー（記録を最優先。preventDefault より前） ---

  textarea.addEventListener(
    'compositionstart',
    (event) => {
      recordComposition('compositionstart', event);
      composing = true;
      enterEditingReplace();
    },
    { signal },
  );
  textarea.addEventListener(
    'compositionupdate',
    (event) => {
      // draft は input 後の value が正（I-1）。ここでは記録のみで value を触らない。
      recordComposition('compositionupdate', event);
    },
    { signal },
  );
  textarea.addEventListener(
    'compositionend',
    (event) => {
      recordComposition('compositionend', event);
      // 確定テキストは後続 input で value に載る（I-1）。最小版では追加処理をしない。
      composing = false;
    },
    { signal },
  );
  textarea.addEventListener(
    'beforeinput',
    (event) => {
      recordInput('beforeinput', event);
      // 生挙動観察のため beforeinput を抑止しない。
    },
    { signal },
  );
  textarea.addEventListener(
    'input',
    (event) => {
      // 'input' は DOM lib で汎用 Event 型のため InputEvent へ型ガードで絞り込む
      // （textarea のユーザー入力は常に InputEvent。プログラム的な value 設定では発火しない）。
      if (event instanceof InputEvent) {
        recordInput('input', event);
      }
      // 非 IME の直接入力はここで編集開始（compositionstart を伴わない ASCII など）。
      if (mode === 'navigation') {
        enterEditingReplace();
      }
    },
    { signal },
  );
  textarea.addEventListener(
    'keydown',
    (event) => {
      recordKeyboard('keydown', event);
      handleKeydown(event);
    },
    { signal },
  );
  textarea.addEventListener(
    'keyup',
    (event) => {
      recordKeyboard('keyup', event);
    },
    { signal },
  );
  textarea.addEventListener('focus', () => recordSimple('focus'), { signal });
  textarea.addEventListener('blur', () => recordSimple('blur'), { signal });
  // pointerdown は textarea 外（別セルクリック）も採るため範囲を広げ、capture で最早記録する。
  pointerTarget.addEventListener('pointerdown', () => recordSimple('pointerdown'), {
    signal,
    capture: true,
  });

  // 初期配置とフォーカス（入力受け口を textarea 一本に固定・DA #3）。
  place();
  focus();

  return {
    focus,
    place,
    beginExisting,
    commit,
    isEditing: () => mode === 'editing',
    isComposing: () => composing,
    destroy: () => {
      abort.abort();
      textarea.remove();
    },
  };
}
