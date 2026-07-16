#!/usr/bin/env zsh

if [[ "${ZSH_EVAL_CONTEXT}" == "toplevel" ]]; then
    # This script has to be run as source so it can operate with NVM (and
    # adjust the current session)
    echo "Error: This script must be sourced, not executed" >&2
    echo "Use: source ${(%):-%x}" >&2
    exit 1
fi

aws_role="${AWS_ROLE:-once-chat-development-admin}"

echo "== Exporting AWS credentials for role: $aws_role =="

env_vars=$(gds aws "$aws_role" -e)
cmd_status=$?

if (( $cmd_status != 0 )); then
    echo "Error: gds-cli failed with exit code $cmd_status" >&2
    return 1
fi

eval $env_vars

echo "== Checking AWS credentials work =="
aws sts get-caller-identity --no-cli-pager || return 1
