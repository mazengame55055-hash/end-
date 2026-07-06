#!/bin/bash
set -e
echo "=== Upgrading Node.js to v22 ==="
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>/dev/null || true
apt-get install -y nodejs 2>/dev/null || true
echo "Node version: $(node -v)"
echo "=== Installing dependencies ==="
cd /content/end-
npm install
echo "=== Done ==="
