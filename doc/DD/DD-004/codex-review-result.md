主要な受け入れ指標が未実施または負荷条件外でも pass になり、計測結果が PoC-B の判断材料として信頼できません。また、10分試験中の無制限キャッシュ増加や構造変更後のUI例外など、実動作にも複数の回帰があります。

Full review comments:

- [P1] フレーム計測を自動スクロール中だけに限定する — C:\repo\spreadjs\apps\playground\src\pocb\harness.ts:135-137
  `onFrame` は自動スクロールの開始状態に関係なく全 rAF 間隔を蓄積します。ページを開いて数分待ってから30秒だけ自動スクロールすると、大量の無描画フレームが p95 を支配し、スクロール中に5%以上の遅延があっても AC1 が pass になり得ます。計測開始時にサンプルを分離するか、`autoScrollPlan !== null` の期間だけ記録してください。

- [P1] 単調増加するメモリを AC4 で不合格にする — C:\repo\spreadjs\apps\playground\src\pocb\metrics.ts:163-165
  AC4 は「メモリが単調増加しない」ことを要求しますが、この判定は傾きが 512KB/s 未満なら pass にします。例えば10秒ごとに1MBずつ増える完全な単調増加でも約102KB/sなので pass となり、10分で約60MB増加する結果を合格として報告します。ノイズ許容を設ける場合も、増加の継続性や開始・終了差を併用して基準そのものを検証する必要があります。

- [P1] 文字キャッシュの無制限な増加を止める — C:\repo\spreadjs\apps\playground\src\pocb\text-cache.ts:22-23
  両 Map はリサイズされるまで一度も破棄・退避されないため、自動スクロールで新しいセル文字列を見るたびにエントリが増え続けます。500,000セルには一意な数値・短英数が多数あり、`fitText` の二分探索候補も `widthCache` に残るので、10分連続試験自体が単調なヒープ増加を引き起こします。フレーム単位のキャッシュ、上限付き LRU、または定期的な世代破棄が必要です。

- [P1] 未実施の anchor 検証を pass にしない — C:\repo\spreadjs\apps\playground\src\pocb\main.ts:88-88
  `lastAnchorMaintained` が初期値 `true` のため、anchor 操作を一度も実施せず他の計測だけ採取してエクスポートすると AC5 が pass になります。その状態で他項目が通れば `overall` も pass となり、50,000行末尾での検証を実施していない結果が合格記録になります。初期状態を未検証として表現し、操作完了後だけ boolean 判定へ渡してください。

- [P2] 可視セル数が計測条件内かを合否判定する — C:\repo\spreadjs\apps\playground\src\pocb\metrics.ts:141-142
  `visibleCellCount` は入力に含まれるだけで `evaluateAcceptance` から参照されません。そのため可視セルが目標の2,000〜4,000件から外れた小さなウィンドウや大きなセル寸法でも `overall: pass` を出せ、負荷条件を満たさない測定が正式な合格根拠になります。範囲外なら少なくとも全体判定を `n/a` または fail にしてください。

- [P2] pointer イベントの待機時間を選択遅延に含める — C:\repo\spreadjs\apps\playground\src\pocb\main.ts:241-241
  AC3 と DD は `Event.timeStamp` から overlay 描画完了までを測る設計ですが、ここではイベントハンドラー実行後の `performance.now()` を起点にしています。メインスレッドが base 描画などで詰まり pointer イベントの配送が遅れた場合、その待機時間が丸ごと除外され、実際には50msを超える操作でも pass になり得ます。

- [P2] 生成用の50万セル配列をロード後に解放する — C:\repo\spreadjs\apps\playground\src\pocb\main.ts:75-76
  `genResult` がページ存続中ずっと参照され、`updateReadout` もそのプロパティを読むため、ストアへロード済みの500,000個のセルオブジェクトと配列が GC されません。これは製品 CellStore には不要な生成時ワーク領域であり、メモリ目標とストア方式比較の実測値を数十MB規模で押し上げます。必要な件数・所要時間だけ残し、セル配列への参照をロード後に切る必要があります。

- [P2] 現在の Axis 件数だけサイズを更新する — C:\repo\spreadjs\apps\playground\src\pocb\main.ts:350-352
  「1000行削除」を一度実行した後にセル寸法を適用すると、行数は49,000件なのにこのループは固定の50,000回を実行し、`rowAxis.setSize(49000, h)` で範囲外例外を投げます。逆に挿入後は追加行の一部が更新されません。構造変更後も使えるよう `rowAxis.count()` を上限にしてください。

- [P2] 固定境界をまたぐ overlay を pane ごとに描画する — C:\repo\spreadjs\apps\playground\src\pocb\overlay-layer.ts:59-65
  `rangeRect` は固定側の始点とスクロール側の終点を異なる変換で結んだ単一矩形にしています。固定列0から通常列までの選択を残して横スクロールし、通常側の終点が固定 pane の背後へ移動すると幅が負または極端に小さくなり、画面に残る固定セルの選択表示まで消えます。固定行列をまたぐ選択・Presence は4象限ごとに範囲を分割して各 clip 内で描画する必要があります。