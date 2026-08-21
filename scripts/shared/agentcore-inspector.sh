#!/usr/bin/env bash

set -e

PROJECT_DIR="$(dirname "${BASH_SOURCE[0]}")/.."

# The credentials check reports the refresh script's path relative to the
# current directory, so it has to run before we cd
${PROJECT_DIR}/../../scripts/check-dev-aws-credentials.sh

cd "$PROJECT_DIR"

exec uv run agentcore-inspector "$@"
