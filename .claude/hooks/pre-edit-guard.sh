#!/usr/bin/env bash
# =============================================================================
# pre-edit-guard.sh — ガードレール構成ファイル・重要ファイルの編集をブロック
#
# PreToolUse hook for Edit|Write.
# 保護対象:
#   1. ガードレール一式（エージェント設定/フック本体）— LLM が自分のガードを
#      無効化できないようにする。Claude Code / Codex / .agents の3系統を含む。
#   2. シークレット（.env 系）
#   3. 自動生成ファイル（DD-INDEX.md）
#
# パスは判定前に正規化する: バックスラッシュ→スラッシュ、重複スラッシュ・冗長な
# ./.. の畳み込み（realpath -m）、小文字化。NTFS はケースインセンシティブなので
# .CLAUDE/... 等の表記ゆれや、実 JSON でエスケープされたバックスラッシュ（\\）を
# 使ったバイパスを塞ぐ。パターンはすべて小文字で書くこと。
#
# 既知の残存リスク（文字列マッチの限界。README のセキュリティ節にも記載）:
#   - シンボリックリンク経由の別名は防げない。
#   - file_path を抽出できない場合はフェイルオープン（通す）。過剰ブロックによる
#     ロックアウトを避けるための設計上のトレードオフ。
# =============================================================================

INPUT=$(cat)

# --- file_path 抽出（jq があれば優先、無ければ grep/sed フォールバック） ---
FILE_PATH=""
if command -v jq >/dev/null 2>&1; then
    FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
fi
if [ -z "$FILE_PATH" ]; then
    FILE_PATH=$(printf '%s' "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"\(.*\)"/\1/')
fi

if [ -z "$FILE_PATH" ]; then
    # パスを特定できないときは判定不能 → 通す（フェイルオープン。上記の残存リスク参照）
    exit 0
fi

# --- 正規化 ---
FILE_PATH="${FILE_PATH//\\//}"                                  # バックスラッシュ→スラッシュ
FILE_PATH=$(printf '%s' "$FILE_PATH" | tr -s '/')              # 重複スラッシュを1つに（realpath非依存の保険）
FILE_PATH=$(realpath -m "$FILE_PATH" 2>/dev/null || printf '%s' "$FILE_PATH")  # ./.. を畳み込み（失敗時は素通し）
DISPLAY_NAME="${FILE_PATH##*/}"                                 # 表示用（元の大小を維持）
FILE_PATH=$(printf '%s' "$FILE_PATH" | tr '[:upper:]' '[:lower:]')  # 判定は小文字で行う

# --- 1. ガードレール一式（自分と仲間を守る） ---
case "$FILE_PATH" in
    *.claude/settings.json|*.claude/settings.local.json|\
    *.claude/hooks/*|\
    *.codex/hooks.json|*.codex/hooks/*|\
    *.agents/hooks/*|\
    *.dd-config)
        echo "BLOCKED: ガードレール構成ファイル ($DISPLAY_NAME) の編集は禁止されています。" >&2
        echo "  理由: フック/設定の改竄防止（LLM 自身がガードを無効化しないため）" >&2
        exit 2
        ;;
esac

# --- 2. シークレット ---
case "$FILE_PATH" in
    *.env|*.env.local|*.env.production)
        echo "BLOCKED: 環境変数ファイル ($DISPLAY_NAME) の編集は禁止されています。" >&2
        echo "  理由: シークレット保護" >&2
        exit 2
        ;;
esac

# --- 3. 自動生成 DD-INDEX（小文字化済みなので dd-index.md で判定） ---
case "$FILE_PATH" in
    *dd-index.md)
        echo "BLOCKED: DD-INDEX.md は自動生成ファイルです。手動編集禁止。" >&2
        echo "  更新: bash scripts/dd-index-gen.sh または /dd rebuild-index" >&2
        exit 2
        ;;
esac

# --- Add project-specific rules below（パターンは小文字で書くこと） ---
# Example: block linter config edits
# case "$FILE_PATH" in
#     *eslint.config.js|*.prettierrc*|*biome.json)
#         echo "BLOCKED: リンター設定 ($DISPLAY_NAME) の編集は禁止されています。" >&2
#         exit 2
#         ;;
# esac

exit 0
