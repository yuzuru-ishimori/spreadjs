# DD-003 実装ログ（Phase 0〜5 詳細）

> DD-003 本体からの分離（guides.md §6）。本体ログには各 Phase の 2〜3 行要約＋本ファイルへのリンクを残す。
> ユーザー合意・裁定・エビデンス表・受け入れ基準の判定結果は本体に残す（内容は改変せず移動）。

### 2026-07-11
- DD作成（`doc/plan/phase0-dd-roadmap.md` ④「PoC-C 共同編集・Operation」に対応。同ロードマップの実DD列に DD-003 を記入）
- 実装開始条件: DD-002（PoC-A）のコードコミット後（ロードマップ「順序と依存」。現在DD-002が進行中）
- Codex CLI 利用可否チェック: 利用可（codex-cli 0.144.0-alpha.4）→ Codexレビュータスクを Phase 5 末尾に配置。起票時暫定判定: 必須（TDD対象＋並行処理・複雑な状態遷移＋外部I/F）・effort high
- Playwright MCP: 2ブラウザー最小デバッグデモを含める決定（下記追加指摘）のため、Phase 4 実装時に利用可否を確認しエビデンス取得（不可なら手動キャプチャ）
- 要確認: ブラウザー目視デモ（2ブラウザーSetCell同期＝§26相当）を含めるか、ヘッドレス検証のみか（決定事項 §要確認1）
- 要確認: Presence のPoC範囲はアクティブセルのみか、選択・編集中セルまで含むか（同 §要確認2）
- 要確認: apps/collaboration-server への hono / @hono/node-server / ws 追加の可否（同 §要確認3）

### 2026-07-11（仕様確認ゲート通過 → 追加指摘で更新）
- ユーザー合意により仕様確定（dd-auto Step 2）。実装（Opus）は DD-002 のコードコミット後に開始する
- **要確認3点の最終回答（2026-07-11 追加指摘を反映）**:
  - ① **2ブラウザーの最小デバッグデモを含める**（collaboration-server 配信の依存なし最小HTML。当初「ヘッドレスのみ」から変更）
  - ② **Presenceは3種フル＋識別フィールド**（activeCell/selectionRanges/editingCell ＋ connectionId/userId/displayName/colorKey・connection単位管理・heartbeat TTL削除）
  - ③ collaboration-server への hono/@hono/node-server/ws 追加を承認
- **Operation境界仕様を明記**（追加指摘）: SetCells は全件適用/全件拒否の原子的Operation・tombstone化された既知アンカーへのInsertRows挙動・削除済み行への再Deleteは冪等無視・`clientSequence` は `clientSessionId` 単位
- **スコープ改名**: 新規パッケージは `@nanairo-sheet/*`（`@nanairo-sheet/sheet-core`・`@nanairo-sheet/sheet-server-core`。decisions.md D-003）

### 2026-07-11（Phase 0 事前精査 / Opus）

- **実装開始条件の確認**: DD-002（PoC-A）のコードは `d4752bb`（DD-002: Phase 2 最小常駐textarea＋生イベントrecorder）でコミット済み＝本 DD の実装着手条件を満たす。本 Phase 0 はドキュメント成果物のみ（scenarios/protocol-subset/phase1-design）で停止し、コード（packages/apps・npm install）は書かない（並行セッションが DD-002 進行中のため作業ツリーの他領域は読み取り専用）。
- **Codex 利用可否**: `bash scripts/codex-review.sh --check` → 利用可（exit 0・codex-cli 0.144.0-alpha.4・トークン消費なし）。Codexレビュー判定を**必須・effort high**で確定（Phase 5 で全差分に1回）。
- **作成物**: `DD-003/scenarios.md`（自然言語シナリオ 70件・13カテゴリ A〜M）／`DD-003/protocol-subset.md`（採用メッセージ・Envelope・reject 7種・サーバー処理順・Operation境界4点・Presence/TTL・接続/catch-up/再接続）／`DD-003/phase1-design.md`（sheet-core モジュール境界・公開シグネチャ・ApplyResult/ChangeSet/InverseSeed・hash 正準化ルール）。3ファイルは型・用語・境界仕様を相互整合。
- **タスク精査（📋）で本文へ反映**: Phase 0 の各タスクを完了（詳細化トリガー判定＝Phase 1〜4 要/Phase 5 不要、Codex 判定、DA サマリ）。Phase 1 詳細設計を本文＋`phase1-design.md` に確定し Phase 1 の📐を完了扱い。
- **DA 調査（😈）**: 3ラウンド（R1 広域→R2 クライアント/再接続→R3 保守/統合）。**Critical 2**（D1 hash 正準化の Map反復順/localeCompare 依存＝AC1/AC5 破綻、D2 tombstone 非保持でアンカー解決不一致＝収束破綻）・**Warning 6**（D3 サーバー処理順、D4 シード ID 再現性、D5 SetCells 二相適用、D6 TTL 注入クロック、D7 収束 assert 強化、D8 clientId/connectionId 分離）・**Info 1**（D9 catch-up off-by-one）。R2・R3 で新規 Critical 0＝収束。全件を設計成果物へ反映済み（コード未着手のため設計時解決）。
- **未解決/要判断**: scenarios の Q-1〜Q-5（no-op revision 消費・clientSequence 欠番・Conflict Queue 再送 UX・切断上限暫定値・実WS スモーク規模）は仮決め済みだがユーザー確認対象。仕様（受け入れ基準・ADR 方針・外部依存）の変更はなし＝合意範囲内。次セッションは scenarios/protocol-subset のユーザーレビュー・合意後に Phase 1 コード化から。

