#!/bin/bash
# dev-start.sh が使うポートのプロセスを全て kill
#   5885 (Vite playground) / 9499 (server-hono)
# ポートは標準 +712（他プロジェクトと重複させないため）

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

echo "Killing dev servers..."
kill_port 5885
kill_port 9499
echo "Done."
