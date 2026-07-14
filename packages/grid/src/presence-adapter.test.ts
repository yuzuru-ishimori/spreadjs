import { describe, expect, it } from 'vitest';

import type { UserPresence } from '@nanairo-sheet/core';
import { createColumnId, createRowId } from '@nanairo-sheet/types';
import type { ColumnId, RowId } from '@nanairo-sheet/types';

import { colorKeyToIndex, toPresenceUsers, type PresenceIndexResolver } from './presence-adapter';

// r0..r4 → index 0..4 / c0..c2 → 0..2 の単純解決器（未知は -1）。
const resolver: PresenceIndexResolver = {
  rowIndexOf: (rowId: RowId) => {
    const m = /^r(\d+)$/.exec(rowId);
    return m ? Number(m[1]) : -1;
  },
  colIndexOf: (columnId: ColumnId) => {
    const m = /^c(\d+)$/.exec(columnId);
    return m ? Number(m[1]) : -1;
  },
};

function presence(over: Partial<UserPresence> & Pick<UserPresence, 'connectionId'>): UserPresence {
  return {
    userId: 'u',
    displayName: 'ユーザー',
    colorKey: '1',
    sequence: 1,
    selectionRanges: [],
    ...over,
  };
}

describe('colorKeyToIndex', () => {
  it('数値文字列はそのまま', () => {
    expect(colorKeyToIndex('0')).toBe(0);
    expect(colorKeyToIndex('7')).toBe(7);
  });
  it('非数値は決定論ハッシュ（同一入力→同一出力・非負）', () => {
    const a = colorKeyToIndex('conn-abc');
    expect(a).toBe(colorKeyToIndex('conn-abc'));
    expect(a).toBeGreaterThanOrEqual(0);
  });
});

describe('toPresenceUsers（UserPresence→overlay PresenceUser）', () => {
  it('editingCell を優先して activeRow/Col へ解決', () => {
    const users = toPresenceUsers(
      [
        presence({
          connectionId: 'conn-1',
          activeCell: { rowId: createRowId('r0'), columnId: createColumnId('c0') },
          editingCell: { rowId: createRowId('r3'), columnId: createColumnId('c2') },
        }),
      ],
      resolver,
    );
    expect(users).toHaveLength(1);
    expect(users[0].activeRow).toBe(3);
    expect(users[0].activeCol).toBe(2);
    expect(users[0].id).toBe('conn-1');
  });

  it('editingCell が無ければ activeCell を使う', () => {
    const users = toPresenceUsers(
      [presence({ connectionId: 'c', activeCell: { rowId: createRowId('r2'), columnId: createColumnId('c1') } })],
      resolver,
    );
    expect(users[0].activeRow).toBe(2);
    expect(users[0].activeCol).toBe(1);
  });

  it('可視 Axis に解決できない他者（index<0）は描かない', () => {
    const users = toPresenceUsers(
      [presence({ connectionId: 'c', activeCell: { rowId: createRowId('r999x'), columnId: createColumnId('c0') } })],
      resolver,
    );
    expect(users).toHaveLength(0);
  });

  it('activeCell も editingCell も無ければ描かない', () => {
    expect(toPresenceUsers([presence({ connectionId: 'c' })], resolver)).toHaveLength(0);
  });

  it('selectionRanges の先頭を index 矩形へ解決（min/max・end 排他）', () => {
    const users = toPresenceUsers(
      [
        presence({
          connectionId: 'c',
          activeCell: { rowId: createRowId('r1'), columnId: createColumnId('c1') },
          selectionRanges: [
            {
              startRowId: createRowId('r3'),
              startColumnId: createColumnId('c2'),
              endRowId: createRowId('r1'),
              endColumnId: createColumnId('c0'),
            },
          ],
        }),
      ],
      resolver,
    );
    expect(users[0].selRowStart).toBe(1);
    expect(users[0].selRowEnd).toBe(4); // max(3,1)+1
    expect(users[0].selColStart).toBe(0);
    expect(users[0].selColEnd).toBe(3); // max(2,0)+1
  });
});
