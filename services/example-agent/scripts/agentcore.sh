#!/usr/bin/env bash

# Wrapper script around the agentcore executable from
# bedrock-agentcore-starter-toolkit, checks pre-requisities
# before usage.

set -e

PROJECT_DIR="$(dirname "${BASH_SOURCE[0]}")/.."

${PROJECT_DIR}/../../common/scripts/check-dev-aws-credentials.sh

cd $PROJECT_DIR

echo "== Checking for .bedrock_agentcore.yaml =="
if [ -f "${PROJECT_DIR}/.bedrock_agentcore.yaml" ]; then
    echo ".bedrock_agentcore.yaml exists"
    echo "run scripts/generate-agentcore-config.py to regenerate"
else
    echo ".bedrock_agentcore.yaml does not exist"
    ${PROJECT_DIR}/scripts/generate-agentcore-config.py
fi

uv run agentcore "$@"