### 2026-07-11（Phase 0 レビューゲート代行承認 / 主セッション・Fable）

- **ユーザー指示（2026-07-11 夜）**: 就寝中はレビュー待ちをスキップし、進められるところまで夜間自動進行する（確認ゲートのスキップはユーザーの明示指示による。**コミットは行わず**、朝にまとめてレビュー）。以降の各Phaseゲートは主セッションのレビュー＋DA＋Codexレビューで代行し、本ログを朝の確認対象とする
- **代行レビュー結果**: scenarios.md（70件）／protocol-subset.md／phase1-design.md を計画書 §7/§8/§9/§10/§18.3 と突合 → **承認**。計画書引用のスポットチェック（§8.5 切断上限「30秒または100Operation」・§9.3 heartbeat 5秒/TTL 15秒・resyncRequired の存在と予約扱い・sheet-types の必要ブランド型完備）は原典一致を確認
- **Q-1〜Q-5 の裁定（朝の確認対象）**:
  - **Q-1=(b)採用・ただし no-op は「changeSet 空」（全件tombstone済みDeleteRows）のみ**。同値SetCellsは no-op 扱いしない（revision消費・lastChangedRevision更新＝S-A9どおり。値比較によるno-op化はstale判定と空changeSet検出機構を複雑化するため見送り）。no-op でも冪等キャッシュ・clientSequence表は前進させ、ACKには処理時点のcurrentRevisionを載せる（ログ非追記・エコー無し。ownのpending除去はACK経路でも行う＝S-H4の冪等除去で両経路対応）
  - **Q-2=(a)reject 採用**。補足裁定: submitOperation欠落（フォールト注入）からの回復は「un-ACKのpendingを先頭から同一operationId・同一clientSequenceで再送（注入クロックのresendタイマー or 再接続時）」とし、operationId冪等で二重適用を防ぐ。`client-sequence-violation` 受信時も同様に先頭から再送（Phase 3 詳細化に含めて実装）
  - **Q-3=承認**（Conflict Queueは保持のみ・自動再送なし）／**Q-4=承認**（30秒/100Operation＝§8.5暫定値）／**Q-5=承認**（実WSスモークは3クライアント×1,000件）
- **並行セッション確認**: DD-002 Phase 3 が `apps/playground` を編集中（未コミットの `src/ime/editor-state-machine.ts` を確認）。本DDの編集対象を `packages/sheet-core`・`packages/sheet-server-core`・`apps/collaboration-server`・`doc/DD/DD-003*`・`doc/adr/` に限定維持。**🔬機械検証はツリー全体ではなく本DDスコープに限定して実行**（ルート `test`/`typecheck`/`lint` は編集途中の playground を巻き込むため。ツリー全体greenは朝のコミット前に確認）。`package-lock.json` はワークスペース追加時のみ更新し、差分が本DD由来のみであることを毎回検証する
- Phase 1（sheet-core・TDD）を実装サブエージェント（Opus）へ委譲

### 2026-07-11（Phase 1 実装 / Opus・TDD）

- **作成物（10ファイル）**: `packages/sheet-core/` に `package.json`・`tsconfig.json`／`src/{operations,document,apply,hash,index}.ts`／`src/{document,apply,hash}.test.ts`。ワークスペースは playground と同方式で `@nanairo-sheet/sheet-types` を `devDependencies:"*"` 参照（sheet-core 実装は sheet-types を **型のみ** 参照＝`verbatimModuleSyntax` で実行時消去。ゆえに dev/compile 依存として playground の前例に一致させた）。
- **TDD**: Red=3 テストファイルが import 失敗（モジュール未実装）で全滅を確認 → Green=実装後 **54 件 pass**（document 7・hash 22・apply 25）。scenarios ID をテスト名に付与（S-A1〜A9／S-B1〜B5／S-C1・C3・C5／S-D1〜D4／S-E1〜E3＋InverseSeed＋決定論プロパティ）。
- **🔬 機械検証（本DDスコープ限定・理由=並行 playground の未コミット編集をツリー全体コマンドが巻き込み偽赤になるため）**:
  - `npx vitest run packages/sheet-core` → 54 pass
  - `npm run typecheck --workspace packages/sheet-core`（tsc --noEmit）→ エラー0
  - `npx eslint packages/sheet-core` → エラー0
  - 決定論プロパティ: mulberry32 シード PRNG で生成した同一 Operation 列（ID もシード由来＝DA D4）を2独立文書へ適用→hash 一致を **6シード**（1/2/42/1337/20260711/999999・各250 op）で確認。加えて Map 挿入順を反転再構築しても hash 不変（300 op）を確認。ツリー全体 green は朝のコミット前に主セッションで確認。
