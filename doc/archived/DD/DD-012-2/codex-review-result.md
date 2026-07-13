性能判定器が未採取・部分採取のレポートを pass にでき、CG-6も10分未満やgrowthRatio欠落で通過できます。また、手順の一部は実際の出力形式と互換性がありません。

Full review comments:

- [P1] pass 前に全性能標本の存在を必須化する — C:\repo\spreadjs\scripts\cg-perf\perf-judge-core.mjs:89-95
  `rollup` は `n/a` のメトリクスを除外して残りが pass なら全体を pass にするため、未計測レポートを合格扱いできます。既存ハーネスはスクロール未実施時にも `frame: {count: 0, p95: 0}` を出すので、選択・再描画も未採取のまま可視セル帯とメモリだけ満たすと `perf.overall=pass` になり、CLI も exit 0 になり得ます。`frame.count > 0` と3メトリクスすべての標本存在を pass の必須条件にしてください。

- [P2] 可視セル数が未取得なら条件未達にする — C:\repo\spreadjs\scripts\cg-perf\perf-judge-core.mjs:62-65
  `visibleCellCount` が欠落したレポートでは値が 0 になりますが、`visible > 0` の条件によって `conditionUnmet` は false になります。そのためタイミング値が揃っていれば、負荷条件を確認できていないレポートでも pass になります。0または欠落も帯外と同様に `n/a` に落としてください。

- [P1] CG-6 pass に10分の計測時間を要求する — C:\repo\spreadjs\scripts\cg-perf\perf-budget.json:26-26
  `minSamples: 2` だけでは、10秒間隔のハーネスで約10秒採取しただけのレポートがリーク傾向 pass になります。手順とACは10分連続の時系列計測を要求しているため、このままでは短時間の平坦な標本でCG-6を誤解除できます。サンプル時刻の範囲が約600秒以上であることも判定条件にしてください。

- [P2] growthRatio 欠落時にリーク判定を通さない — C:\repo\spreadjs\scripts\cg-perf\perf-judge-core.mjs:118-119
  仕様は slope と growthRatio の AND 判定ですが、`growth === null` を許容しているため、標本数と slope だけを含むレポートは growthRatio 未計測でも pass になります。別ハーネスから変換したレポートなどで値が欠落した場合は `n/a` とし、両方の有限値が存在するときだけ pass にしてください。

- [P2] scroll と selection の機能上限を厳密な不等号にする — C:\repo\spreadjs\scripts\cg-perf\perf-judge-core.mjs:75-77
  共通の `value > ceilingVal` 判定では、scroll p95 がちょうど33ms、または選択応答がちょうど50msの場合に fail ではなく over-budget になります。§18.2 と予算表はいずれもこれらを `<33ms`・`<50ms` としているため、停止中再描画の `≤12ms` とは別に厳密比較を指定してください。

- [P2] tripwire で受け入れ条件全体を固定する — C:\repo\spreadjs\tests\invariants\perf\perf-judge.test.ts:43-51
  この tripwire は `budget` の4値しか固定していないため、合格条件を緩める変更を網羅できません。例えば `timingPct` を20から25へ、`visibleCellBand.max` を10000へ、またはリーク閾値を大幅に緩和しても現行fixturesは引き続き通ります。spec変更扱いの `noiseMargin`、`hardCeiling`、可視セル帯、`leakTrend` も明示的にピン留めしてください。

- [P2] pocd-browser-bench の非互換な計測経路を修正する — C:\repo\spreadjs\doc\DD\DD-012-2\cg6-memory-procedure.md:47-53
  ここで代替として案内している `pocd-browser-bench` は、単発の `metrics.memory.usedJSHeapSize` を出すだけで時系列を採取せず、判定器が要求する `memory.samples` と `memory.trend` の形式でもありません。この経路を選ぶと続くCLIは `memory.overall=n/a` となりCG-6を判定できないため、変換・時系列採取ハーネスを追加するか代替手順から除外してください。

- [P2] DD ステータス変更後にインデックスを再生成する — C:\repo\spreadjs\doc\DD\DD-012-2_性能縦切り.md:5-5
  DD本文は「確認待ち・Phase 0/1完了」に更新されていますが、`doc/DD/DD-INDEX.md` は依然として「検討中・DD-012-1完了後に着手」のままです。正本と一覧が矛盾しているため、規定どおり `scripts/dd-index-gen.sh` でインデックスを再生成してください。