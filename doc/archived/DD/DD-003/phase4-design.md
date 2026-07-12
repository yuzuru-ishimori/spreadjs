# DD-003 Phase 4 詳細設計: 開発用WSサーバーアダプター（Hono + @hono/node-server + ws）＋2タブデモ

> Phase 4（`apps/collaboration-server/src/server.ts`・`client-session/ws-transport.ts`・`public/demo.html`）の
> 📐 実装前詳細化（軽）。HTTP/WS エンドポイント・接続ライフサイクル・heartbeat/TTL sweep 駆動・起動/停止 API・
> 後始末を確定する。`protocol-subset.md`（§1 メッセージ・§5 処理順・§6 Presence/TTL・§7 接続手順）・
> `phase2-design.md`（Room の Outbound IF）・`phase3-design.md`（ClientSession のトランスポート IF）と
> 型・用語・境界仕様を一致させる。**アダプター層のみ実クロック・実タイマー・Node API・ws/hono を使う**
> （Room/Sequencer/Presence の注入クロック設計は不変・主セッションレビュー指示 1）。

## 0. 責務境界（注入クロック設計の維持）

- **Room/Sequencer/Presence（server-core）は不変**: 時刻＝注入 `Clock`・TTL 失効＝明示 `sweep()`・connectionId＝注入
  `IdGenerator`。Phase 4 はこれらに**実クロック `{ now: () => Date.now() }` と実タイマー（`setInterval`）を注入・駆動**する
  唯一の層。`server.ts` が `{ now: Date.now }` を渡し、`setInterval(sweepMillis)` で `room.sweep()` を定期駆動する。
- **`ClientSession`（client-session コア）は不変・依存ゼロを維持**: 非相対 import は sheet-core/sheet-types のみ。
  ws/hono/Node を import するのは `ws-transport.ts`（トランスポート実装）**だけ**。session.ts は `ws-transport` に依存しない
  （逆に ws-transport が `ClientTransport`/`TransportListener` を実装して注入される）。
- 機械的検証: `tsconfig.core.json`（`types:[]`・`lib:["ES2022"]`）で session/deps/inprocess-transport を**Node/DOM 型なしで
  コンパイル**し、コア層の環境非依存を回帰的に担保する（ws-transport.ts は node 依存ゆえコア検査から除外）。

## 1. HTTP / WS エンドポイント構成

| メソッド/パス | 応答 | 用途 |
|---|---|---|
| `GET /` | `text/html`（demo.html） | 2タブデモ配信（静的・起動時に1回 `readFileSync`） |
| `GET /snapshot?documentId=…` | `application/json`（`SnapshotData`＝`serializeSnapshot(room.exportState())`。`currentRevision` 含む＝revision付きJSON） | §8.2 初期接続の snapshot（デモの初期グリッド描画） |
| `GET /config` | `application/json`（`{ documentId, heartbeatMillis }`） | デモの bootstrap（heartbeat 間隔を起動オプションからデモへ伝える・指示 1） |
| `GET /health` | `text/plain`（`ok`） | 起動確認（readiness） |
| `GET /ws`（Upgrade） | WebSocket | join → welcome → operations/ack/presence/… の双方向 |

- WS は `WebSocketServer({ noServer: true })`＋http `server.on('upgrade')` で `pathname === '/ws'` のみ `handleUpgrade`
  （それ以外は `socket.destroy()`）。`@hono/node-server` の `serve()` が返す http server に upgrade を接続する。
- `GET /snapshot` は既存 `serializeSnapshot`（server-core）を再利用（**server-core 無変更**）。デモは document.rowOrder/
  rowMeta（tombstone）/columnOrder/cells から初期グリッドを描く。

## 2. 接続ライフサイクル（`RoomBridge`）

状態: `wsByConn: Map<connectionId, WebSocket>`・`connByWs: Map<WebSocket, connectionId>`（双方向）。

1. **accept（`wss` connection）**: ws を受理。**まだ join していない**＝connectionId 未確定。`message`/`close`/`error` を購読。
2. **join 待ち**: 最初の `join` で `room.handleJoin(join)` → `{ connectionId, outbound }`。双方向マップに登録し、outbound
   （`welcome` → `operations`（差分あれば）→ `presenceSnapshot`）を送信元へ**その順で**dispatch（§8.2）。
   - **join 前の非 join メッセージは無視（drop）**（接続は維持）。**不正 JSON は接続を close**（1008 policy violation）。
   - **二重 join は無視**（既に connectionId 確定済みの接続からの join）。
3. **確立後**: `submitOperation`/`presence`/`heartbeat`/`requestCatchup` を `room.handleMessage(connectionId, msg)` へ配線し
   `Outbound[]` を dispatch。メッセージ処理は `try/catch` で保護し、throw 時は該当接続を close（他接続に波及させない）。
