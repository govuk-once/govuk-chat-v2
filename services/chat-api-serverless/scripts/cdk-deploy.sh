#!/usr/bin/env bash

set -e

./../../common/scripts/check-dev-aws-credentials.sh

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

cd ../../cdk

cdk deploy ChatApiServerlessStack "$@"
