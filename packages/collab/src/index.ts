// @nanairo-sheet/collab の公開エントリ。共同編集クライアント（ClientSession＝楽観適用・§7.7
// rollback/replay・Conflict Queue・再送/再接続）、トランスポート抽象（ClientTransport/TransportListener）、
// 注入依存（Clock/IdGenerator）、JSON 境界の型安全 codec（decode）を re-export する。
// apps/collaboration-server は Node ws トランスポート、apps/playground はブラウザー native WebSocket
// トランスポートを実装してここへ注入する（DD-005 案A）。
//
// この本体エントリはトランスポート非依存・外部ランタイム依存ゼロ（core / types の型・関数のみ）。
// 試験専用の in-process ハーネス（InProcessHub＝Room 依存）とテストビルダーは本体を汚さないよう
// サブパス（`@nanairo-sheet/collab/inprocess-transport`・`/test-support`）でのみ公開する。
export * from './session';
export * from './deps';
export * from './message-codec';
