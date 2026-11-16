#!/usr/bin/env bash
# Adds a cron entry that tries to sync every 3 hours. The sync skips sources that
# already synced in the last ~20 hours, so in practice it runs once a day, on the
# first attempt the computer is on.
#
# Run from the sync folder:  bash scripts/install-linux-cron.sh
# Remove:                    crontab -l | grep -v blendit-sync | crontab -
set -euo pipefail
SYNC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
LINE="0 */3 * * * cd \"$SYNC_DIR\" && \"$NODE\" src/index.mjs >> logs/cron.log 2>&1 # blendit-sync"
mkdir -p "$SYNC_DIR/logs"
( crontab -l 2>/dev/null | grep -v 'blendit-sync' || true; echo "$LINE" ) | crontab -
echo "OK: cron entry installed:"
crontab -l | grep blendit-sync
