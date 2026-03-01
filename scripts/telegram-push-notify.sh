#!/usr/bin/env bash
set -euo pipefail

REMOTE_NAME="${1:-origin}"
REMOTE_URL="${2:-unknown}"
BRIDGE_HOME="${BRIDGE_HOME:-$HOME/.config/bridge}"

load_env_file() {
  local file="$1"
  [ -f "$file" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    [[ "$line" =~ ^# ]] && continue
    [[ "$line" == *"="* ]] || continue
    local key="${line%%=*}"
    local value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    if [ -z "${!key:-}" ]; then
      export "$key=$value"
    fi
  done <"$file"
}

# Priority: process env > global bridge env > local env
load_env_file "$BRIDGE_HOME/.env"
load_env_file ".env"

BOT_TOKEN="${BOT_TOKEN:-}"
CHAT_ID="${CHAT_ID:-}"

if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[bridge-hook] curl saknas, skippar Telegram-notis" >&2
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
REPO_NAME="$(basename "$REPO_ROOT")"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
USER_NAME="${USER:-unknown}"
HOST_NAME="$(hostname 2>/dev/null || echo unknown-host)"

UPDATES=""
while read -r local_ref local_sha remote_ref remote_sha; do
  [ -n "${local_ref:-}" ] || continue
  short_sha="${local_sha:0:8}"
  if [ "$local_ref" = "(delete)" ]; then
    UPDATES="${UPDATES}\n- deleted ${remote_ref}"
  elif [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
    UPDATES="${UPDATES}\n- new ${local_ref} -> ${remote_ref} (${short_sha})"
  else
    UPDATES="${UPDATES}\n- ${local_ref} -> ${remote_ref} (${short_sha})"
  fi
done

if [ -z "$UPDATES" ]; then
  UPDATES="\n- (ingen ref-detalj från git)"
fi

LAST_COMMIT="$(git log -1 --pretty='%h %s' 2>/dev/null || echo 'unknown commit')"

TEXT="✅ Git push klar
Repo: ${REPO_NAME}
Branch: ${BRANCH}
Remote: ${REMOTE_NAME}
URL: ${REMOTE_URL}
Host: ${USER_NAME}@${HOST_NAME}
Commit: ${LAST_COMMIT}
Refs:${UPDATES}"

curl -sS --max-time 10 \
  -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d "chat_id=${CHAT_ID}" \
  --data-urlencode "text=${TEXT}" \
  >/dev/null || true

