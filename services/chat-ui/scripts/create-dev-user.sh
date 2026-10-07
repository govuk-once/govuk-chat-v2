#!/usr/bin/env bash

# Creates a user you can sign in to the Chat UI with, in your dev
# ChatApiTsStack user pool. Safe to re-run: an existing user is left alone.

set -euo pipefail

if [ $# -gt 1 ]; then
  echo "Usage: $0 [username]" >&2
  exit 1
fi

USERNAME="${1:-$USER}"
PROJECT_DIR="$(dirname "${BASH_SOURCE[0]}")/.."

"$PROJECT_DIR/../../scripts/check-dev-aws-credentials.sh" --quiet

USER_POOL_ID=$("$PROJECT_DIR/scripts/fetch-cdk-output.sh" --skip-credentials \
  ChatApiTsStack UserPoolId)

if lookup_error=$(aws cognito-idp admin-get-user \
  --user-pool-id "$USER_POOL_ID" --username "$USERNAME" 2>&1 >/dev/null); then
  echo "User '$USERNAME' already exists in $USER_POOL_ID"
  exit 0
elif [[ "$lookup_error" != *UserNotFoundException* ]]; then
  echo "$lookup_error" >&2
  exit 1
fi

echo "Choose a password of at least 8 characters, with upper and lower case"
echo "letters, a number and a symbol."

# Read from the terminal so the password never lands in shell history or env
# vars.
read -rsp "Password for '$USERNAME': " password
echo
read -rsp "Confirm password: " confirmation
echo

if [ "$password" != "$confirmation" ]; then
  echo "Passwords do not match" >&2
  exit 1
fi

aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --message-action SUPPRESS >/dev/null

# The password goes in a file readable only by you, rather than a --password
# argument, which other processes could see. The CLI can't read it from a
# pipe. Permanent skips the forced password change on first sign-in.
input_file=$(mktemp)
trap 'rm -f "$input_file"' EXIT
jq -n --arg pool "$USER_POOL_ID" --arg user "$USERNAME" --arg pass "$password" \
  '{UserPoolId: $pool, Username: $user, Password: $pass, Permanent: true}' \
  > "$input_file"

# Without a password the user can't sign in, and a re-run would skip them as
# existing, so undo the creation (e.g. if the password breaks the policy).
if ! aws cognito-idp admin-set-user-password \
  --cli-input-json "file://$input_file"; then
  aws cognito-idp admin-delete-user \
    --user-pool-id "$USER_POOL_ID" --username "$USERNAME"
  exit 1
fi

echo "Created user '$USERNAME' in $USER_POOL_ID"