- **package-lock.json 差分確認**: `npm install` を package.json 作成後に1回のみ実行。`git diff --stat` = 11 挿入、内容は `node_modules/@nanairo-sheet/sheet-core` symlink と `packages/sheet-core` ワークスペース項目のみ（sheet-core 由来に限定・他パッケージ変更なし）。
- **設計整合の裁定（phase1-design 内の不整合を確定側へ寄せた・要判断ではない）**:
  1. **apply は beforeRevision を参照しない**。phase1-design §4 本文は「beforeRevision 照合」を二相検証に含むが、`ApplyError.code` は構造3種（unknown-row/target-row-deleted/unknown-anchor）に限定（同§4・task 明示・S-A6〜A8）で stale 用コードが無い。stale-cell-revision は Room 現在 revision との照合が要るため **Phase 2 sequencer の責務**とし、apply は構造検証のみ実施（Phase 1 の対象 scenario に stale の apply 検証は無く整合）。
  2. **依存方向 document→operations**: `CellScalar` は §3 のとおり operations.ts が定義し、`CellRecord.value` がそれを参照する（§2）。この型配置が document→operations の import を必然化する（DAG 図の矢印は document←operations だが、循環なしは保たれ、公開シグネチャ・ファイル構成は設計一致）。いずれも公開契約・受け入れ基準は不変＝合意範囲内。
- **要判断**: なし（Phase 1 の設計乖離なし。下記 DA D12 の hash 盲点は Phase 5 assert 強化の推奨で、Phase 1 は設計どおり content-based を維持）。

### 2026-07-11（Phase 2 実装 / Opus・TDD）

- **📐 実装前詳細化**: `DD-003/phase2-design.md`（新規）に Sequencer/Room/Presence/Snapshot の責務分割・メッセージ in/out（`Outbound[]`）・公開シグネチャ・§5 処理順・注入依存を確定（phase1-design と同形式）。主セッション指示 1〜6 を反映。夜間自動進行のためユーザー停止せず（主セッションが後検証）。
- **主セッション指示 1〜6 の反映結果**:
  1. **共有バリデーター**: `packages/sheet-core/src/validate.ts`（新規・14テスト）に `validateOperation(doc,op): OperationViolation[]`（構造3種＋stale＋duplicate-row）を実装・export。sequencer が reject 判定に使用（stale→`stale-cell-revision`・違反セルごとに現在値/現在revision）。Phase 3 クライアント再検証も同一関数を使う契約。`applyOperation` 本体は不変（契約: validate=[] ⇒ apply は throw しない）。
  2. **プロトコル型を sheet-core に配置**: `packages/sheet-core/src/protocol.ts`（新規・型のみ・ランタイムコードなし）に Client/Server メッセージ union・`RejectCode`・`RejectDetails`・`UserPresence`/`PresencePayload`/`CellAddressById`/`SelectionById` を定義。**配置判断**: Operation Envelope は Phase 1 の operations.ts に既存のため二重定義せず type import でラップ（message union のみ追加）。server-core と Phase 3 クライアント双方が import（クライアントは server-core 非依存を維持）。
  3. **duplicate-row 新設**: 既存行 or Operation 内で重複する rowId を `duplicate-row` で reject（Room 境界でサーバー担保＝D11 の呼び出し側契約）。protocol-subset §3/§4・scenarios S-D6 に追記。`validateOperation` で判定＝サーバー/クライアント一致。
  4. **Q-1 no-op**: 全件tombstone済みDeleteRows は空 changeSet を検出し **revision非消費・ログ非追記・operations配信なし**。ACK は `{operationId, revision: 処理時点currentRevision}`。ackCache 登録・clientSequence 表前進（S-E3・resend は duplicate）。同値SetCells は cells に before/after が載るため no-op 扱いしない（S-A9・Q-1 と整合）。
  5. **スナップショット**: `{document, operationLog, currentRevision, ackCache, clientSequenceTable}` を全部 export（no-op ACK はログ再構築不可＝ackCache 明示必須・DA D17）。`verifySnapshotIntegrity` で「document hash == ログreplay hash」を検証（S-K1/K2・DA D7）。Presence は非永続ゆえ含めない。
  6. **colorKey 決定論割当**: 未使用の最小非負 index→`color-${i}`。close/sweep で解放し再利用（`presence.test` で実証）。
