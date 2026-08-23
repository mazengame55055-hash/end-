#!/bin/bash
cd "$(dirname "$0")"
export PATH="$HOME/.local/node22/bin:$HOME/.local/bin:$PATH"
set -a
source ./.env
set +a
exec node index.js
