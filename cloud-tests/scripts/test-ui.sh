#!/usr/bin/env bash
set -e

# Runs the UI tests against the environment named by ENVIRONMENT, or your own
# $USER stacks by default. Pass --skip-credentials where AWS credentials come
# from somewhere other than the GDS CLI, such as CI. Other arguments are passed
# to Playwright, such as --headed to watch the browser.

CHECK_CREDENTIALS=true
PLAYWRIGHT_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --skip-credentials) CHECK_CREDENTIALS=false ;;
    *) PLAYWRIGHT_ARGS+=("$arg") ;;
  esac
done

PROJECT_DIR="$(dirname "${BASH_SOURCE[0]}")/.."

if [ "$CHECK_CREDENTIALS" = true ]; then
  "$PROJECT_DIR/../scripts/check-dev-aws-credentials.sh" --quiet
fi

cd "$PROJECT_DIR"

# As in test-api.sh, Zscaler on managed laptops re-signs HTTPS traffic with a
# root CA from the macOS keychain, which Node does not trust by default.
NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--use-system-ca" \
  pnpm exec playwright test "${PLAYWRIGHT_ARGS[@]}"
