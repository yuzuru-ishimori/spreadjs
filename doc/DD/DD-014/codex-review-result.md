Durable frontier の公開・snapshot・障害処理に複数の競合があり、ACK 済み operation の欠落や再起動不能が発生します。またブラウザー初期ロードは依然として全ログ replay で、CG-3 の完了条件を満たしていません。

Full review comments:

- [P1] 改行なしの oplog 末尾を必ず切り詰める — C:\repo\spreadjs\packages\server\src\oplog-store.ts:129-132
  クラッシュ時に JSON 本体だけが完全に書かれ改行だけ欠けた場合、`JSON.parse` が成功するため未 fsync・未 ACK の operation を復元してしまいます。逆に parse 失敗時も破損バイトをファイルから除去しないため、再起動後の append がその直後へ連結され、次回起動では ACK 済みの新規行まで破損扱いになります。改行なしの最終行は内容にかかわらず破棄し、append 再開前に最後の改行位置まで物理的に truncate してください。

- [P1] 全バイトを書き終えてから durable と判定する — C:\repo\spreadjs\packages\server\src\oplog-store.ts:88-88
  `FileHandle.write()` は例外なしで short write を返せますが、`bytesWritten` を確認せず fsync と resolve を実行しています。ディスク容量不足などで一部だけ書かれた場合もバッチ全件へ ACK が返り、再起動時に末尾破棄または欠落が発生します。Buffer の全バイトを書き切るループか full-write API を使用してください。同じ単発 write の問題は `snapshot-store.ts:108` にもあります。

- [P1] fsync 前の revision を他の読取経路から隠す — C:\repo\spreadjs\packages\server\src\persistent-room.ts:161-161
  accepted submit はここで Sequencer を同期的に前進させてから append を待つため、その待機中に別クライアントが join/requestCatchup すると、直接委譲された Room が未 durable operation を返して即 dispatch します。`/snapshot` も同じ状態を参照するため、元 submit の ACK/broadcast を遅延しても durable 境界を迂回できます。読取を durable frontier までに制限するか、append 完了まで join/catch-up/snapshot をゲートしてください。

- [P1] durable frontier を超える snapshot を保存しない — C:\repo\spreadjs\packages\server\src\persistent-room.ts:200-200
  あるバッチの fsync 完了後に snapshot 閾値へ達した時点で、Sequencer には次バッチの未 fsync operation が既に適用されている可能性があります。この export が次バッチより先に rename されてクラッシュすると、snapshot revision が durable oplog 長を超え、正常なログが残っていても次回起動が fail-fast します。snapshot は完了した append の最大 revision に対応する状態だけから作るか、export revision までの oplog barrier を待ってください。

- [P1] oplog 障害後は room 全体を停止する — C:\repo\spreadjs\apps\collaboration-server\src\server.ts:194-196
  append が失敗した時点では operation と revision が共有 Sequencer に既に反映されていますが、ここでは送信元 socket だけを閉じて room を継続します。その後の operation が revision N+1 として保存・ACK されると oplog に欠番が生じ、他接続も未配信の N を含む状態を参照します。rollback が保証できない場合は store/room を poisoned 状態にして全 document write を停止し、保留中バッチもまとめて reject してください。

- [P1] playground を snapshot から初期化する — C:\repo\spreadjs\apps\collaboration-server\src\server.ts:308-308
  永続化 Room を配線しても `handleJoin` は既存 Room へ直接委譲されるため、ブラウザー再読込で生成された空の ClientSession は `lastAppliedRevision=0` で全 operationLog を受信・replay します。playground の boot は `/snapshot` を取得しておらず、100k ログの初期ロードが全 replay 非依存という AC4 を満たしません。document snapshot で ClientSession を初期化してから tail のみ join で受け取る経路が必要です。

- [P1] 実行していない Playwright AC8 を完了扱いしない — C:\repo\spreadjs\doc\DD\DD-014_永続化・snapshot復元.md:108-108
  現差分にはブラウザー再読込を行う Playwright テストや証跡がなく、`server.persistence.test.ts` は Node の `WsClientTransport` で新規接続を確認しているだけです。さらに実装上も playground は snapshot bootstrap を行わず全ログを replay します。この状態で AC8、DD 完了、CG-3 解除を確定せず、実ブラウザーの編集→ACK→再読込→再起動復元を追加するまで未完了に戻してください。

- [P2] 構造 operation の replay でも二乗計算を避ける — C:\repo\spreadjs\packages\core\src\apply.ts:102-102
  `replayAcceptedOperations` は clone を除去しましたが、各 InsertRows は `nextSlot` で全 `rowMeta` を走査し、`rowOrder.splice` でも既存要素を移動します。そのため単一行 InsertRows が N 件並ぶ正当なログは依然 Θ(N²) です。計測スクリプトは行挿入を一つの bulk operation にしてこの経路を隠しているため、next-slot cursorや適切な順序構造を使い、構造ログでも AC5 を検証してください。

- [P2] 初回起動時に persistenceDir を作成する — C:\repo\spreadjs\packages\server\src\oplog-store.ts:85-85
  `PERSISTENCE_DIR` がまだ存在しない通常の初回起動では、readAll は ENOENT を空ログとして扱いますが、seed 永続化時の `open(..., 'a')` は親ディレクトリがないため ENOENT で失敗します。`FileSnapshotStore` と同様に親ディレクトリを再帰作成してから oplog を開いてください。

- [P2] snapshot の room と revision を照合する — C:\repo\spreadjs\packages\server\src\persistent-room.ts:73-75
  `persisted.documentId` と、封筒 revision・`snapshot.currentRevision`・`snapshot.document.revision` の一致を検査せず tail の開始位置を決めています。同じ persistenceDir を別 documentId で起動すると旧文書を新 ID として公開し、checksum が正しい不整合 snapshot では誤った位置から tail を適用します。期待 documentId を recovery に渡し、snapshot、oplog envelope、全 revision メタデータを相互検証してください。

- [P2] restoreFrom と persistenceDir の併用を安全に扱う — C:\repo\spreadjs\apps\collaboration-server\src\server.ts:277-279
  空の persistenceDir と revision R の `restoreFrom` を同時指定すると、その state は採用されますが既存 operationLog は oplog へ書かれません。次の accepted operation が R+1 をファイルの先頭へ書くため、次回起動は revision 不連続で失敗し、追加操作がなければ復元文書自体が失われます。この組合せを明示的に拒否するか、restoreFrom の全ログを durable bootstrap してください。

- [P2] snapshot 完了時に蓄積済み operation を再判定する — C:\repo\spreadjs\packages\server\src\persistent-room.ts:206-208
  snapshot 書込中に N 件以上の durable operation が到着すると、各 `maybeSnapshot` は `snapshotInProgress` で戻りますが、完了処理は flag を下げるだけです。その後トラフィックが止まると閾値超過分の snapshot は生成されず、tail が N を大きく超え得ます。完了時に蓄積件数を再判定し、失敗時には前回 snapshot 以降の件数も失わないようにしてください。