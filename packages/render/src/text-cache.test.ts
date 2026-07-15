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

describe('TextMetricsCache: wrapLines（列単位 wrap の行分割・D4）', () => {
  const cache = createTextMetricsCache(fixedWidthMeasure);

  it('maxWidth に収まる文字列は 1 行', () => {
    // 各文字幅10・maxWidth=100 → 10 文字まで 1 行。
    expect(cache.wrapLines('abcde', 'f', 100)).toEqual(['abcde']);
  });

  it('溢れる文字列を文字単位で貪欲分割する（CJK 前提・単語境界なし）', () => {
    // 各文字幅10・maxWidth=30 → 1 行 3 文字。
    expect(cache.wrapLines('abcdefg', 'f', 30)).toEqual(['abc', 'def', 'g']);
  });

  it('1 文字が maxWidth を超えても最低 1 文字は載せる（無限ループ防止）', () => {
    // maxWidth=5 < 文字幅10 でも各行 1 文字。
    expect(cache.wrapLines('abc', 'f', 5)).toEqual(['a', 'b', 'c']);
  });

  it('明示改行 \\n はハード改行として扱う', () => {
    expect(cache.wrapLines('ab\ncd', 'f', 100)).toEqual(['ab', 'cd']);
  });

  it('空文字は [""]（1 行扱い＝自動行高で 1 行と数える）', () => {
    expect(cache.wrapLines('', 'f', 100)).toEqual(['']);
  });

  it('maxWidth<=0 は折り返さず返す（幅未確定フレームの安全弁）', () => {
    expect(cache.wrapLines('abc', 'f', 0)).toEqual(['abc']);
  });

  it('同一 key はキャッシュされ再測定しない', () => {
    const measure = vi.fn(fixedWidthMeasure);
    const c = createTextMetricsCache(measure);
    c.wrapLines('abcdefg', 'f', 30);
    const callsAfterFirst = measure.mock.calls.length;
    c.wrapLines('abcdefg', 'f', 30);
    expect(measure.mock.calls.length).toBe(callsAfterFirst); // 2 回目は測定しない
  });

  it('LRU（D4）: ヒットで最新化され、追い出しは最古の未使用から（FIFO ではない・Codex P2）', () => {
    // 上限 2。オブジェクト同一性で「キャッシュ保持（同一 instance）／再計算（別 instance）」を見分ける。
    const c = createTextMetricsCache(fixedWidthMeasure, 2);
    const a1 = c.wrapLines('aa', 'f', 100);
    const b1 = c.wrapLines('bb', 'f', 100);
    expect(c.wrapLines('aa', 'f', 100)).toBe(a1); // ヒット → aa を最新化（LRU promote）
    c.wrapLines('cc', 'f', 100); // 上限超 → 最古（bb）を追い出す（LRU なら aa は残る）
    expect(c.wrapLines('aa', 'f', 100)).toBe(a1); // aa は保持（同一 instance）＝LRU が効いている
    expect(c.wrapLines('bb', 'f', 100)).not.toBe(b1); // bb は追い出され再計算（別 instance）
  });

  it('clear で wrap キャッシュも消える（DPR 変更・Web font 読込時）', () => {
    const measure = vi.fn(fixedWidthMeasure);
    const c = createTextMetricsCache(measure);
    c.wrapLines('abcdefg', 'f', 30);
    const before = measure.mock.calls.length;
    c.clear();
    c.wrapLines('abcdefg', 'f', 30);
    expect(measure.mock.calls.length).toBeGreaterThan(before); // 再測定される
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
