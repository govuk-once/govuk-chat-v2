#!/usr/bin/env zsh

if [[ "${ZSH_EVAL_CONTEXT}" == "toplevel" ]]; then
    # This script has to be run as source so it can operate with NVM (and
    # adjust the current session)
    echo "Error: This script must be sourced, not executed" >&2
    echo "Use: source ${(%):-%x}" >&2
    exit 1
fi


echo "== Checking GDS CLI is installed =="
if command -v gds >/dev/null 2>&1; then
    gds --version
else
    echo "Error: GDS CLI is not installed, go to https://github.com/alphagov/gds-cli to install"
    return 1
fi

aws_role="${AWS_ROLE:-once-chat-development-admin}"

echo "== Exporting AWS credentials for role: $aws_role =="

eval $(eval gds aws "$aws_role" -e)

echo "== Checking AWS credentials work =="
aws sts get-caller-identity --no-cli-pager
