#!/usr/bin/env bash

# Script for running the dev checks one runs before pushing up a PR. It
# doesn't run the tests, as they all need a deployed environment.

set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "== Linting =="
scripts/lint.sh
echo "== Formatting =="
scripts/format.sh
echo "== Type checking =="
scripts/type-check.sh
