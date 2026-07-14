必須条件S1-6の再現build証拠がdirty worktree由来で再生成不能であり、公開永続化経路の文書ID誤公開リスクも非ブロッカーへ誤分類されています。この状態では「不合格0・Alpha宣言可」という総合判定は証拠に対して過大です。

Full review comments:

- [P1] Re-run S1-6 from a clean, traceable commit — C:\repo\spreadjs\doc\DD\DD-018\stage1-gate-checklist.md:24-24
  S1-6 の再現 build 証拠に使う `release-manifest.json` は `gitDirty: true` で、記録された commit `5eb89b6` では package 版がまだ `0.0.0` かつ `build-release.sh` 自体も存在しません。したがって記録された commit から manifest の `0.1.0-alpha.0` tarball を再生成できず、実質3要件の「再現 build」は現証拠では未充足です。clean commit から成果物と manifest を再取得するまでは S1-6 を合格にできません。

- [P1] Do not defer document-ID validation behind trust boundary — C:\repo\spreadjs\doc\DD\DD-018\stage1-gate-checklist.md:76-76
  公開 `ServeOptions` は `documentId` と `persistenceDir` の両方を受け付けるため、文書Aで使用済みのディレクトリを `serve({documentId: 'B', persistenceDir: dirA})` で再利用すると、現在の recovery は persisted documentId を照合せずAの内容をBとして公開します。これは悪意ある入力ではなく通常の内部設定ミスで発生し、`trusted internal` 境界では防げません。データ誤公開を伴う公開Facadeの既知不具合なので、K7を単なる延期扱いにせず不合格として DD-018-1 で fail-fast 対応する必要があります。

- [P2] Validate S1-3 outside the repository — C:\repo\spreadjs\doc\DD\DD-018\stage1-gate-checklist.md:21-21
  この根拠は consumer を「monorepo外」としていますが、実際の `consumer-app` はリポジトリ直下にあり、`scripts/consumer-app.sh` は `$REPO_ROOT/consumer-app` を固定使用し、tsc/vite/tsx/Playwright もルート `node_modules` から実行します。証拠が示すのは workspace非登録・SDK source非参照までで、リポジトリ外の自己完結consumerで成立することではありません。monorepo外統合を合格根拠にするなら外部ディレクトリで依存を宣言して再実証するか、判定根拠を実態に合わせて修正してください。

- [P2] Replace nonexistent evidence references — C:\repo\spreadjs\doc\DD\DD-018\stage1-gate-checklist.md:20-20
  「証拠パス実在確認済み」とする監査表に、存在しない `doc/adr/0015-...md` が複数あり、CG-2 もアーカイブ済みなのに `doc/DD/DD-010/{replay-evidence.md,perf-report.md}` を参照しています。実体は完全なADRファイル名と `doc/archived/DD/DD-010/` 配下なので、現状ではチェックリストから証拠を機械的に追跡できません。