import { describe, expect, it, vi } from 'vitest';

import { createTextMetricsCache } from './text-cache';

/** 各文字を幅 10 とする決定論 measure（テスト用）。 */
function fixedWidthMeasure(text: string): number {
  return text.length * 10;
}

describe('TextMetricsCache: measureWidth のキャッシュ', () => {
  it('同一 font×text の再測定を避ける（measure は 1 回だけ）', () => {
    const measure = vi.fn(fixedWidthMeasure);
    const cache = createTextMetricsCache(measure);
    expect(cache.measureWidth('hello', '13px sans')).toBe(50);
    expect(cache.measureWidth('hello', '13px sans')).toBe(50);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(cache.size()).toBe(1);
  });

  it('font が違えば別エントリ', () => {
    const measure = vi.fn(fixedWidthMeasure);
    const cache = createTextMetricsCache(measure);
    cache.measureWidth('x', 'a');
    cache.measureWidth('x', 'b');
    expect(measure).toHaveBeenCalledTimes(2);
  });
});

describe('TextMetricsCache: fitText（clip 用の省略）', () => {
  const cache = createTextMetricsCache(fixedWidthMeasure);

  it('収まる文字列はそのまま', () => {
    expect(cache.fitText('abc', 'f', 100)).toBe('abc');
  });

  it('溢れる文字列は末尾を省略記号にして maxWidth に収める', () => {
    // 各文字幅10・省略記号も幅10。maxWidth=45 → 記号込みで 4 文字ぶん（"abc…"=40<=45）。
    const result = cache.fitText('abcdefgh', 'f', 45);
    expect(result.endsWith('…')).toBe(true);
    expect(fixedWidthMeasure(result)).toBeLessThanOrEqual(45);
  });

  it('極小幅は省略記号のみ', () => {
    expect(cache.fitText('abcdef', 'f', 10)).toBe('…');
  });

  it('空文字・幅0 は空', () => {
    expect(cache.fitText('', 'f', 100)).toBe('');
    expect(cache.fitText('abc', 'f', 0)).toBe('');
  });
});

describe('TextMetricsCache: clear', () => {
  it('clear で全キャッシュが消える', () => {
    const cache = createTextMetricsCache(fixedWidthMeasure);
    cache.measureWidth('a', 'f');
    expect(cache.size()).toBe(1);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});

describe('TextMetricsCache: FIFO 上限（10分試験の無制限増加を防ぐ）', () => {
  it('一意な文字列を上限超で投入しても size が上限を超えない', () => {
    const cache = createTextMetricsCache(fixedWidthMeasure, 100);
    for (let i = 0; i < 1000; i += 1) {
      cache.measureWidth(`text-${i}`, 'f');
    }
    expect(cache.size()).toBeLessThanOrEqual(100);
  });
});
