#!/usr/bin/env bash
# LumenLink VPS Deployment Script
#
# Usage: ./infra/deploy.sh [user@host]
#
# Prerequisites on target:
#   - Node.js 22+
#   - pnpm
#   - Redis (optional, for signal queue)
#
# This script:
#   1. Creates lumenlink user (if needed)
#   2. Syncs code
#   3. Installs dependencies
#   4. Builds
#   5. Installs systemd service
#   6. Restarts

set -euo pipefail

TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  echo "Usage: ./infra/deploy.sh user@host"
  echo ""
  echo "First-time setup on a fresh VPS:"
  echo "  1. SSH into VPS"
  echo "  2. Install Node.js 22: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
  echo "  3. Install pnpm: corepack enable && corepack prepare pnpm@9 --activate"
  echo "  4. Install Redis: sudo apt install -y redis-server"
  echo "  5. Create user: sudo useradd -r -m -s /bin/bash lumenlink"
  echo "  6. Create dirs: sudo mkdir -p /opt/lumenlink/data && sudo chown -R lumenlink:lumenlink /opt/lumenlink"
  echo "  7. Sync NTP: sudo timedatectl set-ntp true"
  echo "  8. Run this script: ./infra/deploy.sh user@host"
  exit 1
fi

echo "🚀 Deploying LumenLink to $TARGET..."

# Sync code (exclude node_modules, data, .env)
echo "📦 Syncing code..."
rsync -avz --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .env \
  --exclude runtime.sqlite* \
  --exclude backtest-results \
  --exclude .git \
  ./ "$TARGET:/opt/lumenlink/"

# Remote build + restart
echo "🔧 Building on remote..."
ssh "$TARGET" bash -s << 'REMOTE'
  set -euo pipefail
  cd /opt/lumenlink

  # Install deps
  pnpm install --frozen-lockfile

  # Build
  pnpm run build

  # Install systemd service (if not exists or changed)
  if ! diff -q infra/lumenlink.service /etc/systemd/system/lumenlink.service &>/dev/null 2>&1; then
    sudo cp infra/lumenlink.service /etc/systemd/system/lumenlink.service
    sudo systemctl daemon-reload
    sudo systemctl enable lumenlink
    echo "✅ Systemd service updated"
  fi

  # Ensure NTP is enabled
  if ! timedatectl show | grep -q 'NTP=yes'; then
    sudo timedatectl set-ntp true
    echo "✅ NTP enabled"
  fi

  # Restart
  sudo systemctl restart lumenlink
  sleep 2

  # Health check
  if curl -sf http://localhost:8080/health > /dev/null; then
    echo "✅ LumenLink is healthy"
  else
    echo "❌ Health check failed!"
    sudo journalctl -u lumenlink --no-pager -n 20
    exit 1
  fi
REMOTE

echo "✅ Deployment complete!"
echo "   View logs: ssh $TARGET 'journalctl -u lumenlink -f'"
echo "   Status:    ssh $TARGET 'curl -s localhost:8080/status | jq'"
echo "   Dashboard: ssh $TARGET 'curl -s localhost:8080/dashboard | jq'"