- **TDD（Red→Green）**: sheet-server-core 4 テストファイルはモジュール未実装で Red（import 失敗）→ 実装後 **51 件 pass**（sequencer 16・room 14・presence 12・snapshot 9）。sheet-core `validate.test.ts` は validate.ts 実装前 Red→**14 件 pass**。scenarios ID をテスト名に付与（S-F1〜F6・S-C1〜C4・S-D5/D6・S-E3/E4・S-G1/G4・S-I5・S-K1〜K4・S-L1〜L7）。**ミューテーション検証**: §5 処理順の冪等 return を無効化→ F2/E3/回帰の 3 テストが失敗（テスト非空振りを実証）→ revert で green。
- **🔬 機械検証（本DDスコープ限定・並行 playground を巻き込まないため）**:
  - `npx vitest run packages/sheet-core packages/sheet-server-core` → **119 pass**（sheet-core 68・sheet-server-core 51）
  - `npm run typecheck --workspace packages/sheet-core --workspace packages/sheet-server-core` → エラー0
  - `npx eslint packages/sheet-core packages/sheet-server-core` → エラー0（exit 0）
- **package-lock.json 差分確認**: `npm install` を1回のみ実行。`git diff` = `@nanairo-sheet/sheet-server-core` ワークスペース追加＋`@nanairo-sheet/*` symlink のみ（外部依存の追加なし・sheet-server-core 由来に限定）。
- **😈 DA 批判レビュー**: 新規発見 **D17〜D21（Warning 5）** を DA 表に追記（no-op ACK の restore 整合・clientSequence 表欠落の再送誤 reject・処理順回帰・Presence sweep 発火/境界・content-reject の seq 前進一貫性）。いずれも設計/テストで対応済み。R2 相当の再チェックで新規 Critical 0。
- **設計判断の裁定（要判断ではない・合意範囲内）**:
  1. **join は presenceDelta を配信しない**: join は §1 どおり userId/displayName を持たないため、colorKey だけ予約し、UserPresence 確定と presenceDelta 配信は**最初の presence メッセージ**で行う（S-L1 の「colorKey 割当・presenceSnapshot 送付」は join 時に満たす）。§1 の固定 join フィールドを尊重した結果。
  2. **reject はキャッシュしない**（ackCache は accepted/no-op のみ）: reject は二重適用を起こさず I-3 の対象外。reject 未達クライアントの再送処理は Phase 3 の Conflict Queue 責務（境界メモ・D21）。
  3. **content-reject でも clientSequence 前進**: seq 検査通過後はどの結果でも前進（well-behaved クライアントの次 op を seq+1 で受理・D21）。
- **要判断**: なし（公開契約・受け入れ基準は不変。指示 1〜6 をそのまま実装）。Codex レビューは DD 計画どおり Phase 5 で全差分に1回（本 Phase では実施しない）。

### 2026-07-11（Phase 3 実装 / Opus・TDD）

- **📐 実装前詳細化**: `DD-003/phase3-design.md`（新規）に committed/pending 二層・§7.7 rollback/replay 6手順のデータフロー・Conflict Queue エントリー形（コピー可能）・トランスポート IF・再送ポリシー・再接続手順（§8.5）・catch-up バッファ・Presence 識別伝搬・フォールト注入カウンターを確定（phase1/2-design と同形式）。主セッションレビュー指示 1〜5 を反映。
- **主セッション指示 1〜5 の反映結果**:
  1. **pending 再検証は `validateOperation`（sheet-core 共有）を使用**: `rebuildView()` が committed に対し pending を順に `validateOperation` で再検証（独自判定ロジックを書かない＝サーバー判定との乖離を構造的に防ぐ）。違反は Conflict Queue へ。
  2. **再送ポリシー（Q-2 実装）**: un-ACK の pending を「resend タイマー満了（注入クロック）」「再接続時（サーバー差分適用後）」「`client-sequence-violation` 受信時」に**先頭から同一 operationId・同一 clientSequence で再送**。**reject を受けた op は pending から除去し Conflict Queue へ**（＝再送集合から外れる・無限再送なし）。サーバーの operationId 冪等＋決定論 reject で二重適用は起きない。
  3. **Presence 識別伝搬経路を確定**: **既存経路を確認**＝クライアントの `presence` payload（`PresencePayload`）が userId/displayName を運び、サーバー（Room.handlePresence→PresenceRegistry）が connectionId/colorKey を付与し `presenceDelta`/`presenceSnapshot` で中継（phase2-design §2/§4・protocol.ts・room.ts で既定義。変更不要）。**自分の colorKey の知り方＝welcome 拡張**に確定: `WelcomeMessage` へ `colorKey` を追加（sheet-core `protocol.ts`）し、`room.ts` handleJoin が `presence.register` の戻り値を welcome に載せる（**最小変更・既存 server-core テスト維持**＝welcome は個別フィールド検査ゆえ非破壊。119→維持）。Phase 4 デモ（他タブの名前・色表示）は presenceDelta/snapshot 経路で成立。
  4. **catch-up 待ち中の新着はバッファ方式**: `revisionBuffer`（Map<revision,envelope>）に積み、`nextExpectedRevision` から連続分を revision 順に適用、なお欠落があれば再 catch-up（破棄→再取得より決定論的・S-I4）。
  5. **フォールト注入カウンター**を `InProcessHub` に内蔵（duplicate/drop/delay/disconnect の発火回数）。Phase 5 S-M3 メタ検証が使う。
