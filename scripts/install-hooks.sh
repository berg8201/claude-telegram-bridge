#!/usr/bin/env bash
set -euo pipefail

git config core.hooksPath .githooks
chmod +x .githooks/post-push scripts/telegram-push-notify.sh
echo "Installed git hooks path: .githooks"

