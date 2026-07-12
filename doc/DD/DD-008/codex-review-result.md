文書体系の中心となる憲章の承認状態と権威表記が DD の状態と矛盾しています。また、生成タグの混入と名称調査の未分類ヒットがあり、受け入れ基準を満たしていません。

Full review comments:

- [P2] DD の承認状態と憲章の Accepted 表記を同期する — C:\repo\spreadjs\doc\product\nanairo_sheet_product_charter_v1.md:6-6
  憲章は「DD-008で承認」としていますが、DD-008 本文と DD-INDEX は現在も「検討中・要確認8件あり」で、決定事項やタスクも未確定のままです。憲章 §1 では現在状態について DD を優先するため、この状態では承認済みか判断できません。DD 側に仕様確認結果と承認を記録して状態を進めるか、それまでは憲章を Proposed に戻す必要があります。

- [P2] Accepted 後も残る「最上位正典候補」を確定表記にする — C:\repo\spreadjs\doc\product\nanairo_sheet_product_charter_v1.md:11-11
  同じヘッダーでステータスを Accepted とし、DOC-MAP でも本書を最上位正典としている一方、この行だけは依然として「最上位正典とする候補」です。文書体系の権威が候補なのか確定なのか再び曖昧になるため、承認後の位置付けに合わせて確定表記へ更新してください。

- [P2] 生成プロンプト由来の終了タグを文書から除去する — C:\repo\spreadjs\doc\DD\DD-008\naming-survey.md:80-81
  調査表の末尾に Markdown の内容ではない `</content>` と `</invoke>` が混入しています。同様に `codex-review-request.md` の末尾にも `</content>` が残っており、レビュー生成時のラッパーが成果物へ漏れています。これらは文書としてそのまま表示されるため、コミット前に両ファイルから除去してください。

- [P2] 旧 npm スコープの未分類ヒットを調査表へ追加する — C:\repo\spreadjs\doc\DD\DD-008\naming-survey.md:44-46
  AC が要求する grep の全ヒット分類に対し、`doc/archived/DD/DD-001/codex-review-request.md:64` の `@spreadjs/sheet-types` がこの行の列挙対象に含まれていません。この添付文書には旧称注記もないため、「旧称の残存はすべて注記済み」というまとめも成立しません。歴史的レビュー依頼として修正不要とする場合でも、採否表へ明示的に追加してください。