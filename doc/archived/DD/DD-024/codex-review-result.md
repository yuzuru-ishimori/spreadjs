単独モードの公開再注入 API が mount 直後の呼び出しを破棄し、文書差し替え後の編集状態と revision にも不整合があります。共同編集側の抽出自体は概ね等価ですが、これらは standalone の主要契約を壊します。

Full review comments:

- [P1] Preserve setData calls made before standalone boot — C:\repo\spreadjs\packages\grid\src\mount-controller.ts:883-885
  `mount()` の直後に同期的に `instance.setData(data)` を呼ぶと、standalone backend は microtask で構築されるため、ここでは `standalone` がまだ `undefined` で再注入が永久に破棄されます。公開の ready 通知もないため、キャッシュ済み react-query データを mount 直後に渡す通常の経路で発生します。boot 前のデータを保持して構築後に適用してください。

- [P2] Clamp the active cell after replacing the document — C:\repo\spreadjs\packages\grid\src\mount-controller.ts:887-887
  `setData` で行数を縮めた場合（例: 20行目が active のまま2行へ再注入）、文書と View だけが差し替わり、IME state machine の `activeCell` は旧 index のまま残ります。その後の直接入力や Delete は `rowIdAt(oldIndex)` が `undefined` となって commit が無言で失われるため、再注入時に active cell を新しい範囲へクランプまたは再初期化する必要があります。

- [P2] Keep the revision monotonic for empty reinjections — C:\repo\spreadjs\packages\grid\src\standalone-session.ts:72-73
  編集や非空データ注入で revision が進んだ後に `setData({ rows: [] })` を呼ぶと、この早期 return は revision 0 の `createDocument` を返すため、`committedDocument.revision` が後退します。contract §5 の単調増加不変条件を破るので、空文書にも現在の revision を引き継ぐか一貫して増分を付与してください。