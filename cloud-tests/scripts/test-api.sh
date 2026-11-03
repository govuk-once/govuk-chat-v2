#!/usr/bin/env bash
set -e

# Runs the API tests against the environment named by ENVIRONMENT, or your own
# $USER stacks by default. Pass --skip-credentials where AWS credentials come
# from somewhere other than the GDS CLI, such as CI. Other arguments are passed
# to vitest.

CHECK_CREDENTIALS=true
VITEST_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --skip-credentials) CHECK_CREDENTIALS=false ;;
    *) VITEST_ARGS+=("$arg") ;;
  esac
done

PROJECT_DIR="$(dirname "${BASH_SOURCE[0]}")/.."

if [ "$CHECK_CREDENTIALS" = true ]; then
  "$PROJECT_DIR/../scripts/check-dev-aws-credentials.sh" --quiet
fi

cd "$PROJECT_DIR"

# Zscaler on managed laptops re-signs the Cognito token endpoint with a root
# CA from the macOS keychain, which Node does not trust by default.
NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--use-system-ca" \
  pnpm exec vitest run "${VITEST_ARGS[@]}"
