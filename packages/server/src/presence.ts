// connection 単位の Presence レジストリ（protocol-subset §6・計画書 §9）。
// 非永続・単調 sequence（古い更新は破棄）・colorKey 決定的割当（未使用最小 index）・注入クロックでの TTL 失効。
// トランスポート非依存: メッセージ配信は Room が行い、本レジストリは状態管理のみ担う。

import type { PresencePayload, SelectionById, UserPresence } from '@nanairo-sheet/core';

import type { Clock } from './deps';

interface PresenceEntry {
  connectionId: string;
  colorIndex: number;
  colorKey: string;
  lastSeen: number;
  presence: UserPresence | undefined; // 最初の presence メッセージ受信までは undefined（colorKey だけ予約）
}

/** sweep が返す失効接続（hadPresence=presence を持っていた＝presenceRemoved を配信すべき接続）。 */
export interface RemovedConnection {
  connectionId: string;
  hadPresence: boolean;
}

export class PresenceRegistry {
  private readonly clock: Clock;
  private readonly ttlMillis: number;
  private readonly entries = new Map<string, PresenceEntry>();
  private readonly usedColorIndices = new Set<number>();

  constructor(deps: { clock: Clock; ttlMillis: number }) {
    this.clock = deps.clock;
    this.ttlMillis = deps.ttlMillis;
  }

  /** 接続を登録し colorKey を予約する（join 時）。既存なら現行 colorKey を返す。lastSeen=now。 */
  register(connectionId: string): string {
    const existing = this.entries.get(connectionId);
    if (existing !== undefined) {
      existing.lastSeen = this.clock.now();
      return existing.colorKey;
    }
    const colorIndex = this.allocateColorIndex();
    const colorKey = `color-${colorIndex}`;
    this.entries.set(connectionId, {
      connectionId,
      colorIndex,
      colorKey,
      lastSeen: this.clock.now(),
      presence: undefined,
    });
    return colorKey;
  }

  /** 生存通知（heartbeat 等）で有効期限を更新する。未登録は無視。 */
  touch(connectionId: string): void {
    const entry = this.entries.get(connectionId);
    if (entry !== undefined) {
      entry.lastSeen = this.clock.now();
    }
  }

  /**
   * Presence を更新する。単調 sequence で古い更新（sequence <= 保持）は破棄し undefined を返す（S-L3）。
   * 受理時は確定した UserPresence を返す（Room が presenceDelta で配信）。未登録は undefined（join 前提）。
   */
  update(connectionId: string, sequence: number, payload: PresencePayload): UserPresence | undefined {
    const entry = this.entries.get(connectionId);
    if (entry === undefined) {
      return undefined;
    }
    // どの presence メッセージも proof of life として lastSeen は更新する（内容の反映は sequence 次第）。
    entry.lastSeen = this.clock.now();
    if (entry.presence !== undefined && sequence <= entry.presence.sequence) {
      return undefined; // 古い/同値の更新は破棄
    }
    const presence: UserPresence = {
      connectionId,
      colorKey: entry.colorKey,
      sequence,
      userId: payload.userId,
      displayName: payload.displayName,
      activeCell: payload.activeCell === undefined ? undefined : { ...payload.activeCell },
      selectionRanges: payload.selectionRanges.map((range: SelectionById) => ({ ...range })),
      editingCell: payload.editingCell === undefined ? undefined : { ...payload.editingCell },
    };
    entry.presence = presence;
    return presence;
  }

  /** 接続を削除し colorKey を解放する（正常 close）。presence を持っていたかを返す。 */
  remove(connectionId: string): boolean {
    const entry = this.entries.get(connectionId);
    if (entry === undefined) {
      return false;
    }
    this.usedColorIndices.delete(entry.colorIndex);
    this.entries.delete(connectionId);
    return entry.presence !== undefined;
  }

  /**
   * TTL 超過（(now - lastSeen) > ttlMillis）の接続を失効させる。明示呼び出しで発火（実時間待ちに依存しない・DA D6）。
   * 失効接続を返す（hadPresence の分だけ Room が presenceRemoved を配信）。colorKey は解放。
   */
  sweep(): RemovedConnection[] {
    const now = this.clock.now();
    const removed: RemovedConnection[] = [];
    for (const [connectionId, entry] of this.entries) {
      if (now - entry.lastSeen > this.ttlMillis) {
        this.usedColorIndices.delete(entry.colorIndex);
        this.entries.delete(connectionId);
        removed.push({ connectionId, hadPresence: entry.presence !== undefined });
      }
    }
    return removed;
  }

  /** presence 確定済み（最低 1 回 presence を送った）接続の一覧（presenceSnapshot 用）。 */
  snapshot(): UserPresence[] {
    const result: UserPresence[] = [];
    for (const entry of this.entries.values()) {
      if (entry.presence !== undefined) {
        result.push(entry.presence);
      }
    }
    return result;
  }

  get(connectionId: string): UserPresence | undefined {
    return this.entries.get(connectionId)?.presence;
  }

  has(connectionId: string): boolean {
    return this.entries.has(connectionId);
  }

  /** 未使用の最小非負 index を割り当てる（同色回避・解放後は再利用＝決定的・指示 6）。 */
  private allocateColorIndex(): number {
    let index = 0;
    while (this.usedColorIndices.has(index)) {
      index += 1;
    }
    this.usedColorIndices.add(index);
    return index;
  }
}
