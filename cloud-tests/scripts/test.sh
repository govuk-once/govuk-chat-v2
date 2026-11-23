#!/usr/bin/env bash
set -e

# Runs every cloud test against a deployed environment. Pass
# --skip-credentials where AWS credentials come from somewhere other than the
# GDS CLI, such as CI. The two suites use different test runners, so to pass
# arguments to a runner, run test-api.sh or test-ui.sh instead.
#
# Runs the UI tests even if the API tests fail, so one run reports on both.

for arg in "$@"; do
  if [ "$arg" != --skip-credentials ]; then
    echo "Unknown argument '$arg'; pass runner arguments to test-api.sh or test-ui.sh" >&2
    exit 1
  fi
done

SCRIPTS_DIR="$(dirname "${BASH_SOURCE[0]}")"
status=0

"$SCRIPTS_DIR/test-api.sh" "$@" || status=1
"$SCRIPTS_DIR/test-ui.sh" "$@" || status=1

exit $status
