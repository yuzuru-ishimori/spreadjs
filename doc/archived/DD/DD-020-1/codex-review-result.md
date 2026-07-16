Viewport 外ドラッグで不可視セルが選択され、Undo 未提供の範囲 Delete による意図しないデータ消失につながる経路があります。また、空の不正レンジが上限検査を実質的に迂回して長時間走査されます。

Full review comments:

- [P1] Viewport 外の pointermove を hitTest 前に除外する — C:\repo\spreadjs\packages\grid\src\mount-controller.ts:523-526
  Pointer capture 中は viewport 外へ出た後もこの処理へ座標が届きますが、`ViewportTransform.hitTest` は右端・下端の外側を `outside` にせず Axis 上のセルへ解決します。そのためドラッグが少し外へ出るだけで不可視セルまで範囲に追加され、続く Delete で画面外の値を意図せずクリアできます。autoscroll 対象外という仕様どおり直近 focus を維持するには、`hitTest` の前に viewport 座標境界を検査する必要があります。

- [P2] 空レンジを走査前に no-op にする — C:\repo\spreadjs\packages\grid\src\range-ops.ts:61-61
  片方だけ空または逆転した `CellRange`（例: `{rowStart:0,rowEnd:1_000_000_000,colStart:1,colEnd:0}`）では `countRangeCells` が 0 を返すため上限検査を通過しますが、この外側ループは 10 億回実行されます。内部 API の不正・空レンジ入力で UI を停止させないよう、どちらかの span が 0 以下なら走査前に `noop` を返す必要があります。