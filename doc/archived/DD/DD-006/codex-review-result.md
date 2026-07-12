固定ID参照が数式評価へ統合されておらず、循環検出と大規模評価にも外部例外や誤結果を生む問題があります。また、AC1/AC5の計測証跡が事前規約・受け入れ基準を満たしていないため、現状ではDD-006を合格と判断できません。

Full review comments:

- [P1] 数式参照を評価前に固定IDへ束縛する — C:\repo\spreadjs\packages\sheet-formula\src\ast.ts:23-24
  行挿入・削除を伴う場合、数式ASTは現在も `A1Ref` の行列indexを保持し、`FormulaSheet` もindexで評価するため、`bindCellRef` の単体利用とは無関係に参照先がずれます。結合テストも束縛セルを直接読むだけで数式を評価しておらず、AC3の行挿入後の評価値維持とAC4の削除後 `#REF!` を実証できていません。ASTまたは評価用ASTを `BoundCellReference` へ変換し、構造変更後の数式評価まで試験してください。

- [P1] 循環する強連結成分の全セルをcycleへ含める — C:\repo\spreadjs\packages\sheet-formula\src\dep-graph.ts:231-233
  GRAYへの後退辺上の現在のpathだけを記録する方式では、同一SCCの全メンバーを検出できません。例えば `A=B+C, B=A, C=COUNT(B)` をAから探索するとA/Bだけがcycleになり、後でBLACKのBへ到達するCはcycleから漏れて `COUNT` が `#CYCLE!` を無視し0を返します。Tarjan等でSCC全体を特定し、循環成分の全式を評価前に `#CYCLE!` にしてください。

- [P1] 単項演算子の連鎖を反復的に解析する — C:\repo\spreadjs\packages\sheet-formula\src\parser.ts:107-111
  L1内の入力でも `=` に続けて約8,000個の `-` を置けますが、`parseUnary` はL3カウンタを通らず同数だけ再帰するため、`ParseError`へ変換される前に `RangeError: Maximum call stack size exceeded` が外へ漏れ得ます。外部入力で例外を出さないAC8を満たすため、単項演算子列を反復処理するか再帰深度を明示的に制限してください。

- [P1] MIN/MAXで巨大配列をspreadしない — C:\repo\spreadjs\packages\sheet-formula\src\evaluator.ts:144-147
  大範囲は最大4,000,000件近い数値を収集できますが、`Math.min(...nums)` と `Math.max(...nums)` はJavaScriptの関数引数上限を大幅に超え、数十万件程度でもRangeErrorを送出します。この例外は `EvalError` ではないため外へ再送出され、AC8と500,000非空セル規模の評価要件を破ります。SUM同様に反復集計してください。

- [P1] AC5の100,000 Operation実測を取得する — C:\repo\spreadjs\doc\DD\DD-006\measurement-report.md:77-85
  コミットされた `replay-node-10k.json` は `count: 10000` で50,000/100,000 checkpointを含まないのに、ここでは100,000件をreplayしたと記載しています。AC5は5 checkpointの実測を要求しており、推定値だけでは合格判定やsnapshot閾値の根拠にならないため、`--full` の生JSONを保存して表と判定を更新するか、AC5を未達として扱ってください。

- [P1] CellStore方式を試行ごとにローテーションする — C:\repo\spreadjs\apps\pocd-bench\src\bench-cellstore.ts:243-246
  bench-protocol §2は方式順を試行ごとに巡回すると固定していますが、実装は分布ごとに一度だけ並べ替え、各方式のwarmupと全試行をまとめて完走しています。このためJIT、温度、GC、キャッシュの順序バイアスが方式差へ混入し、方式選定に使ったAC1の実測が規約準拠になりません。試行を外側にして方式を毎回ローテーションし、証跡を再取得してください。

- [P2] 空セルの範囲走査もL6へ計上する — C:\repo\spreadjs\packages\sheet-formula\src\recalc.ts:43-46
  `FormulaSheet.readRange` は矩形内の全セルを走査する一方、非空セルにしかcallbackを呼ばないため、evaluatorのstepカウンタは空セル走査を認識できません。例えば低い `maxEvalSteps` で巨大な空範囲をSUMしても `#ERROR!` にならず全範囲を走査して0を返し、既定上限でも最大10,000,000セルの同期ループをL6で遮断できません。実際の走査件数を評価器へ報告できる契約にしてください。

- [P2] 数値文字列を10進数文法だけで変換する — C:\repo\spreadjs\packages\sheet-formula\src\evaluator.ts:121-124
  `Number` は仕様で許可された`.`区切りの10進数以外にも、`"0x10"`、`"1e3"`、前後空白などを受理します。そのため `SUM("0x10",1)` が17、`SUM("1e3",1)` が1001となり、function-spec §2のロケール非依存な小数のみという変換規則に反します。算術側の `toNumber` も含め、ASCII 10進数の明示パーサを共用してください。

- [P2] 左辺エラー時は右辺を評価しない — C:\repo\spreadjs\packages\sheet-formula\src\evaluator.ts:189-190
  二項式は関数引数評価によって左右を先に両方評価するため、左辺で確定したエラーを返す前に右辺の処理量超過がthrowされます。例えば `=1/0+SUM(巨大範囲)` は仕様上最初の `#DIV/0!` ですが、右辺がL6を超えると `#ERROR!` になります。左辺を評価・伝播判定してから右辺へ進むよう短絡してください。

- [P2] 同順位の再計算順を固定ID順で決定する — C:\repo\spreadjs\packages\sheet-formula\src\dep-graph.ts:211-217
  topological DFSの開始順は `affected` Setへの挿入順に依存しているため、同じdirty集合でも `changed` の列挙順やdependents登録順が異なると並列式の再計算順が変わります。function-spec §5は同順位を固定ID昇順で決定すると定めているので、探索開始点とprecedent列を安定した固定ID順に並べてください。

- [P2] 引用されたエラー表記を文字列として扱う — C:\repo\spreadjs\packages\sheet-formula\src\evaluator.ts:177-179
  tokenizer上の `"#REF!"` は通常の文字列リテラルですが、評価時にエラー値へ変換されるため、`SUM("#REF!",1)` が数値変換不能の `#VALUE!` ではなく `#REF!` を返します。セル由来エラーは既に `CellValue.kind === 'error'` で表現できるので、ASTの文字列リテラルは常に文字列として評価してください。

- [P2] セルから読んだ非有限値を検証する — C:\repo\spreadjs\packages\sheet-formula\src\evaluator.ts:180-181
  セル参照はreaderの値をそのまま返すため、A1が `NaN` や `Infinity` の場合に `=A1` が非有限値を外へ返し、`COUNT(A1)` も数値として数えます。function-spec §2.1は非有限値を外へ出さず `#VALUE!` にすると定めているので、セル読み取り時にもnumberの有限性と負の0を正規化してください。