4. **close / error（正常/異常切断）**: `connByWs` から connectionId を引けたら `room.handleDisconnect(connectionId)`
   → `presenceRemoved`（others）を dispatch → 双方向マップ削除。**close と error の両方が発火しても二重削除しない**
   （connByWs にエントリが無ければ no-op＝冪等・§9.3 正常 close 即時削除／異常切断も即時・DA D28）。

### dispatch（Outbound → ws fan-out）

`Outbound.target` を解決して `ws.send(JSON.stringify(message))`（OPEN のみ）:
- `connection` → 当該 connectionId の ws 1 件。
- `others` → `room.activeConnectionIds()` − `exceptConnectionId`。
- `all` → `room.activeConnectionIds()` 全件（送信元含む＝operations エコー）。

## 3. heartbeat 受信 と TTL sweep 駆動（実タイマーはこの層のみ）

- **heartbeat 受信**: `room.handleMessage(conn, heartbeat)` → `presence.touch`（lastSeen=実 now 更新）＋`heartbeatAck` 返却。
- **TTL sweep**: `setInterval(sweepMillis)` → `room.sweep()`（注入実クロックで `(now-lastSeen) > ttlMillis` を失効）→
  `presenceRemoved`（others）を dispatch。さらに**失効した connection の ws を server 側から close**する
  （`room.activeConnectionIds()` に居なくなった connectionId の ws を close・マップ削除）。close イベントは
  connByWs 削除済みのため handleDisconnect を再実行しない（冪等）。
- 既定: `heartbeatMillis=5000`・`ttlMillis=15000`・`sweepMillis=5000`（§9.3）。**すべて起動オプションで上書き可能**
  （smoke は `ttlMillis=200`/`sweepMillis=50` で実時間待ちを 1 秒未満に抑える・指示 2）。

## 4. 起動 / 停止 API（テストから起動停止可能・ポート指定）

```ts
interface StartServerOptions {
  port?: number;          // 既定 8787（playground 5173 と非衝突）。0 = OS 任せランダムポート（テスト・指示 3）
  host?: string;          // 既定 '127.0.0.1'
  documentId?: string;    // 既定 'demo-doc'
  columnOrder?: string[]; // 既定 ['col-a','col-b','col-c']
  seedRows?: number;      // 既定 5（初期グリッド row-1..row-N を単一 InsertRows で投入）
  heartbeatMillis?: number; // 既定 5000（/config でデモへ伝える）
  ttlMillis?: number;     // 既定 15000（Room presence TTL）
  sweepMillis?: number;   // 既定 5000（sweep 実タイマー間隔）
}
interface RunningServer {
  port: number; url: string; documentId: string;
  hash(): string;              // documentHash(現在の権威文書)＝smoke の収束 assert 用
  snapshot(): SnapshotData;    // 検査用
  connectionCount(): number;   // リーク検査用（後始末後 0）
  close(): Promise<void>;      // 全 ws terminate → wss.close → http server.close → clearInterval
}
export function startServer(options?: StartServerOptions): Promise<RunningServer>;
```

- `startServer` は listening 後に resolve（`serve` の listening callback で実ポート取得＝port 0 のランダムポート対応）。
- **seed**: `sequencer.submit`（system envelope）で `InsertRows{afterRowId:null, rows:[row-1..row-N]}` を1件適用し初期グリッドを作る
  （join した各接続は operations 差分でこの行群を受け取る）。connectionId は実 UUID 生成器（`crypto.randomUUID`）を注入。
- **`dev` script**: `tsx src/server.ts`。server.ts 末尾の main ガード（`import.meta.url === pathToFileURL(process.argv[1]).href`）で
  直接起動時のみ `startServer({ port: 8787 })` を呼ぶ（**import 時は起動しない**＝smoke が startServer を import できる）。
  起動 URL は `process.stdout.write`（console.log 非使用・P21）で出力。SIGINT で graceful close。

## 5. 後始末（リーク無し＝テストプロセス自然終了）

`close()`: (1) `clearInterval(sweepTimer)`、(2) `wss.clients` を全 `terminate()`、(3) `wss.close()`（await）、
(4) http `server.close()`（await）。ハンドル（interval・socket・listener）を全解放し、vitest プロセスが自然終了する。
smoke は各 `WsClientTransport.close()`（ws close＋reconnect タイマー解除）＋`server.close()` を teardown で必ず呼ぶ。

## 6. `ws-transport.ts`（実 WS トランスポート・phase3-design §4 の `ClientTransport` 実装）

```ts
class WsClientTransport implements ClientTransport {
  constructor(url: string, options?: { reconnectDelayMillis?: number; autoReconnect?: boolean });
  setListener(l: TransportListener): void;
  connect(): void;                 // new WebSocket(url) → open で handleConnected()（join 送信）
  send(m: ClientMessage): void;    // OPEN なら送信・CONNECTING はバッファ→open で flush・CLOSED は drop（session が再送）
  close(): void;                   // 明示 close（reconnect 抑止・タイマー解除・テスト後始末）
}
```

