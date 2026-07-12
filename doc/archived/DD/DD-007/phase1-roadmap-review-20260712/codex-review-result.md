DOC-MAP登録と機械的整合性は問題ありませんが、Stage 1必須成果物とPoC抽出作業の担当漏れ、データ損失を残したAlpha判定、DD分割・依存の矛盾があります。計画を正式化する前にこれらの境界とゲートを修正する必要があります。

Full review comments:

- [P1] Alpha必須の配布・運用成果物を担当DDへ割り当てる — C:\repo\spreadjs\doc\plan\phase1-dd-roadmap.md:121-121
  **重要度: 高。** 製品憲章 §26.2 は社内Alphaまでに private registry配布、release automation、canary/betaチャネル、compatibility matrix、error code/debug modeを要求していますが、DD-012にもDD-018の判定条件にも含まれていません。このままではSDKを別プロジェクトへ継続配布・診断できない状態でもStage 1到達と判定できるため、これらを担当DDとDD-018のゲートへ追加してください。

- [P1] S1-1の実際の抽出作業に担当DDを設ける — C:\repo\spreadjs\doc\plan\phase1-dd-roadmap.md:21-21
  **重要度: 高。** S1-1の担保先をDD-009としていますが、DD-009の具体的作業はAdopt/Harden等の判定、境界確定、lint設置であり、`apps/playground/src` に残るIME・Canvas等を `packages/*` へ抽出する実装は含まれていません。判定だけでは憲章 §15 の「PoCコードが抽出されている」を満たせないため、採用資産ごとの抽出・ビルド・検証をDD-009または後続DDへ明示的に割り当ててください。

- [P1] §19 Phase 1を含むという主張と必須範囲を一致させる — C:\repo\spreadjs\doc\plan\phase1-dd-roadmap.md:41-41
  **重要度: 高。** ここではStage 1が計画書 §19 Phase 1を含むとしていますが、同節の基本Clipboardと数式parser骨格はDD-014/DD-017で任意扱いとなり、§23 Phase 1完了条件の50,000行scroll/selectionも必須ゲートへ割り当てられていません。§19 Phase 1全体を取り込むなら各項目を必須DDへ写像し、選択した一部だけを取り込む意図なら「Phase 1の一部」と明記して技術フェーズ完了とは区別してください。

- [P1] データ損失が残る状態をAlpha成立条件から除外する — C:\repo\spreadjs\doc\plan\phase1-dd-roadmap.md:129-129
  **重要度: 高。** DD-009〜013でAlpha成立とすると、DD-015を実施せず、§6で明記した「client→server欠落時に入力が失われる」制約を残したままDD-018へ進めます。共同編集で保存できるSDKという到達目標とデータ損失防止ガードレールに反するため、DD-015をAlpha必須にするか、未実施時はオンライン限定・未送信入力非保証などの明確な製品境界と判定ACを設けてください。

- [P1] DD-011を支配的リスク単位へ分割する — C:\repo\spreadjs\doc\plan\phase1-dd-roadmap.md:120-120
  **重要度: 高。** DD-011はsequencer/protocol、cell-level OCC、snapshot+log永続化、ローカルUndoという独立検証可能な高リスク領域を同時に含み、§2.2の「一つの利用者成果＋一つの支配的リスク」および複数状態所有者を分割シグナルとする規則に反しています。少なくとも同期・競合経路と永続化／復旧経路、保存成果に不要なUndoを分け、各DDの支配的リスクとACを一つに絞ってください。

- [P2] DD-014をDD-011完了後へ依存させる — C:\repo\spreadjs\doc\plan\phase1-dd-roadmap.md:135-135
  **重要度: 中。** DD-014の範囲にはSetCells原子的適用と共同編集時の競合判定が含まれますが、それらのサーバー経路とcell-level OCCはDD-011で導入されるため、DD-010だけを前提にDD-011と並行すると対象経路を統合検証できません。ローカルClipboardだけを別DDへ切り出すか、現在の範囲のままならDD-011完了を依存条件にしてください。

- [P2] 競合を扱うDD-014をRisk Class Aにする — C:\repo\spreadjs\doc\plan\phase1-dd-roadmap.md:123-123
  **重要度: 中。** DD-014は複数セルの原子的適用と競合判定を変更し、部分適用やサイレント上書きの危険を扱うため、§2.1の「OCCを変更する」「データ消失やサイレント上書きの可能性がある」というAトリガーに該当します。既存OCCを一切変更しないことを範囲・ACで保証しない限り、Risk ClassをAへ修正してください。

- [P2] 既知制約の放置期限を表へ追加する — C:\repo\spreadjs\doc\plan\phase1-dd-roadmap.md:142-144
  **重要度: 中。** 第3回レビュー §4.3と本文自身は各制約に「放置期限」を付けるとしていますが、表には影響・解消予定DD・製品制約しかなく、特に任意のDD-015/016へ送られた制約をいつまでに解消または再判定するか不明です。Stage 1判定前、Stage 2開始前などの期限列を追加し、延期時の判定責任も明示してください。

- [P2] 単独開発見積の参照節を§25.4へ直す — C:\repo\spreadjs\doc\plan\phase1-dd-roadmap.md:158-158
  **重要度: 中。** 「単独開発で社内MVP 18〜30か月」は計画書 §25.4の記述であり、§1.3には存在しません。また原文の名称は単なるMVPではなく「社内MVP」です。正典の誤引用になるため、参照を§25.4へ変更し、引用語も原文に合わせてください。