#!/usr/bin/env bash
set -euo pipefail

aws_role="${1:-govuk-test-developer}"

echo "== Configuring AWS credentials for role: $aws_role =="

script_real_path="$(readlink -f "${BASH_SOURCE[0]}")"
repo_root="$(cd "$(dirname "$script_real_path")"/../.. && pwd)"
config_path="${repo_root}/.env.aws"

aws_credentials="$(gds aws "$aws_role" -e --art 8h)"
relevant_credentials=$(echo "$aws_credentials" \
  | grep '^export ' \
  | sed -E 's/^export (.*);$/\1/')

printf '%s\n' "$relevant_credentials" > "$config_path"

echo "Written to $config_path"