- **TDD（Red→Green）**: 4 テストファイルが `./session`/`./deps`/`./inprocess-transport` 未実装で import 失敗（Red）→ 実装後 **33 件 pass**（session 18・catchup 5・reconnect 5・inprocess-transport 5）。scenarios ID をテスト名に付与（S-H1〜H5・S-G2/G3・S-I1〜I5・S-J1〜J5＋再送ポリシー＋Presence＋rollback 検証）。
- **作成物（8ファイル）**: `apps/collaboration-server/` に `package.json`・`tsconfig.json`／`src/client-session/{deps,session,inprocess-transport}.ts`＋`test-support.ts`／`src/client-session/{session,catchup,reconnect,inprocess-transport}.test.ts`。`session.ts` の非相対 import は sheet-core/sheet-types のみ（server-core 非依存＝sheet-collaboration へ昇格しやすく）。`inprocess-transport.ts`（試験ハーネス）のみ Room を import。
- **🔬 機械検証（本DDスコープ限定・並行 playground を巻き込まないため）**:
  - `npx vitest run packages/sheet-core packages/sheet-server-core apps/collaboration-server` → **152 pass**（sheet-core 68・sheet-server-core 51・collaboration-server 33）
  - `npm run typecheck --workspace packages/sheet-core --workspace packages/sheet-server-core --workspace apps/collaboration-server` → エラー0
  - `npx eslint packages/sheet-core packages/sheet-server-core apps/collaboration-server` → exit 0
  - **収束の広域検証（DA用スクラッチ・実行後削除）**: 3クライアント×フォールト30%で 25シード×非競合＋15シード×競合＝40件収束を確認（恒久回帰は inprocess-transport.test の代表 1 件〔非競合・seed 7〕＋競合 1 件〔seed 11〕へ集約）。
- **sheet-core/sheet-server-core への最小変更（指示3）**: `protocol.ts` `WelcomeMessage` に `colorKey: string` 追加・`room.ts` handleJoin が colorKey を welcome に載せる。**両パッケージのテストは維持**（68＋51＝119 green・welcome は個別フィールド検査ゆえ非破壊）。protocol-subset.md §1 は既に userId/displayName を payload で運ぶ経路を定義済みゆえ本文変更なし（welcome.colorKey の追記のみ phase3-design に記録）。
- **package-lock.json 差分確認**: `npm install` を1回のみ実行。差分は `@nanairo-sheet/collaboration-server` ワークスペース追加＋`@nanairo-sheet/*` symlink（既存 lockfile が未記録だった sheet-core/sheet-server-core の link を含む）＝**外部ランタイム依存の追加なし**（Phase 3 は hono/ws 不使用）。
- **😈 DA 批判レビュー**: 新規発見 **D22〜D27** を DA 表へ追記。うち **D26（tail 欠落で収束破綻）を Critical で発見・修正**（25シード中 7 失敗→周期 catch-up poll で 25/25 収束）。**D22（InverseSeed に before-revision 無し→上書き rollback 非厳密）は committed 権威管理で収束担保**。D27（dropped content-reject の再送ループ）は PoC フォールトモデル（reject/welcome を確実配信）で回避＋Phase 5 へ境界メモ。
- **要判断**: なし（受け入れ基準・公開契約・外部依存は不変。welcome.colorKey は指示3の範囲内の最小変更）。Codex レビューは DD 計画どおり Phase 5 で全差分に1回。

### 2026-07-11（Phase 4 実装 / Opus・標準＝WSアダプター＋デモ）

