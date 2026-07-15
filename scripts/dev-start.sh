#!/bin/bash
# playground / showcase (Vite) + server-hono (Hono + ws) を同時起動
# ポートは標準 +712（他プロジェクトと重複させないため）:
#   Vite 5173 -> 5885 (playground) / 5174 -> 5886 (showcase) / server-hono 8787 -> 9499
# 停止: Ctrl+C または scripts/dev-kill.sh
#
# 使い方:
#   bash scripts/dev-start.sh                 # playground + server（小規模シード）
#   bash scripts/dev-start.sh --integration   # playground + server（統合PoCシード 50,000行）
#   bash scripts/dev-start.sh --showcase      # 紹介サイト showcase + server（50,000行シード＋ファイル永続化）
#   bash scripts/dev-start.sh --showcase --server-only  # server のみ再起動（デモ「保存と復元」「切断・再接続」用）

cd "$(dirname "$0")/.."

VITE_PORT=5885      # 5173 + 712
SHOWCASE_PORT=5886  # 5174 + 712
WS_PORT=9499        # 8787 + 712

SERVER_SCRIPT="dev"
APP="playground"
SERVER_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --integration) SERVER_SCRIPT="dev:integration" ;;
    --showcase)    SERVER_SCRIPT="dev:integration"; APP="showcase" ;;
    --server-only) SERVER_ONLY=1 ;;
    *) echo "unknown option: $arg (usage: dev-start.sh [--integration|--showcase] [--server-only])"; exit 1 ;;
  esac
done

# showcase は「保存と復元」デモのためファイル永続化を有効化する（DD-017-2）。
# シードは fresh 時のみ投入（DD-014/DD-018-1）＝再起動では永続化データから復旧する。
# デモデータをリセットしたい場合: rm -rf .dev-persistence/showcase
SERVER_ENV=()
if [ "$APP" = "showcase" ]; then
  SERVER_ENV=("PERSISTENCE_DIR=$(pwd)/.dev-persistence/showcase")
fi

echo "Starting server-hono (${SERVER_SCRIPT}) on :${WS_PORT} ..."
env "PORT=${WS_PORT}" "${SERVER_ENV[@]}" npm run "${SERVER_SCRIPT}" --workspace @nanairo-sheet/server-hono &

# --strictPort: ポートが塞がっていたら別ポートへ逃げずに失敗させる
# （案内 URL と実ポートがずれるのを防ぐ。塞がっていたら先に dev-kill.sh を実行）
if [ "$SERVER_ONLY" -eq 0 ]; then
  if [ "$APP" = "showcase" ]; then
    echo "Starting showcase (Vite) on :${SHOWCASE_PORT} ..."
    npm run dev --workspace apps/showcase -- --port "${SHOWCASE_PORT}" --strictPort &
  else
    echo "Starting playground (Vite) on :${VITE_PORT} ..."
    npm run dev --workspace apps/playground -- --port "${VITE_PORT}" --strictPort &
  fi
fi

echo ""
echo "=== dev servers started ==="
if [ "$SERVER_ONLY" -eq 1 ]; then
  echo "  (server のみ起動)"
elif [ "$APP" = "showcase" ]; then
  echo "  紹介サイト（機能カタログ）: http://localhost:${SHOWCASE_PORT}/"
  echo "  動作デモ:                  http://localhost:${SHOWCASE_PORT}/demo.html"
else
  echo "  playground:            http://localhost:${VITE_PORT}/"
  echo "  統合PoC:               http://localhost:${VITE_PORT}/poc-integration.html?server=http://127.0.0.1:${WS_PORT}"
fi
echo "  server-hono:  http://127.0.0.1:${WS_PORT}  (WS: ws://127.0.0.1:${WS_PORT}/ws)"
echo "  Kill all: bash scripts/dev-kill.sh   (server のみ: bash scripts/dev-kill.sh --server)"
echo ""

wait
