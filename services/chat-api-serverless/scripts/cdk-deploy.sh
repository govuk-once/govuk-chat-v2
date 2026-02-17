#!/usr/bin/env bash

set -e

cd "$(dirname "${BASH_SOURCE[0]}")/../../../cdk" || exit 1

cdk deploy ChatApiServerlessStack "$@"
