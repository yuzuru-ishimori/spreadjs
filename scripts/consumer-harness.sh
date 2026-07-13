#!/usr/bin/env bash
# 独立 consumer harness 検証（DD-011 Phase 4・AC5）。
# pack 済み Facade tarball を独立プロジェクトへ install し、公開面だけで tsc --noEmit green を確認する。
# あわせて S1-3 不合格条件（内部 package 直接 import・source path 参照・workspace link）を機械検査する。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$REPO_ROOT/consumer-harness"
VENDOR="$HARNESS/.vendor"

fail() { echo "[harness] NG: $*" >&2; exit 1; }

# ---- 0. S1-3 不合格条件の静的検査（install 前） ----
# 全 import 形式を対象にする（Codex P1）: `from 'x'`・`import 'x'`（副作用）・`import('x')`（動的）・
# `import('x').Y`（型位置）をまとめて捕捉するため、scope 付き specifier の出現自体を見る
# （内部 package 名の後は '/" いずれか＝`server-hono` の `server` 誤マッチを境界で除外）。
echo "[harness] S1-3 不合格条件（内部 import / source path 参照）を静的検査..."
if grep -rnE "@nanairo-sheet/(core|types|collab|server|formula|selection|render|ime)['\"/]" "$HARNESS/src"; then
  fail "consumer が内部パッケージを直接 import している（R1・§4.3-1 full-error。全 import 形式を検査）"
fi
# 相対 import（from/副作用/動的いずれも先頭が `.`）とリポジトリ内パス（packages//apps/）を捕捉。
if grep -rnE "(from|import)[[:space:]]*\(?[[:space:]]*['\"]\.\.?/" "$HARNESS/src"; then
  fail "consumer が相対パスで source を直接 import している"
fi
if grep -rnE "['\"][^'\"]*(packages|apps)/" "$HARNESS/src" "$HARNESS/tsconfig.json"; then
  fail "consumer が source path（リポジトリ内パス）を参照している"
fi

# ---- 1. Facade を pack（tarball 化） ----
echo "[harness] npm pack（grid・server-hono）..."
rm -rf "$VENDOR"; mkdir -p "$VENDOR"
npm pack --workspace @nanairo-sheet/grid --pack-destination "$VENDOR" >/dev/null
npm pack --workspace @nanairo-sheet/server-hono --pack-destination "$VENDOR" >/dev/null

# ---- 2. tarball を harness へ install（workspace link を使わない独立 install） ----
echo "[harness] tarball を install..."
rm -rf "$HARNESS/node_modules" "$HARNESS/package-lock.json"
(
  cd "$HARNESS"
  npm install --no-save --install-links \
    "$VENDOR"/nanairo-sheet-grid-*.tgz \
    "$VENDOR"/nanairo-sheet-server-hono-*.tgz >/dev/null
)

# ---- 3. 不合格条件: workspace link（symlink）でなく tarball 展開実体であること ----
for p in grid server-hono; do
  dir="$HARNESS/node_modules/@nanairo-sheet/$p"
  [ -e "$dir" ] || fail "$p が install されていない"
  [ -L "$dir" ] && fail "$p が symlink（workspace link）＝独立性を満たさない"
  [ -f "$dir/src/index.ts" ] || fail "$p が tarball から展開されていない（src/index.ts なし）"
done

# ---- 4. 公開面だけで tsc --noEmit（型解決は harness/node_modules から） ----
echo "[harness] tsc --noEmit..."
(
  cd "$HARNESS"
  node "$REPO_ROOT/node_modules/typescript/bin/tsc" -p tsconfig.json
)

echo "[harness] OK: pack→install→tsc --noEmit green（内部 import なし・source path 参照なし・workspace link なし）"
