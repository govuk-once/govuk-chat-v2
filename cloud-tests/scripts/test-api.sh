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

# Zscaler re-signs some AWS domains, such as Cognito's sign-in domain, with a
# CA that's in the system trust store but not in Node's own list. Without this,
# the token request fails with "unable to get local issuer certificate".
export NODE_USE_SYSTEM_CA=1

pnpm exec vitest run "${VITEST_ARGS[@]}"
