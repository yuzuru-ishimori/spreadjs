// 機能カタログ（features.json）の整合性 smoke（DD-017-2 AC1/AC5/AC7）。
// 「紹介サイトが正本（roadmap §4 DD-009〜022・stage2-backlog・§6 境界）から乖離して腐る」ことを機械検出する。
import { describe, expect, it } from 'vitest';

import featuresData from './features.json';
import { SCENARIOS } from './demo/scenarios';

interface FeatureEntry {
  id: string;
  title: string;
  status: string;
  summary: string;
  source: string;
  demo?: string;
}

const features = (featuresData as { features: FeatureEntry[] }).features;
const VALID_STATUS = ['available', 'planned', 'out-of-scope'];

describe('features.json（機能カタログの単一データ源）', () => {
  it('全エントリが必須フィールドと有効な status を持つ', () => {
    for (const f of features) {
      expect(f.id, 'id 必須').toBeTruthy();
      expect(f.title, `${f.id}: title 必須`).toBeTruthy();
      expect(VALID_STATUS, `${f.id}: status 不正`).toContain(f.status);
      expect(f.summary, `${f.id}: summary（概要）必須＝未実装でも概要は記載する`).toBeTruthy();
      expect(f.source, `${f.id}: source（出典）必須＝正本との対応を保つ`).toBeTruthy();
    }
  });

  it('id が一意', () => {
    const ids = features.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('3区分すべてに1件以上ある（提供中・開発予定・対象外を常に見せる）', () => {
    for (const status of VALID_STATUS) {
      expect(
        features.filter((f) => f.status === status).length,
        `status=${status} が0件`,
      ).toBeGreaterThan(0);
    }
  });

  it('Stage 1 ロードマップの DD-009〜022 全番号が出典に登場する（roadmap §4 との突き合わせ＝AC1）', () => {
    const allSources = features.map((f) => f.source).join(' ');
    for (let n = 9; n <= 22; n++) {
      const dd = `DD-${String(n).padStart(3, '0')}`;
      expect(allSources, `${dd} が出典から漏れている`).toContain(dd);
    }
  });

  it('demo リンクは ./demo.html?scenario=<id> 形式で、実在するシナリオを指す', () => {
    for (const f of features) {
      if (f.demo === undefined) continue;
      expect(f.status, `${f.id}: demo リンクは提供中（available）のみ`).toBe('available');
      const match = /^\.\/demo\.html\?scenario=([a-z-]+)$/.exec(f.demo);
      expect(match, `${f.id}: demo リンク形式が不正: ${f.demo}`).not.toBeNull();
      const scenarioId = match![1]!;
      expect(
        SCENARIOS.some((s) => s.id === scenarioId),
        `${f.id}: シナリオ ${scenarioId} が scenarios.ts に存在しない`,
      ).toBe(true);
    }
  });

  it('全シナリオがカタログのどれかの機能からリンクされている（デッドシナリオなし）', () => {
    const linked = new Set(
      features
        .map((f) => f.demo)
        .filter((d): d is string => d !== undefined)
        .map((d) => /scenario=([a-z-]+)$/.exec(d)?.[1]),
    );
    for (const s of SCENARIOS) {
      expect(linked.has(s.id), `シナリオ ${s.id} がカタログから未リンク`).toBe(true);
    }
  });
});
