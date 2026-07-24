#!/usr/bin/env bash
set -e

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

if [ "$CHECK_CREDENTIALS" = true ];  then
  $PROJECT_DIR/../../scripts/check-dev-aws-credentials.sh --quiet
fi

cd "$PROJECT_DIR/../../cdk"

# Convert CDK stack name to the actual Cloudformation namespaced stack name
# e.g. ExampleAgentStack -> alicesmith-govuk-chat-ExampleAgentStack
FULL_STACK_NAME=$(pnpm exec cdk ls -l --json | jq -r --arg stack "$STACK_NAME" '.[] | select(.name | endswith($stack)) | .name')

if [ -z "$FULL_STACK_NAME" ]; then
  echo "'$STACK_NAME' stack not found" >&2
  exit 1
fi

OUTPUT_VALUE=$(aws cloudformation describe-stacks \
  --stack-name "$FULL_STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='$OUTPUT_NAME'].OutputValue" \
  --output text)

if [ -z "$OUTPUT_VALUE" ]; then
  echo "No output found with key '$OUTPUT_NAME'" >&2
  exit 1
fi

echo $OUTPUT_VALUE
