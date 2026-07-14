documentId 検証が snapshot 優先または oplog 先頭のみのため、混在した永続データから別文書の操作を黙って再生できる経路が残っています。また、DD の生成索引が変更後のステータスと同期されていません。

Full review comments:

- [P1] oplog 全体の documentId を検証する — C:\repo\spreadjs\packages\server\src\persistent-room.ts:112-113
  旧版で doc-A のディレクトリを doc-B として起動した後、doc-A の snapshot が残ったまま doc-B の tail が追記されたケースでは、`persisted?.documentId` が A を返すため oplog 側を検査せず、requested A として B の操作まで replay します。snapshot がない混在ログでも先頭以降の別 ID を見逃すため、snapshot と全 oplog entry の documentId を要求 ID と照合してください。

- [P2] ステータス変更後に DD 索引を再生成する — C:\repo\spreadjs\doc\DD\DD-018-1_documentId-persistenceDir-failfast.md:5-5
  ここで DD-018-1 を「進行中」へ変更していますが、`doc/DD/DD-INDEX.md:9` は依然として「検討中」「起票のみ」と表示しています。リポジトリ規約どおり `scripts/dd-index-gen.sh` で索引を再生成しないと、DD の進捗確認が誤った状態になります。