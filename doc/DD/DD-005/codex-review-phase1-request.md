# Codex レビュー依頼書 — DD-005 Phase 1（sheet-collaboration 抽出・挙動保存リファクタ）

## 目的（このレビューで見てほしいこと）

DD-005 Phase 1 は **案A: `packages/sheet-collaboration` の新設**。共同編集クライアント
（`ClientSession`＝楽観適用・§7.7 rollback/replay・Conflict Queue・再送/再接続）とトランスポート抽象・
JSON 境界 codec を、`apps/collaboration-server` から新パッケージへ**移設**した。

これは**挙動保存（behavior-preserving）リファクタ**であり、最重要の受け入れ基準は
**「DD-003 由来の全テストが移設後も green・件数一致（移設前 36 files / 362 tests → 移設後 36 / 362）」**
（DD-005 受け入れ基準7）。**機能変更・テスト間引きは禁止**。

したがって最優先の findings 観点は次の通り:

1. **挙動改変の混入**: 移設に伴い、意図せず振る舞いが変わった箇所はないか。
   - 移設した実装 9 ファイルは **byte-identical（verbatim move）** の想定。差分に「移動＋名前変更」以外の
     実質変更が紛れていないか（特に `session.ts` の rollback/replay・Conflict Queue・再送ロジック）。
   - 消費側（collaboration-server）の変更は **import 経路の差し替えのみ**の想定。ロジック差分が無いか。
2. **パッケージ境界の正しさ（ADR-022: packages/* ランタイム依存ゼロ）**:
   - `sheet-collaboration` の `dependencies` は空、`devDependencies` は内部 `@nanairo-sheet/*` のみ。
     **外部ランタイム依存（ws/hono/node 等）ゼロ**を満たすか。
   - **本体バレル `src/index.ts` が `sheet-server-core`（Room）を巻き込まない**こと（ブラウザーバンドル安全性）。
     試験ハーネス `inprocess-transport.ts`（Room 依存）は**サブパス export のみ**で本体と分離している。
   - **循環依存**の混入が無いか（session→deps、index→session/deps/message-codec、test-support/inprocess→session の一方向）。
3. **公開 API と import 経路の妥当性**（下記「公開API」参照）。特に **message-codec の移設判断**が妥当か
   （純粋・Node/DOM 非参照・sheet-core 型のみ依存＝トランスポート非依存ゆえ移設）。server も client も
   共有する JSON 境界 codec を collaboration へ置くことの是非。
4. **移設漏れ・import 差し替え漏れ**: 旧 `client-session/*` / `message-codec` を参照したまま壊れていないか、
   サブパス export（`/test-support`・`/inprocess-transport`）の resolution が正しいか。
5. **テスト不足・弱体化**: 件数一致でも実質カバレッジが落ちた箇所はないか。

権限・認可・入力バリデーションは本 PoC のスコープ外（§8.7・両端自製境界＝DD-003 で確定済み）。
本 Phase では**新たな検証ロジックは足していない**（挙動保存のため）。その前提でのレビューでよい。

## スコープ（対象差分）

- **新規**: `packages/sheet-collaboration/`（`package.json`・`tsconfig.json`・`src/index.ts`＋移設 9 ファイル）
- **移設（apps/collaboration-server/src → packages/sheet-collaboration/src、verbatim）**:
  `client-session/{session,deps,test-support,inprocess-transport}.ts` ＋
  `client-session/{session,catchup,reconnect,inprocess-transport}.test.ts` ＋ `message-codec.ts`
- **collaboration-server 残置＋import差替のみ**: `client-session/ws-transport.ts`（Node ws）・`ws-frame.ts`（Node Buffer・残置）・
  `server.ts`・`server.smoke.test.ts`・`test/{convergence,protocol-contract,restart-restore,ws-convergence}.test.ts`
- **設定**: collaboration-server の `package.json`（sheet-collaboration を devDep 追加・`typecheck:core` 削除）・
  `tsconfig.json`（コメント更新）・`tsconfig.core.json` **削除**（環境非依存検査の責務は新パッケージの
  tsconfig〔types:[]〕へ移管）・ルート `package-lock.json`（新ワークスペース登録）

## 設計意図・制約

- **トランスポート注入**: `ClientSession` は時刻/ID/トランスポートを全注入（Date.now/Math.random/crypto/DOM/Node 非参照）。
  Node ws は collaboration-server 側（`ws-transport.ts`）、ブラウザー native WS は Phase 2 で playground 側に実装予定。
- **サブパス export**: `.`＝本体（server-core 非依存・ブラウザー安全）、`./test-support`＝テストビルダー/RecordingTransport、
  `./inprocess-transport`＝InProcessHub（Room 依存＝試験専用）。本体を server-core から隔離するための分割。
- **旧 tsconfig.core.json**（session/deps/inprocess-transport を types:[] で検査）は、コードが env-free な
  新パッケージ（tsconfig types:[]・include src/**）へ移ったことで役割を構造的に引き継ぎ済み＝削除。
- **ws-transport.ts は `client-session/` に残置**（移設対象外ゆえパス不変・import 差し替え最小化）。

## 公開API（レビュー対象・ユーザー確認用）

- 本体 `@nanairo-sheet/sheet-collaboration`（`src/index.ts`）:
  - session.ts: `ClientSession`・`ClientTransport`・`TransportListener`・`SessionConfig`・`ConflictQueueEntry`・
    `ConflictReason`・`PresenceUpdate`・`applyInverseSeed`
  - deps.ts: `Clock`・`IdGenerator`・`createCounterIdGenerator`
  - message-codec.ts: `isRecord`・`decodeClientMessage`・`decodeServerMessage`
- `@nanairo-sheet/sheet-collaboration/test-support`: `ManualClock`・`createManualClock`・`RecordingTransport`・
  `col`/`row`/`str`/`num`・`COLUMNS`・`setCells`/`insertRows`/`deleteRows`・`serverEnvelope`・`operationsMessage`
- `@nanairo-sheet/sheet-collaboration/inprocess-transport`: `InProcessHub`・`InProcessTransport`・
  `FaultProbabilities`・`FaultCounters`

## 検証済み（参考）

`npm run typecheck`（新パッケージ含む全 workspace・new pkg は types:[] で env-free 検査）／`npm run lint`／
`npm run test`（**36 files / 362 tests・移設前と同数**）／`npm run build`（playground）／`bash scripts/doc-check.sh`＝全 green。
`sheet-collaboration` の `dependencies` は空（外部ランタイム依存ゼロ）。
