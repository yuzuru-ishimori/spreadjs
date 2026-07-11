遅延・競合時に pending が永久残留する収束バグと、信頼できない WS 入力による権威文書破損経路があります。また Snapshot 復元と Phase 5 の一部受け入れ条件を十分に検証できていません。

Full review comments:

- [P1][Critical] ACK 済みになった no-op pending を除去する — C:\repo\spreadjs\apps\collaboration-server\src\client-session\session.ts:423-428
  2クライアントが同じ行を Delete し、敗者の no-op ACK が勝者の `operations` より先に届く場合、ACK 時点では `localNoop=false` のため pending が `acknowledged` のまま残ります。その後ここで `localNoop=true` に再計算されても除去されず、no-op にはエコーがなく再送も ACK 済みを除外するため、`pendingCount` が永久に 0 にならず収束しません。Phase 5 テストもこのケースを意図的に避けているため、ACK 済みかつ再適用で no-op になった entry を除去する必要があります。

- [P1][Critical] Operation の内部フィールドを境界で検証する — C:\repo\spreadjs\apps\collaboration-server\src\message-codec.ts:69-75
  WS クライアントが `insertRows.rows=[{rowId:null}]` を送っても配列であるだけで通過し、`validateOperation` と `applyOperation` は null の行を権威文書へ挿入します。また不正な SetCells 値は apply 中に例外となり、その前に Sequencer の clientSequence だけが消費されます。信頼できない入力で文書破損や未応答の sequence 消費が起きるため、rowId、各 change、CellScalar、有限整数 revision/sequence まで再帰的に検証してください。

- [P1][Warning] submit を join 済みの clientId と文書へ拘束する — C:\repo\spreadjs\packages\sheet-server-core\src\room.ts:148-150
  接続 A が join 後に `envelope.clientId='B'` を送ると、そのまま Sequencer が B の sequence 表を前進させるため、正規の B の次操作が `client-sequence-violation` になります。同様に異なる documentId/protocolVersion の envelope も現在の Room に適用されます。保存済みの接続 clientId と Room の文書・プロトコルに一致しない submit は、Sequencer に渡す前に拒否または接続終了する必要があります。

- [P2][Warning] Snapshot の構造と revision 整合性も検証する — C:\repo\spreadjs\packages\sheet-server-core\src\snapshot.ts:95-100
  `ok` は content-based hash だけを比較するため、`currentRevision` をログ末尾と異なる値に変更した Snapshot や、空行・tombstone・rowOrder だけが壊れた Snapshot でも true になります。特に大きな currentRevision で復元すると次の Operation が飛び番 revision になり、クライアントは欠落 revision を永久に待ちます。document の構造比較に加え、document/currentRevision/log 末尾の一致とログ連番も検証してください。

- [P2][Warning] 未 ACK pending を残した状態で再起動を試験する — C:\repo\spreadjs\apps\collaboration-server\test\restart-restore.test.ts:94-100
  この待機で全クライアントの pending を 0 にしてから Snapshot を取得しているため、テスト冒頭で掲げた「未 ACK pending の再送を復元済み ackCache が冪等救済する」経路を一度も通っていません。ackCache の復元や再接続時の重複処理が壊れても、この実 WS 復元テストは緑のままなので、ACK またはエコーを未配送にした pending を保持して停止するケースが必要です。

- [P2][Warning] 各 WS クライアントから 1,000 件ずつ送信する — C:\repo\spreadjs\apps\collaboration-server\test\ws-convergence.smoke.test.ts:91-95
  Q-5/S-M5 は「3 Client×1,000件」ですが、ここでは合計 1,000 件を3セッションへラウンドロビンしており、各クライアントは約333件しか送信しません。クライアント単位の高 clientSequence、pending 深度、ACK/echo 処理を裁定どおりの規模で検証するには、合計3,000件または各セッション1,000件のループにする必要があります。