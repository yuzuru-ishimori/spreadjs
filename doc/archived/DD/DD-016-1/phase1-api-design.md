# DD-016-1 Phase 1: 公開API面 設計（👀 API確定ゲート提案）

> 親=DD-016 / 子=DD-016-1。**Experimental 0.x**（ADR-0015）。本書は Phase 1 の 📐 実装前詳細化＝**公開 API の確定提案**。ユーザーレビュー（👀）合意後に contract test（Red）→実装（Green）へ進む。
> 出典（挙動保存の根拠）: `apps/playground/src/integration/main.ts`（現行 consumer 配線）・`session-sync.ts`・`integration-editor.ts`・`apps/collaboration-server/src/server.ts`・`packages/collab/src/session.ts`（SessionEvent）。

## 0. 設計原則

- **最小経路**（§7）: 最初の consumer＝vanilla TS が「serve→mount→日本語入力→共同編集→destroy/再mount」を行える最小面のみ固定。行操作・数式・clipboard・presence の公開APIは Stage 2。
- **R7 非漏洩**: 公開シグネチャに内部 package 型（`@nanairo-sheet/{core,collab,server,types,selection,render,ime,formula}`）を出さない。`SessionEvent`/`ConflictQueueEntry`/`SnapshotData`/`RecoveryReport` 等は公開型へ**写像**する（再exportしない）。
- **挙動保存**: `mount` は現行 `main.ts` の boot シーケンス（fetchConfig→transport→sessionSync→render→editor→rAF→tick→handlers）を束ねるだけ。描画・IME・同期の挙動は変えない。
- **後方互換な拡張余地**: 省略可能フィールドの追加で成長できる形（rendering metrics・commands・presence は将来 optional 追加）。

## 1. `@nanairo-sheet/grid`（クライアント Facade）

```ts
/** 接続状態（公開）。collab の ConnectionState を写像（型を再exportしない）。 */
export type GridConnectionState = 'online' | 'offline' | 'stopped';

/** reject 理由（公開）。collab の ConflictReason を写像。 */
export type GridConflictReason = 'rejected' | 'revalidation-failed' | 'dependency';

/** 競合の公開サマリ（R7: ConflictQueueEntry の DocumentOperation/OperationViolation/RejectDetails を漏らさない）。 */
export interface GridConflict {
  readonly operationId: string;
  readonly reason: GridConflictReason;
  readonly code?: string;   // server reject code（'cell-conflict' 等）を文字列化
}

/** grid が発火する公開イベント（lifecycle 契約: connection state・error notification）。 */
export type GridEvent =
  | { readonly type: 'connection'; readonly state: GridConnectionState; readonly pendingCount: number }
  | { readonly type: 'pending'; readonly pendingCount: number }
  | { readonly type: 'rejected'; readonly pendingCount: number; readonly conflict: GridConflict }
  | { readonly type: 'divergence'; readonly serverRevision: number; readonly committedRevision: number }
  | { readonly type: 'error'; readonly phase: 'config' | 'connect' | 'runtime'; readonly message: string };

export type GridEventListener = (event: GridEvent) => void;

/** マウント先（Facade が container 内部に canvas/scroller/textarea を構築する）。 */
export interface GridMountTarget {
  readonly container: HTMLElement;
}

/** mount 時オプション（Experimental 0.x）。 */
export interface GridMountOptions {
  readonly serverUrl: string;                    // 同期サーバー HTTP オリジン。ws URL・/config を導出
  readonly documentId?: string;                  // 未指定なら /config の documentId
  readonly columnOrder?: readonly string[];      // 未指定なら /config から取得（server-hono と対）【決定D1】
  readonly displayName?: string;                 // Presence 表示名（未指定なら匿名生成）
  readonly clientId?: string;                    // 再接続で不変（未指定なら生成）
  readonly onEvent?: GridEventListener;          // mount 直後の connection/error を取りこぼさない初期購読
}

/** mount が返すハンドル（consumer lifecycle 契約）。 */
export interface GridInstance {
  readonly documentId: string;
  connectionState(): GridConnectionState;
  subscribe(listener: GridEventListener): () => void;   // 返り値=unsubscribe
  focus(): void;
  destroy(): void;   // DOM/listener/RAF/WS/canvas/textarea を解放（再mountで leak しない）
}

export const GRID_API_VERSION = '0.1.0-experimental' as const;   // ADR-0015

/** Canvas グリッドを container へマウントする（sync 返却・boot は内部で非同期進行）。 */
export function mount(target: GridMountTarget, options: GridMountOptions): GridInstance;
```

**SessionEvent → GridEvent 写像（R7）**:

| 内部 SessionEvent | 公開 GridEvent | 写像の要点 |
|---|---|---|
| `connection{state,pendingCount}` | `connection{state,pendingCount}` | `ConnectionState` を `GridConnectionState`（同値の自前 union）へ |
| `pending{pendingCount}` | `pending{pendingCount}` | 素通し（number のみ） |
| `rejected{entry:ConflictQueueEntry,pendingCount}` | `rejected{conflict:GridConflict,pendingCount}` | **entry→GridConflict へ縮約**（operationId/reason/code のみ・operation 本体/violations/details は非公開） |
| `divergence{serverRevision,committedRevision}` | `divergence{...}` | 素通し（number のみ） |
| （boot/transport 例外・現状は `catch`→status文言） | `error{phase,message}` | fetchConfig 失敗=`config`／WS 接続失敗=`connect`／実行時=`runtime` |

