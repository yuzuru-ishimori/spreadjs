複数のHard Gateで、直接未計測の事項を代理証拠だけで非該当または強い証拠として表現しています。また、実施済み申告と未実施、n/aとEの区別にも転記上の不整合があります。

Full review comments:

- [P1] rollback遅延の直接証拠をEとして扱ってください — C:\repo\spreadjs\doc\DD\DD-007\go-nogo-package.md:244-244
  package §7 は「No-Go非該当」と断定して証拠を `A（代理）` としていますが、出典の ADR-008 は in-process/localhost の pending 深度と ops/sec による間接観察に限定し、実RTT・実IME下の入力遅延は直接未測定としています。Hard Gate の直接証拠は E、代理観察は A と分離し、「非該当」はユーザー判定前には未確定とするのが忠実です。

- [P1] ブラウザーヒープ未取得のまま非該当と断定しないでください — C:\repo\spreadjs\doc\DD\DD-007\go-nogo-package.md:245-245
  package §7 は DD-006 の Chrome 完走と「乖離なし」からブラウザーメモリの No-Go を非該当としていますが、`DD-006/measurement-report.md` L105-120 は `performance.memory` が非公開で精密ヒープを取得できず、乖離なしは時間と approxStore に基づくと記録しています。DD-004 の別実装で得た約29MBとDD-006の完走・概算を分離し、採用候補の直接ブラウザーヒープは E、No-Go該当性は未確定と記載してください。

- [P2] 申告済み実IME試験を未実施Eから分離してください — C:\repo\spreadjs\doc\DD\DD-007\go-nogo-package.md:33-33
  package A-1 は実機試験を口頭「全部OK」としながら「実IME直接試験はE」としていますが、`DD-002` L150-153/L262-265 では4環境の50回試験を実施したとの申告があり、未実施なのはトレース保存・発火順観察です。実機試験自体は D、トレース保存など未実施部分だけを E とするよう修正してください。

- [P2] key操作の選択反応を未計測として残してください — C:\repo\spreadjs\doc\DD\DD-007\go-nogo-package.md:178-178
  package §4 は計画書 §21 の「pointer／keyから50ms未満」を、DD-004 の worst 16.9msだけで達成扱いにしていますが、DD-004 §18.2/measurement-report AC3 が測定したのは pointer→選択枠だけで、key起点の遅延値はありません。pointerは達成、keyは未計測（E）と分けてください。

- [P2] 貼り付けSLOをn/aではなく未実施Eにしてください — C:\repo\spreadjs\doc\DD\DD-007\go-nogo-package.md:180-180
  package §4 は10,000セル貼り付けを「n/a（Phase 3）」としつつ証拠レベルを E にしており、n/a と未実施を同じ行で混在させています。計画書 §21 L1925 に有効なSLOとして存在し、単にPhase 0では測っていない項目なので、「Phase 3で計測予定・未実施（E）」とするのが正確です。

- [P2] Canvas Hard Gateにもsoak未実施Eを併記してください — C:\repo\spreadjs\doc\DD\DD-007\go-nogo-package.md:239-239
  package §1 B-4 では厳密な10分連続フォアグラウンドsoakを E と正しく記録していますが、§7の集約では本文に未実施と書きながら証拠レベルを `B+C` のみにしています。§18.2の合格条件をまとめたHard Gateなので、代理傾向 B+C／厳密soak E と併記しないと証拠強度が過大に見えます。