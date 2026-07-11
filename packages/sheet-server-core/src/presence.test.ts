import { describe, expect, it } from 'vitest';

import type { PresencePayload } from '@nanairo-sheet/sheet-core';

import { PresenceRegistry } from './presence';
import { col, createManualClock, row } from './test-support';
import type { ManualClock } from './test-support';

function createRegistry(ttlMillis = 15_000): { registry: PresenceRegistry; clock: ManualClock } {
  const clock = createManualClock();
  return { registry: new PresenceRegistry({ clock, ttlMillis }), clock };
}

const payload = (overrides: Partial<PresencePayload> = {}): PresencePayload => ({
  userId: overrides.userId ?? 'user-1',
  displayName: overrides.displayName ?? 'Alice',
  activeCell: overrides.activeCell,
  selectionRanges: overrides.selectionRanges ?? [],
  editingCell: overrides.editingCell,
});

describe('PresenceRegistry — colorKey 決定的割当（指示 6）', () => {
  it('登録順に color-0, color-1, ... を割り当てる（同色回避）', () => {
    const { registry } = createRegistry();
    expect(registry.register('conn-1')).toBe('color-0');
    expect(registry.register('conn-2')).toBe('color-1');
    expect(registry.register('conn-3')).toBe('color-2');
  });

  it('remove で解放した色は最小未使用 index として再利用される', () => {
    const { registry } = createRegistry();
    registry.register('conn-1'); // color-0
    registry.register('conn-2'); // color-1
    registry.remove('conn-1'); // color-0 解放
    expect(registry.register('conn-3')).toBe('color-0'); // 最小未使用=0 を再利用
    expect(registry.register('conn-4')).toBe('color-2'); // 0,1 使用中 → 2
  });
});

describe('PresenceRegistry — update / sequence 単調（S-L3）', () => {
  it('未登録の connectionId への update は undefined（join 前提）', () => {
    const { registry } = createRegistry();
    expect(registry.update('conn-x', 1, payload())).toBeUndefined();
  });

  it('最初の presence は任意 sequence を受理し UserPresence を返す', () => {
    const { registry } = createRegistry();
    registry.register('conn-1');
    const presence = registry.update('conn-1', 5, payload({ activeCell: { rowId: row('row-1'), columnId: col('col-a') } }));
    expect(presence).toBeDefined();
    expect(presence?.sequence).toBe(5);
    expect(presence?.colorKey).toBe('color-0');
    expect(presence?.activeCell).toEqual({ rowId: row('row-1'), columnId: col('col-a') });
  });

  it('sequence <= 保持 の更新は破棄（undefined）し、保持状態を維持', () => {
    const { registry } = createRegistry();
    registry.register('conn-1');
    registry.update('conn-1', 5, payload({ displayName: 'v5' }));
    expect(registry.update('conn-1', 3, payload({ displayName: 'v3' }))).toBeUndefined(); // 古い
    expect(registry.update('conn-1', 5, payload({ displayName: 'v5b' }))).toBeUndefined(); // 同値
    expect(registry.get('conn-1')?.displayName).toBe('v5'); // 維持
    expect(registry.update('conn-1', 6, payload({ displayName: 'v6' }))?.displayName).toBe('v6'); // 前進
  });

  it('payload の cell/selection は防御コピーされる（呼び出し側の後続変更に影響されない）', () => {
    const { registry } = createRegistry();
    registry.register('conn-1');
    const ranges = [{ startRowId: row('row-1'), startColumnId: col('col-a'), endRowId: row('row-2'), endColumnId: col('col-b') }];
    const stored = registry.update('conn-1', 1, payload({ selectionRanges: ranges }));
    ranges.push({ startRowId: row('row-9'), startColumnId: col('col-a'), endRowId: row('row-9'), endColumnId: col('col-a') });
    expect(stored?.selectionRanges).toHaveLength(1); // 元の配列変更に非連動
  });
});

describe('PresenceRegistry — TTL sweep（注入クロック・DA D6）', () => {
  it('(now - lastSeen) <= ttl は維持、> ttl で失効', () => {
    const { registry, clock } = createRegistry(15_000);
    registry.register('conn-1'); // lastSeen=0
    registry.update('conn-1', 1, payload());
    clock.set(15_000); // 差 15000 == ttl → 維持
    expect(registry.sweep()).toEqual([]);
    clock.set(15_001); // 差 15001 > ttl → 失効
    expect(registry.sweep()).toEqual([{ connectionId: 'conn-1', hadPresence: true }]);
    expect(registry.has('conn-1')).toBe(false);
  });

  it('touch で lastSeen を更新すると失効が延びる', () => {
    const { registry, clock } = createRegistry(15_000);
    registry.register('conn-1');
    clock.set(10_000);
    registry.touch('conn-1'); // lastSeen=10000
    clock.set(20_000); // 差 10000 <= ttl → 維持
    expect(registry.sweep()).toEqual([]);
  });

  it('presence 未送信の接続が失効しても hadPresence=false（presenceRemoved 非配信の判断材料）', () => {
    const { registry, clock } = createRegistry(15_000);
    registry.register('conn-1'); // presence 未送信
    clock.set(20_000);
    expect(registry.sweep()).toEqual([{ connectionId: 'conn-1', hadPresence: false }]);
  });

  it('sweep で失効した接続の colorKey は解放され再利用される', () => {
    const { registry, clock } = createRegistry(15_000);
    registry.register('conn-1'); // color-0
    clock.set(20_000);
    registry.sweep();
    clock.set(20_000);
    expect(registry.register('conn-2')).toBe('color-0'); // 再利用
  });
});

describe('PresenceRegistry — snapshot / remove', () => {
  it('snapshot は presence 確定済みのみ返す（register だけの接続は含めない）', () => {
    const { registry } = createRegistry();
    registry.register('conn-1');
    registry.register('conn-2');
    registry.update('conn-1', 1, payload({ displayName: 'A' }));
    expect(registry.snapshot().map((u) => u.connectionId)).toEqual(['conn-1']);
  });

  it('remove は presence の有無を返す', () => {
    const { registry } = createRegistry();
    registry.register('conn-1');
    expect(registry.remove('conn-1')).toBe(false); // presence 未送信
    registry.register('conn-2');
    registry.update('conn-2', 1, payload());
    expect(registry.remove('conn-2')).toBe(true);
    expect(registry.remove('conn-x')).toBe(false); // 未登録
  });
});
