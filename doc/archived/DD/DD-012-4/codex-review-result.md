リサイズ後にスクロール用 spacer が更新されず、通常操作で描画範囲とスクロール範囲が不整合になります。さらに公開初期値の検証、override-only 契約、境界 hit test、pointer 状態機械にも再現可能な仕様違反があります。

Full review comments:

- [P1] リサイズ時に spacer の総サイズも同期する — C:\repo\spreadjs\packages\grid\src\mount-controller.ts:382-386
  列幅または行高を変更しても、非構造 dirty の描画経路は `redraw()` だけで `syncSpacer()` を呼ばないため、スクロール領域は変更前の総幅・総高のままです。末尾付近で拡大すると新しい右端／下端までスクロールできず、縮小すると余分な空白領域へスクロールできてしまうので、Axis サイズ変更に合わせて spacer も更新してください。

- [P2] 初期 override を有効範囲へ検証・クランプする — C:\repo\spreadjs\packages\grid\src\document-view.ts:95-100
  保存データや JavaScript consumer から負値、0、2000超、非有限値が渡された場合、それらが無検証で Axis に入ります。`createAxis` は初期 overrides を検証しないため、負値や0では prefix sum の単調性が崩れて hit test／スクロール計算が壊れ、巨大値は D3 の上限にも違反します。公開オプションを取り込む時点で有限数に限定し、列20〜2000、行16〜2000へクランプする必要があります。

- [P2] 最終要素より外側の空白をリサイズ対象から除外する — C:\repo\spreadjs\packages\grid\src\resize-interaction.ts:64-66
  表示内容が viewport より短い場合、`ViewportTransform.hitTest` は右側／下側の空白でも index を最終列／最終行へクランプします。その結果 `localX` や `localY` がサイズを大きく超え、この条件が成立して空白帯全体が最終要素のリサイズハンドルになります。境界からの距離が実際に ±handle 内であることを両側から検査してください。

- [P2] 既定サイズへ戻した値を override から削除する — C:\repo\spreadjs\packages\grid\src\document-view.ts:118-120
  列を80px、行を22pxへドラッグして戻した場合も常に Map へ保存されるため、`layout` イベントには既定値と同じエントリが残ります。初期値として既定サイズが渡された場合も同様で、D2 の「既定値と異なる列／行だけ」という契約を満たしません。既定値と一致したときは Map と Axis の override を解除してください。

- [P2] pointercancel では layout を確定発火しない — C:\repo\spreadjs\packages\grid\src\mount-controller.ts:421-423
  タッチのネイティブスクロール、OS割り込み、capture喪失などで `pointercancel` が発生すると、pointerup と同じ `endResize` が呼ばれて途中状態を `layout` として保存します。D2 は pointerup 時のみの確定通知を定めているため、cancel／予期しない lost capture は後始末と確定通知を分離し、必要なら開始時サイズへ戻すべきです。

- [P2] スクロール後も frozen 境界の両側4pxを検出する — C:\repo\spreadjs\packages\grid\src\resize-interaction.ts:59-65
  水平スクロール後に frozen 列の右境界から2px右を指すと、`transform.hitTest` はその座標をスクロール側の列へ解決し、その列の `localX` は左端付近にならないため frozen 列を検出できません。行方向も同様で、スクロール後は frozen 境界の片側しか掴めず D3 の ±4px を満たさないため、pane 境界を明示的に判定する必要があります。

- [P2] active pointer 以外の move を無視する — C:\repo\spreadjs\packages\grid\src\mount-controller.ts:380-382
  リサイズ中の分岐が `event.pointerId` を確認しないため、別のタッチやペンの pointermove でも active drag のサイズがその座標へ変化します。また追加の pointerdown は状態を上書きして最初の capture を残せます。複数 pointer が存在する環境では誤リサイズや capture 漏れになるため、active pointer のイベントだけを処理し、ドラッグ中の新規開始を拒否してください。

- [P2] ドラッグ対象行を index ではなく RowId で保持する — C:\repo\spreadjs\packages\grid\src\mount-controller.ts:388-391
  行ドラッグ中に他クライアントから対象行より前への InsertRows／DeleteRows が届くと Axis が再構築され、保存済み index は別の RowId を指します。その後の pointermove は別の行高を変更してしまうため、pointerdown 時の RowId を保持し、移動ごとに現在 index／位置を再解決してください。

- [P2] ドラッグ中のスクロールで origin を陳腐化させない — C:\repo\spreadjs\packages\grid\src\resize-interaction.ts:105-109
  pointer capture は wheel やネイティブスクロールを停止しないため、ドラッグ中にスクロールすると対象列／行の viewport 上の左端・上端が移動します。ここでは開始時の `originViewport` を使い続けるので、次の pointermove でサイズがスクロール量だけ跳びます。ドラッグ中のスクロールを抑止するか、現在の transform から origin を再計算してください。