#!/usr/bin/env bash
set -eo pipefail

# Prints the name and status, tab-separated, of each stack deployed for the
# environment named by ENVIRONMENT, or your own $USER stacks by default, one per
# line. Prints nothing if the environment has no stacks. Pass
# --skip-credentials where AWS credentials come from somewhere other than the
# GDS CLI, such as CI.

CHECK_CREDENTIALS=true

for arg in "$@"; do
  case "$arg" in
    --skip-credentials) CHECK_CREDENTIALS=false ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

REPO_ROOT="$(dirname "${BASH_SOURCE[0]}")/../.."

if [ "$CHECK_CREDENTIALS" = true ]; then
  "$REPO_ROOT/scripts/check-dev-aws-credentials.sh" --quiet
fi

# Find the stacks by the tags CDK gives them (see
# cdk/src/constants/environment.ts)
STACK_TAGS=$(node "$REPO_ROOT/cdk/bin/print-environment-tags.ts")
IFS=$'\t' read -r ENVIRONMENT_NAME SERVICE_NAME <<< "$STACK_TAGS"

aws cloudformation describe-stacks --output json | jq -r \
  --arg environment "$ENVIRONMENT_NAME" \
  --arg service "$SERVICE_NAME" '
  def has_tag($key; $value):
    any(.Tags[]?; .Key == $key and .Value == $value);
  .Stacks[]
  | select(has_tag("Environment"; $environment))
  | select(has_tag("ServiceName"; $service))
  | "\(.StackName)\t\(.StackStatus)"'
