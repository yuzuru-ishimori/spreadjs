// @nanairo-sheet/grid — Canvas 描画グリッドの唯一の公開面（Facade・Experimental 0.x・ADR-0015）。
//
// consumer は内部パッケージ（core/collab/render/selection/ime/types）を直接 import せず、この Facade だけを
// import する（R1）。mount() が内部パッケージを束ね、container 内に Canvas/scroller/常駐 textarea を構築し、
// 共同編集セッション・IME・仮想スクロール描画を配線する。destroy() で全リソース（listener/RAF/WS/canvas/
// textarea）を解放する（再mountで leak しない）。
//
// 【R7】公開シグネチャに内部パッケージ由来の型を出さない（GridEvent/GridConflict/GridConnectionState は
// 本 Facade が定義する。内部 SessionEvent/ConflictQueueEntry を写像して露出する）。boundary lint が本 index.ts を検査する。

import { createGridController } from './mount-controller';

// 公開エラー語彙・診断 hook は Facade 自前モジュールが定義する（内部 package 型ではない＝R7 に反さない）。
export { GRID_ERROR_CODES, GRID_CONFLICT_CODES } from './error-codes';
export type { GridErrorCode, GridConflictCode } from './error-codes';
export type { GridDiagnostic, GridDiagnosticLevel, GridDiagnosticHook } from './diagnostics';

import type { GridConflictCode, GridErrorCode } from './error-codes';
import type { GridDiagnosticHook } from './diagnostics';

/** 接続状態（consumer 表示用）。内部 collab の ConnectionState を写像した公開型（型は再exportしない）。 */
export type GridConnectionState = 'online' | 'offline' | 'stopped';

/** reject（競合）の理由。内部 collab の ConflictReason を写像した公開型。 */
export type GridConflictReason = 'rejected' | 'revalidation-failed' | 'dependency';

/**
 * 競合の公開サマリ（R7: 内部 ConflictQueueEntry の DocumentOperation/OperationViolation/RejectDetails は露出しない）。
 * Alpha は「競合の通知」を保証し、プログラム的な競合解決 UI の材料公開は Stage 2。
 */
export interface GridConflict {
  /** 競合したローカル Operation の ID（文字列化）。 */
  readonly operationId: string;
  /** 競合理由。 */
  readonly reason: GridConflictReason;
  /**
   * 安定した公開競合コード（内部 RejectCode を素通しせず公開語彙へ写像＝R7）。未知/未写像は 'unknown'。
   * 一覧は doc/DD/DD-017/error-codes.md を参照（GRID_CONFLICT_CODES）。
   */
  readonly code: GridConflictCode;
}

/**
 * grid が発火する公開イベント（lifecycle 契約: connection state・error notification）。
 * 内部 SessionEvent（connection/pending/rejected/divergence）を写像し、boot/transport 例外を error として整形する。
 */
export type GridEvent =
  | { readonly type: 'connection'; readonly state: GridConnectionState; readonly pendingCount: number }
  | { readonly type: 'pending'; readonly pendingCount: number }
  | { readonly type: 'rejected'; readonly pendingCount: number; readonly conflict: GridConflict }
  | { readonly type: 'divergence'; readonly serverRevision: number; readonly committedRevision: number }
  | {
      readonly type: 'error';
      readonly phase: 'config' | 'connect' | 'runtime';
      /** 安定した公開エラーコード（一覧は doc/DD/DD-017/error-codes.md＝GRID_ERROR_CODES）。 */
      readonly code: GridErrorCode;
      readonly message: string;
    }
  /**
   * レイアウト（列幅・行高）変更の確定通知（Experimental 0.x・DD-012-4 D2）。ヘッダー境界ドラッグの確定時
   * （pointerup）に発火する。columnWidths/rowHeights は **既定値と異なる列/行だけ**を含む（override のみ）。
   * 設定は view-local（他ユーザーへ即時同期しない）。利用側がこれを保存し、次回 mount の columnWidths/rowHeights へ
   * 渡せば F5 リロードで復元できる（共有保存にすれば他ユーザーへも反映）。キーは ColumnId/RowId 文字列。
   */
  | {
      readonly type: 'layout';
      readonly columnWidths: Record<string, number>;
      readonly rowHeights: Record<string, number>;
    };

export type GridEventListener = (event: GridEvent) => void;

/** grid をマウントする DOM ターゲット（Facade が container 内部に Canvas/scroller/textarea を構築する）。 */
export interface GridMountTarget {
  readonly container: HTMLElement;
}

/** mount 時オプション（Experimental 0.x）。 */
export interface GridMountOptions {
  /** 同期サーバーの HTTP オリジン（例 'http://127.0.0.1:8787'）。ws URL・/config はここから導出する。 */
  readonly serverUrl: string;
  /** 編集対象ドキュメント ID。未指定なら /config の documentId を使う。 */
  readonly documentId?: string;
  /** 列順。未指定なら serverUrl の /config から取得する（server-hono と対で運用・D1）。 */
  readonly columnOrder?: readonly string[];
  /** Presence 表示名。未指定なら匿名生成する。 */
  readonly displayName?: string;
  /** 再接続で不変のクライアント ID。未指定なら生成する（crypto.randomUUID）。 */
  readonly clientId?: string;
  /**
   * 初期の列幅 override（ColumnId 文字列→px・Experimental 0.x・DD-012-4 D2）。利用側が保存した設定を
   * 渡すと初期表示がその幅になる（F5 リロードでの復元手段）。既定値でよい列は含めない。
   */
  readonly columnWidths?: Readonly<Record<string, number>>;
  /** 初期の行高 override（RowId 文字列→px・Experimental 0.x・DD-012-4 D2）。 */
  readonly rowHeights?: Readonly<Record<string, number>>;
  /** 初期イベント購読（mount 直後の connection/error を取りこぼさない）。 */
  readonly onEvent?: GridEventListener;
  /**
   * 診断ログ hook（opt-in・既定無出力）。指定すると boot/接続/競合/破棄などの診断エントリが配信される。
   * 未指定なら診断は生成されない（性能影響なし）。障害切り分け用で GridEvent（consumer 契約）とは別系統。
   */
  readonly onDiagnostic?: GridDiagnosticHook;
}

/** mount が返すハンドル（consumer lifecycle 契約）。 */
export interface GridInstance {
  /** 編集対象ドキュメント ID（/config 解決後に確定。未解決時は options.documentId ?? ''）。 */
  readonly documentId: string;
  /** 現在の接続状態。 */
  connectionState(): GridConnectionState;
  /** イベント購読。返り値の関数で解除（unsubscribe）する。 */
  subscribe(listener: GridEventListener): () => void;
  /** グリッドへフォーカスする（入力受け口の常駐 textarea へ）。 */
  focus(): void;
  /** グリッドを破棄し DOM/listener/RAF/WS/canvas/textarea を解放する（再mountで leak しない）。 */
  destroy(): void;
}

/** 公開 API バージョン（Experimental 0.x・ADR-0015。破壊的変更は CHANGELOG=DD-017 で記録）。 */
export const GRID_API_VERSION = '0.1.0-experimental' as const;

/**
 * Canvas グリッドを container へマウントする。同期 return（boot＝/config 取得・WS 接続は内部で非同期進行し、
 * 進捗・失敗は GridEvent で通知する）。destroy() は boot 進行中に呼んでも安全。
 */
export function mount(target: GridMountTarget, options: GridMountOptions): GridInstance {
  return createGridController(target, options);
}
