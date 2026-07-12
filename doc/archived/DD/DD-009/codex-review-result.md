server-hono の依存DAGと codec 所有権が矛盾し、次の DD-011 では既存 apps に対して boundary lint を green に導入できません。また、lint の判定漏れと重要なPoC検証資産の台帳漏れがあり、後続DDの前提として未確定部分が残っています。

Full review comments:

- [P1] server-hono の codec 依存経路を定義する — C:\repo\spreadjs\doc\DD\DD-009\package-boundary.md:76-76
  `server-hono` の許可依存には `collab` がありませんが、codec の所有先は `collab` と定義され、現行 `apps/collaboration-server/src/server.ts` も `decodeClientMessage` を `sheet-collaboration` から import しています。このまま抽出すると R3 に違反し、サーバー側でフレームを復号できないため、codec を `core` 等の共有層へ移すか依存方向を明示的に変更する必要があります。

- [P1] 既存 apps を壊さない lint 導入段階を定義する — C:\repo\spreadjs\doc\DD\DD-009\package-boundary.md:91-91
  DD-011 で R1 を `apps/*/src` 全体へ有効化すると、DD-012〜016 の抽出前である現行 `playground` と `collaboration-server` の多数の内部 package import が即座に ERROR になります。DD-011 のスコープだけではこれらを Facade 経由へ移行できないため、consumer harness のみに先行適用する、既存違反を期限付き baseline にするなど、後続DDまで green を維持できる段階的適用が必要です。

- [P2] R7 で named export と型漏洩も検出する — C:\repo\spreadjs\doc\DD\DD-009\package-boundary.md:97-97
  R7 の判定方法は `export *` だけなので、`export { Foo } from '@nanairo-sheet/core'`、`export type { Foo } ...`、または公開関数の引数・戻り値に内部型を使うケースが通過します。これらも「内部型を漏らさず Facade 自前の公開型のみ」という契約を破るため、ASTまたは型情報を使った検査対象として明記しないと boundary lint に判定漏れが残ります。

- [P2] collaboration-server の未分類資産を台帳へ追加する — C:\repo\spreadjs\doc\DD\DD-009\poc-asset-ledger.md:102-110
  この表は `apps/collaboration-server/test/` の `convergence.test.ts`、`protocol-contract.test.ts`、`restart-restore.test.ts`、`ws-convergence.smoke.test.ts` などを列挙していません。これらは収束・protocol・snapshot復旧に関する後続DDの主要な検証資産であり、「DD-002〜006 の全資産を分類する」というACを満たさず、抽出時に引継ぎ対象から漏れるため分類・担当DD・完了条件を追加する必要があります。

- [P2] DD-009 のステータスを正本と同期する — C:\repo\spreadjs\doc\DD\DD-INDEX.md:9-9
  DD本文のヘッダは `進行中` ですが、自動生成対象の索引では `検討中` になっています。後続DDや `/dd list` が索引を現在状態の正本として参照するため、この不一致があると進捗判定を誤るので、本文の確定状態から `dd-index-gen.sh` で再生成してください。