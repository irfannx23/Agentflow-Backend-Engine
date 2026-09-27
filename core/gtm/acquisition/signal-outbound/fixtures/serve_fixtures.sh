#!/usr/bin/env bash
# Serve the local fixture "company site" for offline scraper demos/tests.
# Usage: ./scripts/serve_fixtures.sh [port]
set -euo pipefail
PORT="${1:-8080}"
python3 -m http.server "$PORT" --directory "$(dirname "$0")/fixtures/site"