- **📐 実装前詳細化**: `DD-003/phase4-design.md`（新規）に HTTP/WS エンドポイント（GET `/`・`/snapshot`・`/config`・`/health`・WS `/ws`）・接続ライフサイクル（accept→join 待ち→確立→close/error 即時 Presence 削除）・heartbeat 受信と TTL sweep 実タイマー駆動・起動/停止 API・後始末・ws-transport IF・demo 構成・smoke 設計を確定。主セッションレビュー指示 1〜5 を反映（夜間自動進行のためユーザー停止せず主セッションが後検証）。
- **主セッション指示 1〜5 の反映結果**:
  1. **アダプター層の責務**: `server.ts` が **実クロック `{ now: () => Date.now() }` と実 `setInterval`(sweep)** を注入・駆動する唯一の層。Room/Sequencer/Presence の注入クロック設計は不変。heartbeat/TTL/sweep は起動オプションで上書き可能（既定 5s/15s/5s）。client-session コア（session/deps/inprocess-transport）の依存ゼロは維持し、**ws import は ws-transport.ts のみ**。回帰担保として `tsconfig.core.json`（types:[]）でコア 3 ファイルを Node/DOM 型なしでコンパイル（`npm run typecheck:core` = exit 0）。
  2. **smoke の TTL 検証は短縮値**（ttl 200ms/sweep 50ms/heartbeat 40ms）で実施＝実時間待ち <1s（smoke 実測 364ms）。
  3. **ポート**: smoke は port 0（OS 任せランダムポート）→ `serve` の listening callback で実ポート取得。dev 既定は 8787（playground 5173 と非衝突）。
  4. **demo.html 完全依存ゼロ**（CDN/import/fetchライブラリ無し・素 WS/DOM/最小 CSS）。楽観適用なしの「送信→echo 反映」実装（冒頭コメントに明記）。userId/displayName は URL パラメーター or プロンプト・clientId は `crypto.randomUUID()`（タブごと独立接続）。他接続の activeCell/selectionRanges/editingCell を colorKey 色の枠＋displayName で重畳。
  5. **📸 は主セッションで実施**（Playwright MCP は主セッション側）。代わりにデモ起動手順を本ログに明記（下記）。
- **作成物（8 ファイル）**: `apps/collaboration-server/` に `src/server.ts`（HTTP/WS アダプター・startServer/close・main ガードで dev 起動）・`src/message-codec.ts`（純粋・JSON 境界の型安全デコード＝ユーザー定義型ガード）・`src/ws-frame.ts`（RawData→string・node）・`src/client-session/ws-transport.ts`（`ClientTransport` 実装・再接続対応）・`public/demo.html`（2タブデモ）・`src/server.smoke.test.ts`（vitest・ランダムポート）／`tsconfig.core.json`（コア純度検査）／`DD-003/phase4-design.md`。`package.json`・`tsconfig.json` を更新（deps 追加・types:node・dev/typecheck:core script）。**sheet-core/sheet-server-core は無変更**（Room は既に Outbound[] を返す非依存 IF＝そのまま配線）。
- **🔬 機械検証（本DDスコープ限定・並行 playground を巻き込まないため）**:
  - `npx vitest run packages/sheet-core packages/sheet-server-core apps/collaboration-server` → **153 pass**（sheet-core 68・sheet-server-core 51・collaboration-server 34〔client-session 33＋smoke 1〕）。smoke は Phase 4 で新規＝実装前は server.ts/ws-transport.ts 未存在で不成立、実装後 green（Red→Green）。vitest は Duration ~2s で**自然終了**（open handle リーク無し）。
  - `npm run typecheck --workspace …`（sheet-core/sheet-server-core/collaboration-server）→ エラー0。`npm run typecheck:core --workspace apps/collaboration-server`（コア純度・types:[]）→ exit 0。
  - `npx eslint packages/sheet-core packages/sheet-server-core apps/collaboration-server` → exit 0。
  - **demo.html 依存ゼロの機械検証**: `grep` で `http(s)://`=0・`import`/`require`=0・外部 asset 参照（`<script src=`/`<link`/`unpkg`/`jsdelivr`/`googleapis`/`integrity=`）=0（唯一の "CDN" ヒットは「CDN 無し」明記のコメント）・`console.*`=0。**client-session コア純度**: `ws` import は ws-transport.ts のみ、session.ts の非相対 import は sheet-core/sheet-types のみを grep 確認。
- **package-lock.json 差分確認**: `npm install` を1回のみ実行。追加は **hono 4.12.29 / @hono/node-server 1.19.14 / ws 8.21.0 / @types/node 22.20.1 / @types/ws 8.18.1 / tsx 4.23.0 とその推移的依存（undici-types・esbuild ＋プラットフォーム別 @esbuild/* optional）のみ**（`git diff` の node_modules エントリで確認）。`packages/*/package.json` の `dependencies` は全て空のまま＝**packages/* 汚染なし**（ランタイム依存ゼロ原則を維持）。
- **デモ起動手順（📸 は主セッションが実施）**:
  1. `npm run dev --workspace apps/collaboration-server`（`tsx src/server.ts` が起動。既定 `http://127.0.0.1:8787`。`PORT` 環境変数で上書き可）。起動時に URL を stdout へ出力。
  2. ブラウザーで **2タブ**を別名で開く: `http://127.0.0.1:8787/?name=Alice` と `http://127.0.0.1:8787/?name=Bob`（`name` 未指定ならプロンプト）。初期グリッドは 5 行×3 列（row-1..row-5 × col-a/b/c）。
  3. **SetCell 同期**: 片方でセルをクリック→値入力→Set（or Enter）。もう片方のタブに echo 反映される（revision が両タブで進む）。
  4. **Presence**: セルクリックで activeCell（相手タブに colorKey 色の実線枠＋名前バッジ）、エディタ入力欄フォーカス中は editingCell（破線枠＋✎名前）、Shift+クリックで範囲選択（selectionRanges を薄い色で塗り）。タブを閉じると即時 `presenceRemoved`、放置（heartbeat 途絶）で TTL 15s 後に削除。
