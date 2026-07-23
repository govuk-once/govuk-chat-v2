#!/usr/bin/env bash

# Script for running the dev checks one runs before pushing up a PR

set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "== Linting =="
scripts/lint.sh
echo "== Formatting =="
scripts/format.sh
echo "== Type checking =="
scripts/type-check.sh
