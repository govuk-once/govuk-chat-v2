#!/usr/bin/env bash
set -e

# Runs every cloud test against a deployed environment. Takes the same
# arguments as test-api.sh.

"$(dirname "${BASH_SOURCE[0]}")/test-api.sh" "$@"
