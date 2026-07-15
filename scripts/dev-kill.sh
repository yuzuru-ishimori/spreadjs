#!/bin/bash
# dev-start.sh が使うポートのプロセスを kill
#   5885 (Vite playground) / 5886 (Vite showcase) / 9499 (server-hono)
# ポートは標準 +712（他プロジェクトと重複させないため）
#
# 使い方:
#   bash scripts/dev-kill.sh            # 全ポート kill
#   bash scripts/dev-kill.sh --server   # server-hono (9499) のみ kill
#                                       # （showcase デモ「保存と復元」「切断・再接続」の手順で使う）

kill_port() {
  local port=$1
  local pids=$(netstat -ano 2>/dev/null | grep ":${port} " | grep LISTENING | awk '{print $5}' | sort -u)

  if [ -z "$pids" ]; then
    echo "  port ${port}: no process found"
    return
  fi

  for pid in $pids; do
    if [ "$pid" != "0" ]; then
      taskkill //F //PID "$pid" > /dev/null 2>&1 && \
        echo "  port ${port}: killed PID ${pid}" || \
        echo "  port ${port}: failed to kill PID ${pid}"
    fi
  done
}

if [ "$1" = "--server" ]; then
  echo "Killing server-hono only..."
  kill_port 9499
else
  echo "Killing dev servers..."
  kill_port 5885
  kill_port 5886
  kill_port 9499
fi
echo "Done."
