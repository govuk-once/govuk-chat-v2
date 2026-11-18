#!/usr/bin/env bash
set -e

# Deploys every stack for the environment named by ENVIRONMENT, or your own
# $USER stacks by default. Pass --skip-credentials where AWS credentials come
# from somewhere other than the GDS CLI, such as CI. Other arguments are passed
# to cdk deploy.

CHECK_CREDENTIALS=true
CDK_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --skip-credentials) CHECK_CREDENTIALS=false ;;
    *) CDK_ARGS+=("$arg") ;;
  esac
done

PROJECT_DIR="$(dirname "${BASH_SOURCE[0]}")/.."

if [ "$CHECK_CREDENTIALS" = true ]; then
  "$PROJECT_DIR/../scripts/check-dev-aws-credentials.sh" --quiet
fi

cd "$PROJECT_DIR/../cdk"

# No outputs file, as the tests read outputs from CloudFormation. Validation is
# off, as in dev-cdk-deploy.sh, because it slows deploys down.
CDK_VALIDATION=false pnpm exec cdk deploy --all --require-approval never \
  "${CDK_ARGS[@]}"
