#!/usr/bin/env bash
set -eo pipefail

# Waits until none of the stacks for the environment named by ENVIRONMENT, or
# your own $USER stacks by default, is mid-operation, failing after 20 minutes.
# CloudFormation carries on with an update after the cdk process running it
# stops, such as when CI cancels a run, and cdk fails rather than waits if it
# finds a stack still updating. Pass --skip-credentials where AWS credentials
# come from somewhere other than the GDS CLI, such as CI.

TIMEOUT_SECONDS=1200
POLL_INTERVAL_SECONDS=15

CHECK_CREDENTIALS=true

for arg in "$@"; do
  case "$arg" in
    --skip-credentials) CHECK_CREDENTIALS=false ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

SCRIPTS_DIR="$(dirname "${BASH_SOURCE[0]}")"

if [ "$CHECK_CREDENTIALS" = true ]; then
  "$SCRIPTS_DIR/../../scripts/check-dev-aws-credentials.sh" --quiet
fi

# REVIEW_IN_PROGRESS is excluded as it doesn't settle by itself: it's a new
# stack whose change set was never executed, which cdk can deploy over
stacks_in_progress() {
  "$SCRIPTS_DIR/list-environment-stacks.sh" --skip-credentials |
    awk -F'\t' '$2 ~ /_IN_PROGRESS$/ && $2 != "REVIEW_IN_PROGRESS"'
}

DEADLINE=$((SECONDS + TIMEOUT_SECONDS))

while true; do
  IN_PROGRESS="$(stacks_in_progress)"
  if [ -z "$IN_PROGRESS" ]; then
    exit 0
  fi
  if [ "$SECONDS" -ge "$DEADLINE" ]; then
    echo "Stacks still in progress after ${TIMEOUT_SECONDS}s:" >&2
    echo "$IN_PROGRESS" >&2
    exit 1
  fi
  echo "Waiting for stacks to finish their current operation:"
  echo "$IN_PROGRESS"
  sleep "$POLL_INTERVAL_SECONDS"
done
