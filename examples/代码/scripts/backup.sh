#!/usr/bin/env bash
# 备份指定目录到 tar.gz，并只保留最近 N 份
set -euo pipefail

SRC="${1:?用法: $0 <源目录> [备份目录] [保留份数]}"
DEST="${2:-$HOME/backups}"
KEEP="${3:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="$(basename "$SRC")-$STAMP.tar.gz"

log() { printf '[%s] %s\n' "$(date +%T)" "$*" >&2; }

cleanup() {
  local code=$?
  [[ $code -ne 0 && -f "$DEST/$NAME" ]] && rm -f "$DEST/$NAME"
  exit "$code"
}
trap cleanup EXIT

mkdir -p "$DEST"
log "开始备份 $SRC -> $DEST/$NAME"
tar --exclude='node_modules' --exclude='.git' -czf "$DEST/$NAME" -C "$(dirname "$SRC")" "$(basename "$SRC")"

size=$(du -h "$DEST/$NAME" | cut -f1)
log "完成，大小 $size"

mapfile -t old < <(ls -1t "$DEST"/"$(basename "$SRC")"-*.tar.gz | tail -n +"$((KEEP + 1))")
if (( ${#old[@]} > 0 )); then
  log "清理 ${#old[@]} 份旧备份"
  rm -f -- "${old[@]}"
fi

case "$(uname -s)" in
  Darwin) osascript -e "display notification \"$NAME\" with title \"备份完成\"" ;;
  Linux)  command -v notify-send >/dev/null && notify-send "备份完成" "$NAME" ;;
esac