- **設計判断の裁定（要判断ではない・合意範囲内）**:
  1. **JSON 境界のデコード**は `message-codec.ts` のユーザー定義型ガード（判別子 `type` ＋トップレベル必須フィールドを検査、envelope/payload 内部は PoC 開発用サーバー境界＝両端自製ゆえ信頼）で `unknown`→型付きへ narrow（coding-standards P02 準拠・`as` 不使用）。不正 JSON は server=close(1008)・client=drop+log（`console.error` は P21 許容の構造化ログ）。
  2. **TTL sweep で失効した接続の ws を server 側から close**（`room.activeConnectionIds()` の差分で検出）。続く close イベントは `connectionByWs` 削除済みゆえ no-op（冪等・D28）。
  3. **`tsconfig.json` の types を [] → ["node"]** に緩めた（アダプター層が Node/ws/hono を使うため。既存 tsconfig コメントが Phase 4 で追加と明記済み）。コア純度は `tsconfig.core.json` で別途機械検証＝環境非依存の回帰担保を維持。
- **要判断**: なし（受け入れ基準・公開契約は不変。外部依存追加はユーザー合意済みの3依存＋dev ツール群のみ）。Codex レビューは DD 計画どおり Phase 5 で全差分に1回。

### 2026-07-12（Phase 4 📸エビデンス取得 / 主セッション・Playwright MCP）

- `npm run dev --workspace apps/collaboration-server`（:8787）→ 実ブラウザー2タブ（`?name=Alice`／`?name=Bob`）で目視確認:
  - Bob入力「Bobの入力123」(row-2/col-b) → Aliceタブへ同期・Bobバッジ表示・revision 1→2・others 1
  - Alice入力「Aliceの入力あいう」(row-1/col-a) → Bobタブへ同期・Aliceバッジ1件・revision 3
  - Bobタブ close → Alice側 others 0・Bobバッジ即時消滅（`presenceRemoved` close経路を実ブラウザーで確認）
  - コンソールエラーは favicon 404 のみ（DD-002 と同じ想定内・実バグなし）
- 赤枠強調キャプチャ2点を `DD-003/` へ配置し「## エビデンス」表へ記載 → 📸タスク完了。確認後サーバー停止
- Phase 5（収束・契約・復元試験＋ADRドラフト＋Codexレビュー）をOpusサブエージェントへ委譲

### 2026-07-12（Phase 5 実装 / Opus・試験＋ADR＋Codexレビュー）

- **📐 詳細化=不要**（試験ハーネス中心・新規設計判断なし）。DA表は D33 から連番。
- **作成物（新規）**: `apps/collaboration-server/test/{convergence,protocol-contract,ws-convergence.smoke,restart-restore}.test.ts`＋`test/doc-compare.ts`（hash 非依存の構造正規化）／`doc/adr/0005-server-ordered-operation-log.md`・`doc/adr/0008-optimistic-apply-rollback-replay.md`（Status: Proposed）／`DD-003/codex-review-request.md`・`codex-review-result.md`。
- **Phase 5 の実装変更（本体コード）**:
  - `src/client-session/inprocess-transport.ts`: `disableFaults()`（静止点作成）・**`injectClientToServer` オプション**（既定 true。収束試験は false＝submitOperation は確実配信し server→client 経路のみに注入）・切断時に旧 Room 接続を解放（`room.handleDisconnect`＝再接続の fan-out 累積を防止）・`deliverAll` に **maxSteps ガード**（メッセージ storm を明示 throw＝偽収束防止）。
  - `src/server.ts`: **`restoreFrom?: SnapshotData`**（snapshot＋log から復元起動・seed スキップ・revision 継続）。
  - `packages/sheet-server-core/src/snapshot.ts`: `verifySnapshotIntegrity` を強化（content hash＋**構造一致**〔rowOrder/tombstone/revision〕＋**revision 整合**〔log 連番・currentRevision===log長・document.revision===currentRevision〕・Codex [P2]）。
  - `src/client-session/session.ts`: **acked-noop の除去**（rebuildView で ACK 済みかつ再適用で空 changeSet になった pending を除去＝競合 DeleteRows 敗者の停止ノーオペ解消・Codex [P1]・D33）。他は Phase 3 のまま。
