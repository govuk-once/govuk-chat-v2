#!/usr/bin/env bash
set -e

# Destroys every stack for the environment named by ENVIRONMENT, or your own
# $USER stacks by default, succeeding if it has none. Pass --skip-credentials
# where AWS credentials come from somewhere other than the GDS CLI, such as
# CI. Other arguments are passed to cdk destroy.

CHECK_CREDENTIALS=true
CDK_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --skip-credentials) CHECK_CREDENTIALS=false ;;
    *) CDK_ARGS+=("$arg") ;;
  esac
done

SCRIPTS_DIR="$(dirname "${BASH_SOURCE[0]}")"

if [ "$CHECK_CREDENTIALS" = true ]; then
  "$SCRIPTS_DIR/../../scripts/check-dev-aws-credentials.sh" --quiet
fi

STACKS="$("$SCRIPTS_DIR/list-environment-stacks.sh" --skip-credentials)"

if [ -z "$STACKS" ]; then
  echo "No stacks found for environment ${ENVIRONMENT:-$USER}, nothing to destroy"
  exit 0
fi

# A deploy cancelled by closing the PR can leave a stack still updating
"$SCRIPTS_DIR/wait-for-environment-stacks.sh" --skip-credentials

cd "$SCRIPTS_DIR/../../cdk"

pnpm exec cdk destroy --all --force "${CDK_ARGS[@]}"
