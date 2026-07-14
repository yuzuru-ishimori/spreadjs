// grid Facade の診断ログ hook（opt-in・既定無出力・Experimental 0.x）。
//
// consumer が GridMountOptions.onDiagnostic を渡したときだけ診断エントリを生成・配信する。未指定時は emit が
// 完全な no-op で、entry 生成も now() 呼び出しも行わない（既定無出力＝hot path への性能影響を持たない）。診断は
// 副次機能ゆえ、consumer hook が例外を投げても mount 本体へは波及させない。本ファイルは DOM 非依存で単体テスト可能。

/** 診断エントリの重大度。 */
export type GridDiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

/** 診断エントリ（debug hook opt-in 時のみ生成）。 */
export interface GridDiagnostic {
  readonly level: GridDiagnosticLevel;
  /** 安定した診断イベント識別子（例 'boot-start' / 'config-resolved' / 'connection'）。 */
  readonly code: string;
  readonly message: string;
  /** epoch ms（生成時刻）。 */
  readonly timestamp: number;
}

/** 診断ログの購読口（consumer が opt-in する）。 */
export type GridDiagnosticHook = (entry: GridDiagnostic) => void;

/** 診断エントリの生成・配信口。hook 未指定なら emit は完全な no-op（entry を作らない）。 */
export interface DiagnosticSink {
  /** hook が指定されているか（呼び出し側が重い診断組み立てを条件分岐するのに使える）。 */
  readonly enabled: boolean;
  emit(level: GridDiagnosticLevel, code: string, message: string): void;
}

/**
 * onDiagnostic hook から DiagnosticSink を作る。hook 未指定時は emit が何もしない（既定無出力・now も呼ばない）。
 * hook が例外を投げても本体の mount 動作を壊さない（診断の失敗を握りつぶす）。
 */
export function createDiagnosticSink(
  hook: GridDiagnosticHook | undefined,
  now: () => number = Date.now,
): DiagnosticSink {
  if (hook === undefined) {
    return {
      enabled: false,
      emit() {
        // 既定無出力: 診断 hook が無ければ何もしない。
      },
    };
  }
  return {
    enabled: true,
    emit(level, code, message) {
      try {
        hook({ level, code, message, timestamp: now() });
      } catch {
        // 診断 hook の失敗は本体へ波及させない（副次機能）。
      }
    },
  };
}
