import { describe, expect, it, vi } from 'vitest';

import { createDiagnosticSink } from './diagnostics';
import type { GridDiagnostic } from './diagnostics';

describe('createDiagnosticSink: opt-in・既定無出力の debug logging hook', () => {
  it('hook 未指定なら enabled=false・emit は完全な no-op（既定無出力）', () => {
    const sink = createDiagnosticSink(undefined);
    expect(sink.enabled).toBe(false);
    // 何も購読していないので投げても無出力・無例外。
    expect(() => sink.emit('info', 'boot-start', 'x')).not.toThrow();
  });

  it('hook 指定時は emit で診断エントリを配信する（level/code/message/timestamp）', () => {
    const received: GridDiagnostic[] = [];
    const sink = createDiagnosticSink((e) => received.push(e), () => 1234);
    expect(sink.enabled).toBe(true);
    sink.emit('warn', 'connect-retry', 'reconnecting');
    expect(received).toEqual([
      { level: 'warn', code: 'connect-retry', message: 'reconnecting', timestamp: 1234 },
    ]);
  });

  it('hook が未指定なら now() も呼ばれない（生成コストを持たない）', () => {
    const now = vi.fn(() => 0);
    const sink = createDiagnosticSink(undefined, now);
    sink.emit('debug', 'x', 'y');
    expect(now).not.toHaveBeenCalled();
  });

  it('hook が例外を投げても本体へ波及させない（診断は副次機能）', () => {
    const sink = createDiagnosticSink(() => {
      throw new Error('consumer hook boom');
    });
    expect(() => sink.emit('error', 'boom', 'x')).not.toThrow();
  });
});
