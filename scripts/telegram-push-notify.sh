#!/usr/bin/env bash
set -euo pipefail

REMOTE_NAME="${1:-origin}"
REMOTE_URL="${2:-unknown}"
BRIDGE_HOME="${BRIDGE_HOME:-$HOME/.config/bridge}"
LOG_FILE="$BRIDGE_HOME/push-hook.log"
STATE_FILE="$BRIDGE_HOME/push-notify-state.tsv"
DEDUP_TTL_SECONDS="${DEDUP_TTL_SECONDS:-60}"

log_msg() {
  local msg="$1"
  mkdir -p "$BRIDGE_HOME" 2>/dev/null || true
  if ! echo "$(date -Is) ${msg}" >>"$LOG_FILE" 2>/dev/null; then
    echo "$(date -Is) ${msg}" >>"/tmp/bridge-push-hook.log" 2>/dev/null || true
  fi
}

state_write() {
  local key="$1"
  local now="$2"
  mkdir -p "$BRIDGE_HOME" 2>/dev/null || true
  local target="$STATE_FILE"
  if ! { [ -e "$target" ] || touch "$target"; } 2>/dev/null; then
    target="/tmp/bridge-push-notify-state.tsv"
    touch "$target" 2>/dev/null || true
  fi

  local tmp
  tmp="$(mktemp)"
  awk -F'\t' -v now="$now" -v ttl="$DEDUP_TTL_SECONDS" '{
    if (NF >= 2 && (now - $2) <= ttl) print $0
  }' "$target" >"$tmp" 2>/dev/null || true
  printf "%s\t%s\n" "$key" "$now" >>"$tmp"
  mv "$tmp" "$target" 2>/dev/null || true
}

state_seen_recently() {
  local key="$1"
  local now="$2"
  local target="$STATE_FILE"
  [ -f "$target" ] || target="/tmp/bridge-push-notify-state.tsv"
  [ -f "$target" ] || return 1
  awk -F'\t' -v k="$key" -v now="$now" -v ttl="$DEDUP_TTL_SECONDS" '
    $1 == k && (now - $2) <= ttl { found=1 }
    END { exit(found ? 0 : 1) }
  ' "$target"
}

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
  log_msg "[bridge-hook] curl saknas, skippar Telegram-notis"
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
LAST_COMMIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown-sha)"
DEDUP_KEY="${DEDUP_KEY:-${REPO_ROOT}|${REMOTE_NAME}|${BRANCH}|${LAST_COMMIT_SHA}}"
NOW_EPOCH="$(date +%s)"

if state_seen_recently "$DEDUP_KEY" "$NOW_EPOCH"; then
  log_msg "[bridge-hook] Duplicate notification skipped (key=${DEDUP_KEY})"
  exit 0
fi

TEXT="✅ Git push klar
Repo: ${REPO_NAME}
Branch: ${BRANCH}
Remote: ${REMOTE_NAME}
URL: ${REMOTE_URL}
Host: ${USER_NAME}@${HOST_NAME}
Commit: ${LAST_COMMIT}
Refs:${UPDATES}"

if ! RESPONSE="$(curl -sS --max-time 10 \
  -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d "chat_id=${CHAT_ID}" \
  --data-urlencode "text=${TEXT}" \
)"; then
  log_msg "[bridge-hook] Telegram send failed (remote=${REMOTE_NAME}, branch=${BRANCH})"
  exit 0
fi

if ! printf "%s" "$RESPONSE" | grep -q '"ok":true'; then
  log_msg "[bridge-hook] Telegram API returned non-ok (remote=${REMOTE_NAME}, branch=${BRANCH})"
  exit 0
fi

state_write "$DEDUP_KEY" "$NOW_EPOCH"