**mount の内部束ね**（挙動保存・現行 main.ts と等価）:
1. container 内に stage(position:relative)・base canvas・overlay canvas・scroller・spacer を構築（現行 demo.html 相当の DOM を Facade が生成）。
2. `clientId`（無ければ生成）・`clock`・`idGenerator`・`BrowserWebSocketTransport(serverUrl→ws)` を用意。
3. columnOrder が無ければ `GET {serverUrl}/config`。失敗→`error{phase:'config'}`。
4. `createSessionSync({...})` の `observer` を **GridEvent へ写像して subscribe 群へ配る**。
5. render 層（base/overlay）・`createIntegrationEditor`（IME textarea）を配線。
6. master rAF ループ・tick interval（再送/heartbeat）・pointer/scroll/resize/ResizeObserver を張る。
7. `session.start()`。
8. `destroy()`＝rAF cancel・clearInterval・全 removeEventListener（AbortController）・ResizeObserver.disconnect・transport 切断・textarea/badge/canvas 撤去・DOM から container 内生成物を除去。

## 2. `@nanairo-sheet/server-hono`（サーバー Facade）

```ts
/** serve 時オプション（Experimental 0.x・StartServerOptions の公開最小サブセット）。 */
export interface ServeOptions {
  readonly port?: number;                    // 既定 8787。0=ランダム（テスト）
  readonly host?: string;                    // 既定 '127.0.0.1'
  readonly documentId?: string;              // 既定 'demo-doc'
  readonly columnOrder?: readonly string[];  // 既定 ['col-a','col-b','col-c']
  readonly seedRows?: number;                // 既定 5
  readonly persistenceDir?: string;          // 指定でファイル永続化（oplog+snapshot）・再起動復旧
}

/** serve が返すハンドル。 */
export interface ServerInstance {
  readonly port: number;
  readonly url: string;
  readonly documentId: string;
  connectionCount(): number;   // 診断用（number のみ）
  stop(): Promise<void>;       // 全 ws terminate→wss.close→http close→clearInterval→oplog/snapshot close
}

export const SERVER_HONO_API_VERSION = '0.1.0-experimental' as const;

/** 同期サーバーを起動する（listening 後に解決＝port 0 対応で async）【決定D2】。 */
export function serve(options?: ServeOptions): Promise<ServerInstance>;
```

**R7 非公開**（`RunningServer` から落とす）: `snapshot():SnapshotData`・`recovery:RecoveryReport`・`hash():string`（内部型・検査専用）。`integrationDataset`/`restoreFrom`/`snapshotIntervalOps`/`heartbeatMillis`/`ttlMillis`/`sweepMillis` は公開 ServeOptions から除外（demo/内部調整・`restoreFrom` は SnapshotData を漏らす）。

## 3. contract test（AC1）の Red 固定

- `tests/contract/facade-surface.test.ts`: value export surface snapshot を新面へ更新（`mount`/`GRID_API_VERSION`/`serve`/`SERVER_HONO_API_VERSION` 等）。
- **R7 型漏洩検査（新規）**: 各 Facade の生成 `.d.ts`（`tsc --emitDeclarationOnly`）を走査し、公開宣言に `@nanairo-sheet/(core|collab|server|types|selection|render|ime|formula)` が現れないことを assert（現れたら fail＝内部型漏洩）。

## 4. 要ユーザー判断（設計フォーク）

- **【D1】columnOrder の取得**: 既定=**未指定なら serverUrl の `/config` から自動取得**（現行挙動・consumer コード最小・grid↔server-hono をペア運用）。明示 `columnOrder` を渡せば /config 非依存。→ 推奨: 自動取得（optional 明示上書き付き）。
- **【D2】`serve` を async 化**: stub は `serve():ServerInstance`（sync）。実サーバーは port 0 バインドが非同期のため `Promise<ServerInstance>` へ変更。→ 必須の変更（stub signature からの逸脱を承認願う）。
- **【D3】rejected イベントの粒度（R7）**: `GridConflict`＝operationId/reason/code の**サマリのみ**（rejected operation の値本体・violations は非公開）。Alpha は「競合の**通知**」を保証し、プログラム的な競合解決 UI 材料の公開は Stage 2。→ 推奨: サマリのみ。
- **【D4】DOM scaffold**: Facade が `container` 内部に canvas/scroller/textarea を構築（consumer は div を1つ渡すだけ）。→ 推奨: Facade 所有。
- **【D5】描画メトリクス**: rowHeight22/colWidth80/header52×24 は内部既定（公開 Options に出さない＝最小面）。将来 optional 追加で後方互換に拡張可。→ 推奨: 内部既定。
