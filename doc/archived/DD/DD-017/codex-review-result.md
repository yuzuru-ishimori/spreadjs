release スクリプト自体が ignore されているほか、manifest 生成・install 手順・成果物検証に配布を破綻または誤検証させる問題があります。診断 taxonomy にも再現可能な誤写像があるため、現状では正しいパッチとは判断できません。

Full review comments:

- [P1] Ignore 対象をルート release/ に限定する — C:\repo\spreadjs\.gitignore:7-7
  この非アンカー指定は配下の任意の `release/` ディレクトリにも一致するため、`scripts/release/build-release.sh` が実際に ignored 扱いになっています。現状のままコミットすると release automation 本体が含まれず、クリーン checkout では文書化されたビルドコマンドが実行できません。

- [P1] tarball を完全一致で選択する — C:\repo\spreadjs\scripts\release\build-release.sh:100-103
  `readdirSync()` が `nanairo-sheet-server-hono-...tgz` を `nanairo-sheet-server-...tgz` より先に返す環境では、`pkg === 'server'` の前方一致が server-hono を選びます。その場合 manifest の server エントリと install コマンドが server-hono を重複参照して server を欠落させるため、版数込みの期待ファイル名などで完全一致させる必要があります。

- [P1] --out の削除先を検証する — C:\repo\spreadjs\scripts\release\build-release.sh:81-81
  `--out` は任意のパスを受け付ける一方、解決後のパスを検証せず再帰削除しています。例えばリポジトリルートで `--out packages` と指定または誤入力すると package ソース一式を削除するため、既定の成果物領域外を削除する場合は少なくとも保護対象や意図した絶対パスかを確認してください。

- [P1] install コマンドに tarball の所在を反映する — C:\repo\spreadjs\scripts\release\build-release.sh:126-126
  Quick Start の指示どおり別の consumer ディレクトリへ移動して manifest の `install` を実行すると、コマンドには `release/` 内の tarball へのパスがなく、カレントディレクトリの存在しないファイルを参照して失敗します。consumer-app スモークは tarball を `.vendor` へコピーするため、この配布手順の不具合を検出できません。

- [P2] closure 検査を release gate に含める — C:\repo\spreadjs\scripts\release\build-release.sh:56-58
  内部 package の実行時依存が `devDependencies` へ戻った場合、workspace hoisting によりこの typecheck/lint/test はすべて通過し、宣言漏れを含む tarball を生成できます。この再発を検出する専用の `scripts/consumer/check-closure.mjs` が gate から呼ばれていないため、一発で成果物を生成する release スクリプト自体にも組み込む必要があります。

- [P2] manifest の内容とハッシュをスモークで検証する — C:\repo\spreadjs\scripts\consumer-app.sh:71-74
  `RELEASE_VENDOR_DIR` に古い版や改変された tarball が9個置かれていても、ここでは manifest の存在と個数しか確認せず、そのまま install します。互換な内容ならスモークも green になり得るため、manifest に記録した package 名・版・ファイル名・sha256 と実ファイルを照合しない限り、配布物と manifest/source の同一性を証明できません。

- [P2] JSON 構文エラーを config-invalid に写像する — C:\repo\spreadjs\packages\grid\src\mount-controller.ts:437-437
  `/config` が HTTP 200 で不正な JSON を返すと `response.json()` が通常の `SyntaxError` を投げ、この fallback により `config-unavailable` と通知されます。到達性ではなく応答形式の問題であり、公開 taxonomy が定義する `config-invalid` と矛盾するため、JSON parse 失敗を区別してください。

- [P2] 版採番と同時に package-lock を更新する — C:\repo\spreadjs\packages\grid\package.json:3-3
  9 workspace の package.json は `0.1.0-alpha.0` へ変更されていますが、`package-lock.json` の対応する workspace エントリはすべて `0.0.0` のままです。必須手順の `npm install` で lockfile が変更され、クリーン checkout からの release が不要に dirty と記録されるうえ、追跡中の lockfile が配布元の版を表さないため、採番と同時に再生成してください。