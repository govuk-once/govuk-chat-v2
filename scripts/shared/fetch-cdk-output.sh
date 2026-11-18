#!/usr/bin/env bash
set -eo pipefail

CHECK_CREDENTIALS=true
POSITIONAL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-credentials) CHECK_CREDENTIALS=false ;;
    --*) echo "Unknown flag: $1" >&2; exit 1 ;;
    *) POSITIONAL+=("$1") ;;
  esac
  shift
done

if [ -z "${POSITIONAL[0]}" ] || [ -z "${POSITIONAL[1]}" ]; then
  echo "Usage: $0 [--skip-credentials] <stack_name> <output_name>" >&2
  exit 1
fi

STACK_NAME="${POSITIONAL[0]}"
OUTPUT_NAME="${POSITIONAL[1]}"

PROJECT_DIR="$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$PROJECT_DIR/../.."

if [ "$CHECK_CREDENTIALS" = true ];  then
  "$REPO_ROOT/scripts/check-dev-aws-credentials.sh" --quiet
fi

# Find the stack by the tags CDK gives it (see
# cdk/src/constants/environment.ts). Running `cdk ls` instead would synthesise
# the whole app, which is slow and needs a GITHUB_TOKEN.
STACK_TAGS=$(node "$REPO_ROOT/cdk/bin/print-environment-tags.ts")
IFS=$'\t' read -r ENVIRONMENT_NAME SERVICE_NAME <<< "$STACK_TAGS"

STACK=$(aws cloudformation describe-stacks --output json | jq -c \
  --arg environment "$ENVIRONMENT_NAME" \
  --arg service "$SERVICE_NAME" \
  --arg suffix "-$STACK_NAME" '
  def has_tag($key; $value):
    any(.Tags[]?; .Key == $key and .Value == $value);
  first(
    .Stacks[]
    | select(has_tag("Environment"; $environment))
    | select(has_tag("ServiceName"; $service))
    | select(.StackName | endswith($suffix))
  ) // empty')

if [ -z "$STACK" ]; then
  echo "'$STACK_NAME' stack not found for environment '$ENVIRONMENT_NAME'" >&2
  exit 1
fi

OUTPUT_VALUE=$(jq -r --arg output "$OUTPUT_NAME" \
  '.Outputs[]? | select(.OutputKey == $output) | .OutputValue' <<< "$STACK")

if [ -z "$OUTPUT_VALUE" ]; then
  echo "No output found with key '$OUTPUT_NAME'" >&2
  exit 1
fi

echo "$OUTPUT_VALUE"
