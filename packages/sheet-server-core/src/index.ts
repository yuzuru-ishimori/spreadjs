// @nanairo-sheet/sheet-server-core の公開エントリ。全順序シーケンサー・権威 Room・Presence レジストリ・
// スナップショット・注入依存を re-export する。Phase 4 の WS アダプター（apps/collaboration-server）が
// ここから型と実装を import して実トランスポートへ配線する。メッセージ型は sheet-core の protocol を使う。
export * from './deps';
export * from './sequencer';
export * from './presence';
export * from './room';
export * from './snapshot';
