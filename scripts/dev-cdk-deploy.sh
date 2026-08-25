#!/usr/bin/env bash

set -e

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <StackName> [args]" >&2
  exit 1
fi

SCRIPTS_DIR="$(dirname "${BASH_SOURCE[0]}")"

${SCRIPTS_DIR}/check-dev-aws-credentials.sh
${SCRIPTS_DIR}/clean-orphaned-cdk-assets.sh

cd "$SCRIPTS_DIR/../cdk"

# We turn off validation here because it can make deploys painfully slow once
# a few assets have built up in cdk.out
CDK_VALIDATION=false pnpm exec cdk deploy --outputs-file "cdk-outputs/$1.json" "$@"

