#!/bin/sh
# Launcher installed as /usr/bin/chatgpt-linux.
# Runs the app on the system Electron so we never ship a second Chromium.
set -eu

APP_DIR="${CHATGPT_LINUX_APP_DIR:-/usr/lib/chatgpt-linux}"

for bin in electron43 electron42 electron; do
  if command -v "$bin" >/dev/null 2>&1; then
    exec "$bin" "$APP_DIR" "$@"
  fi
done

echo "chatgpt-linux: no Electron runtime found — install the 'electron43' package" >&2
exit 1
