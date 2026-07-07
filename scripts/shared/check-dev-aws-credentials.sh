#!/usr/bin/env bash
set -euo pipefail

suggestion=true
quiet=false

for arg in "$@"; do
  case "$arg" in
    --no-suggestion)
      suggestion=false
      ;;
    --quiet)
      quiet=true
      ;;
  esac
done

echo_if_verbose() {
    if ! $quiet; then
      echo "$1"
    fi
}

exit_with_optional_suggestion() {
    if $suggestion; then
        ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." &>/dev/null && pwd)"
        SCRIPT_PATH="${ROOT_DIR}/refresh-dev-aws-credentials.zsh"
        RELATIVE_PATH="$(uv run python -c "import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))" "$SCRIPT_PATH" $(pwd))"

        # we show a relative path to users as that is nicer visually, this
        # does however carry the overhead that we can't cd before calling this
        # script
        printf "%s" "AWS credentials need to be refreshed, run " \
                    "\`source ${RELATIVE_PATH}\`" >&2
        echo >&2
    fi
    exit 1
}

expected_aws_role="${AWS_ROLE:-once-chat-development-admin}"

echo_if_verbose "== Checking for AWS env vars =="

if [[ -v AWS_ACCESS_KEY_ID ]]; then
    echo_if_verbose "AWS env vars found"
else
    echo "AWS env vars are not available" >&2
    exit_with_optional_suggestion
fi

echo_if_verbose "== Checking validity of AWS credentials for role ${expected_aws_role} =="

role_details=$(gds aws "$expected_aws_role" --details 2>/dev/null) || {
    echo "ERROR: Couldn't establish AWS role: $expected_aws_role" >&2
    exit 1
}

has_expected_role() {
    local role_details="$1"
    local current_identity="$2"
    local expected_account expected_role actual_account actual_role

    expected_account=$(grep "AccountNumber" <<< "$role_details" | awk '{print $2}')
    expected_role=$(grep "RoleName" <<< "$role_details" | awk '{print $2}')

    if [[ $current_identity =~ arn:aws:sts::([0-9]+):assumed-role/([^/]+) ]]; then
        actual_account="${BASH_REMATCH[1]}"
        actual_role="${BASH_REMATCH[2]}"
    else
        echo "Couldn't match an assumed role in AWS identity: $current_identity" >&2
        echo "AWS output may have changed since this script was written. Exiting."  >&2
        exit 1
    fi

    [[ "$expected_account" == "$actual_account" && "$expected_role" == "$actual_role" ]]
}

current_identity=$(aws sts get-caller-identity 2>/dev/null || true)

if [[ -z "$current_identity" ]]; then
    echo "Existing credentials are invalid or expired." >&2
    exit_with_optional_suggestion
elif ! has_expected_role "$role_details" "$current_identity"; then
    echo "Existing credentials are for a different role." >&2
    exit_with_optional_suggestion
else
    echo_if_verbose "Existing AWS credentials are still valid. No update needed."
    exit 0
fi