- **🔬 機械検証（本DDスコープ限定）**: `npx vitest run packages/sheet-core packages/sheet-server-core apps/collaboration-server` → **163 pass**（sheet-core 68・sheet-server-core 51・collaboration-server 44〔client-session 33＋server smoke 1＋test/ 10＝convergence 3・protocol-contract 5・ws-convergence 1・restart-restore 1〕）。`npm run typecheck --workspace …`×3＋`typecheck:core` エラー0。`npx eslint …` exit 0。`bash scripts/doc-check.sh` エラー0。**ルート一括 `npm run test`/`build` は実行しない**（並行セッションの playground 差分を巻き込むため。ツリー全体 green は朝のコミット前に主セッション確認）。
- **収束試験の計測値（No-Go 材料）**: 3体×10,000件 ≈0.9〜1.6s（**ops/sec 6,300〜10,800**）・10体×10,000件 ≈1.6〜2s（ops/sec 5,300〜6,400）・4体×2,500件×2（S-M2 再現）≈0.13s。**最大 pending 深度 4〜8（有界）**＝rollback/replay 恒常遅延の兆候なし。フォールト発火（3体）: 重複 7,378／欠落 8,677／遅延 10,958／切断 215（種類ごと > 0 を assert）。reject 136・conflict 610・insert 36・delete 35（自明でない invariant）。静止点 quiescenceTicks=1。同一シード完全再現（S-M2）を実証。
- **収束 assert の多経路（D7/D12/D35）**: (a) 全クライアント committed hash==サーバー hash、(b) ==スナップショットのログ replay hash（`verifySnapshotIntegrity`）、(c) **hash 非依存の構造 deep-equal**（`doc-compare.ts`＝rowOrder/tombstone/slot/全セルを配列順で列挙・hash とは別関数導出）、(d) 二重適用0（operationId 重複なし・revision 連番・`nextExpectedRevision===serverRev+1`）、(e) フォールト発火カウンター種類ごと>0、(f) 非空セル>0・insert/delete≥1・reject≥1。
- **フォールトモデルの裁定（D34・要記録）**: 収束試験のフォールトを **server→client 経路（operations/operationAck の欠落/重複/遅延）＋切断/再接続に限定**（`injectClientToServer=false`）。理由: `submitOperation` 欠落起点の `client-sequence-violation` の完全な clientSequence 再整列は **D27 の deferred 境界**で、同期 `resendAllPending` が out-of-order 再送下で**指数増幅**する（Phase 5 で実測＝queueLen 95k〜155k）。catch-up/冪等/reorder で回復する経路を検証し、この境界は ADR-0008 の再検討条件へ。切断/再接続は client→server の resend 経路を間接 exercise。
- **😈 DA 批判レビュー**: 新規 **D33〜D37** を DA 表へ追記（`DD-003/da-review-log.md`）。**D33（停止ノーオペで収束停止＝Critical）は Codex [P1] と一致・修正**（rebuildView で acked-noop 除去→並行 Delete でも収束）。**D34（D27 の指数増幅＝Critical）**はフォールトを server→client 限定＋maxSteps ガードで対応。D35（メタ検証）・D36（実行時間/No-Go）・D37（restart 後始末）。
- **Codex レビュー（必須・effort high・全差分1回）**: `bash scripts/codex-review.sh --request DD-003/codex-review-request.md --out DD-003/codex-review-result.md --uncommitted` → **findings 6件**（P1 Critical 2・P1 Warning 1・P2 Warning 3）。対応:
  - **[P1] acked-noop 除去（session.ts）→ 修正**（D33 と同一・rebuildView で除去。収束試験の削除を並行同一行に戻し実証）。
  - **[P2] verifySnapshotIntegrity 強化（snapshot.ts）→ 修正**（構造＋revision 整合を追加）。
  - **[P2] ws-convergence 各クライアント1,000件（計3,000件）→ 修正**（Q-5「3 Client×1,000件」を各1,000件に）。
  - **[P2] restart-restore の D17 過大主張 → 修正**（un-ACK pending 冪等救済は ACK 欠落を要し実 WS〔非欠落〕では自然発生しない旨を明記。D18 clientSequence 継続は実 WS で実証・D17 は snapshot.test 単体で検証済み）。
  - **[P1 Critical・P1 Warning] message-codec の再帰入力検証（rowId/CellScalar）・room.ts の envelope.clientId/documentId/protocolVersion 拘束 → 見送り（要判断）**: 信頼できない**外部**クライアント入力への境界硬化＝**認証/認可（§8.7）はDDスコープ外**＋`message-codec` の「両端自製ゆえ信頼」境界（phase4-design §7 明記）。本 PoC のクライアントは自製 `ClientSession`（整形済み op のみ）。本番アダプターで境界検証を追加する（ADR/後続へ境界メモ）。
- **要判断（呼び出し元へ）**: Codex の [P1 Critical] message-codec 入力検証・[P1 Warning] clientId 拘束の 2 件は PoC スコープ（§8.7 認証/認可・両端自製）で見送り。**本番アダプター化時に境界検証を実装するか**の判断をユーザーへ委ねる（PoC の収束検証には非依存）。
