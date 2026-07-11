#!/usr/bin/env bash
# =============================================================================
# post-bash-dd-archive-reminder.sh — DD アーカイブ後の INDEX 更新リマインダー
#
# PostToolUse hook for Bash.
# Detects mv commands targeting the archive folder with DD files and reminds
# to update INDEX. Non-blocking (always exits 0).
# アーカイブ先は .dd-config の ARCHIVE_DIR を参照（無ければ archive/・archived/ を検出）。
# =============================================================================

INPUT=$(cat)

COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"\(.*\)"/\1/')

# プロジェクトルート（想定配置: {ルート}/.claude/hooks/ または {ルート}/.agents/hooks/）の
# .dd-config から ARCHIVE_DIR を読み、検出パターンに加える。失敗しても既定パターンで動く。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || SCRIPT_DIR=""

# .dd-config を安全に読む（source しない = 設定ファイル内の任意コード実行を防止）。
# KEY="value" / KEY=value 形式の行から、パスとして妥当な文字だけを1件抽出する。
dd_config_get() {  # dd_config_get KEY FILE
    [ -f "$2" ] || return 0
    sed -n "s|^[[:space:]]*${1}[[:space:]]*=[[:space:]]*\"\{0,1\}\([A-Za-z0-9 ._:/~-]*\)\"\{0,1\}[[:space:]]*\$|\1|p" "$2" 2>/dev/null | head -1
}

ARCHIVE_PAT="archived?/"
if [ -n "$SCRIPT_DIR" ]; then
    ARCHIVE_DIR="$(dd_config_get ARCHIVE_DIR "$SCRIPT_DIR/../../.dd-config")"
    if [ -n "$ARCHIVE_DIR" ]; then
        # 正規表現メタ文字を最低限エスケープしてパターンに合流
        _esc=$(printf '%s' "${ARCHIVE_DIR%/}" | sed 's/[].[^$*\\]/\\&/g')
        ARCHIVE_PAT="($_esc/|archived?/)"
    fi
fi

# .md ファイルの移動のみに反応（フォルダ移動での二重発火を防止）
if echo "$COMMAND" | grep -qE "mv.*DD-.*\.md.*$ARCHIVE_PAT"; then
    echo "[Hook] DD をアーカイブしました。DD-INDEX.md を更新してください。" >&2
    echo "  -> スクリプト: bash scripts/dd-index-gen.sh" >&2
    echo "  -> または: /dd rebuild-index" >&2
fi

exit 0
