#!/usr/bin/env bash

set -e

PROJECT_DIR="$(dirname "${BASH_SOURCE[0]}")/.."

${PROJECT_DIR}/../../scripts/dev-cdk-deploy.sh ExampleAgentStack "$@"