- `open` → `listener.handleConnected()`（session が join 送信）。`message` → `decodeServerMessage` → `handleServerMessage`。
- `close`/`error` → `listener.handleDisconnected()`。**明示 close で無ければ** `reconnectDelayMillis` 後に `connect()` 再実行
  （再 open で `handleConnected` → 同一 clientId で再 join＝§8.5・phase3-design §7。実タイマー `setTimeout`）。
- 依存: `ws`（Node client）・`setTimeout`。**client-session でここだけが node/ws を import**（session.ts の依存ゼロは不変）。
- heartbeat は transport の責務にしない（session/デモ/smoke が `sendHeartbeat` を実タイマーで駆動）＝トランスポートは
  送受信・接続イベント・再接続のみ。

## 7. `message-codec.ts`（純粋・JSON 境界の型安全デコード）

`unknown`（`JSON.parse` 結果）→ `ClientMessage`/`ServerMessage` をユーザー定義型ガード（`v is T`・P02 準拠）で
narrow する。判別子 `type` を既知集合で検査し、Room/session が読むトップレベル必須フィールドの型を検査
（envelope/payload の内部は PoC dev サーバー境界＝両端が自製ゆえ信頼）。不正は `undefined`（server=close・client=drop+log）。
純粋（Node/DOM 非参照）＝server.ts と ws-transport.ts が共有。`ws-frame.ts` は `RawData→string`（Buffer・node）を担う。

## 8. `demo.html`（2タブ最小デバッグデモ・完全依存ゼロ）

- **依存ゼロ**: CDN・外部フォント・fetch ライブラリ・ES import 一切なし。素の `WebSocket`/`fetch`/`crypto.randomUUID`/DOM/
  最小インライン CSS のみ。デバッグ表示は `console.log` を使わず**ステータス欄/ログ欄（DOM）**へ（P21）。
- **userId/displayName は URL パラメーター（`?user=&name=`）or `prompt()`** で指定（2タブで別名）。clientId は
  `crypto.randomUUID()`（タブごと独立接続）。
- **client ロジックは最小の echo 反映**（client-session.ts はバンドルしない＝PoC は SetCell 同期と Presence 目視が目的）:
  **楽観適用は入れず「送信 → echo（operations）反映」の素直な実装**。冒頭コメントにその旨を明記。
  - bootstrap: `/config` → `/snapshot` で初期グリッド構築 → WS 接続 → `join{lastAppliedRevision:R}`。
  - operations 受信: `revision===model.revision+1` を順に適用（gap は `requestCatchup`）。revision/接続状態を表示。
  - セルクリック → `activeCell` presence 送信（単調 sequence）。共有エディタ input で値入力 → `SetCells` submit
    （operationId=UUID・baseRevision=model.revision・no 楽観適用）。編集中は `editingCell` presence。
  - 他接続の presence（snapshot/delta/removed）→ activeCell/editingCell/selectionRanges を **colorKey 色の枠＋displayName**
    で該当セルに重畳表示。colorKey→CSS 色はローカル固定パレット（`color-0..`）で対応。

## 9. 🔬 smoke テスト設計（`server.smoke.test.ts`・vitest・ランダムポート）

- `startServer({ port:0, ttlMillis:200, sweepMillis:50, heartbeatMillis:40, seedRows:3 })` → 実ポート取得。
- **ws-transport 経由で ClientSession 3 体**を接続（実 WS・実クロック注入）。全員 online＋welcome（colorKey/connectionId）待ち。
- 各自が別セル（seed 行 row-1/2/3）へ SetCells → **全 committedHash == server.hash() へ収束**・二重適用0・pendingCount 0。
- presence: 各自 sendPresence → 他接続の `knownPresences` に **displayName/colorKey** 付きで到達（presenceDelta 経路）。
- **heartbeat/TTL**: 2 体は実 `setInterval` で heartbeat 継続、1 体は silent → 短縮 TTL sweep で silent 接続が
  `presenceRemoved`（他接続の knownPresences から消える）。実時間待ちは 1 秒未満（指示 2）。
- 後始末: 全 transport.close()＋server.close()＋interval clear → **リーク無し（プロセス自然終了）**。

## 10. DA 引き継ぎ（Phase 4 で検証／記録する観点・D28〜）

- 切断イベントの取りこぼし: close/error 両発火・二重削除の冪等（connByWs 有無で1回だけ handleDisconnect）。
- catch-up 中送信順: join（welcome→operations→snapshot）と後続 submit の順序（ws の per-connection 順序保存）。
- テスト間のポート/プロセス後始末: ランダムポート（0）＋close で interval/socket/listener を全解放。
- デモ HTML の依存混入: `grep` で `http(s)://`・`import`・CDN 参照が無いことを機械確認。
- ws message 順序とバックプレッシャー: PoC 範囲（localhost・小メッセージ）での確認に留める（送信バッファ・drainイベントは非対象）。
