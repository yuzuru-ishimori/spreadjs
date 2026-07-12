#!/bin/bash
# playground (Vite) + collaboration-server (Hono + ws) を同時起動
# ポートは標準 +712（他プロジェクトと重複させないため）:
#   Vite 5173 -> 5885 / collaboration-server 8787 -> 9499
# 停止: Ctrl+C または scripts/dev-kill.sh
# 統合PoCシード付きで起動する場合: bash scripts/dev-start.sh --integration

cd "$(dirname "$0")/.."

VITE_PORT=5885   # 5173 + 712
WS_PORT=9499     # 8787 + 712

SERVER_SCRIPT="dev"
if [ "$1" = "--integration" ]; then
  SERVER_SCRIPT="dev:integration"
fi

echo "Starting collaboration-server (${SERVER_SCRIPT}) on :${WS_PORT} ..."
PORT=${WS_PORT} npm run "${SERVER_SCRIPT}" --workspace apps/collaboration-server &

# --strictPort: ポートが塞がっていたら別ポートへ逃げずに失敗させる
# （案内 URL と実ポートがずれるのを防ぐ。塞がっていたら先に dev-kill.sh を実行）
echo "Starting playground (Vite) on :${VITE_PORT} ..."
npm run dev --workspace apps/playground -- --port "${VITE_PORT}" --strictPort &

echo ""
echo "=== dev servers started ==="
echo "  playground:            http://localhost:${VITE_PORT}/"
echo "  統合PoC:               http://localhost:${VITE_PORT}/poc-integration.html?server=http://127.0.0.1:${WS_PORT}"
echo "  collaboration-server:  http://127.0.0.1:${WS_PORT}  (WS: ws://127.0.0.1:${WS_PORT}/ws)"
echo "  Kill all: bash scripts/dev-kill.sh"
echo ""

wait
