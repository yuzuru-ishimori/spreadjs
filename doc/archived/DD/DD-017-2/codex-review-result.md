主要な実装経路は成立していますが、紹介サイトの表示内容と実際のデモ提供範囲が一致せず、一部機能では意図した出典表示も利用できません。外部向け進捗可視化という変更目的に影響するため修正が必要です。

Full review comments:

- [P2] デモ可能という説明をリンク付き機能に限定する — C:\repo\spreadjs\apps\showcase\index.html:75-75
  「提供中」の全機能をデモから確認できるように読めますが、実際には9件中 `sdk`・`distribution`・`quality` の3件に `demo` がなく、リンクは6件だけです。利用者がリンクを探すことになるため、「デモ付き機能はその場で確認できる」など実データに合う説明へ修正してください。

- [P2] meta が空でも出典を確認できる場所へ title を付ける — C:\repo\spreadjs\apps\showcase\src\catalog\main.ts:56-58
  `editing`・`persist`・`distribution`・`quality` のように `meta: ""` の機能では、`title` が空の `span` に設定されるためホバー対象がなく、合意された「DD/CG番号を title 属性で裏に格納」が画面上で機能しません。出典をカードまたは幅のある meta コンテナへ設定し、meta の有無にかかわらず確認可能にしてください。