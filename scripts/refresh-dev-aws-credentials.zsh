#!/usr/bin/env zsh

if [[ "${ZSH_EVAL_CONTEXT}" == "toplevel" ]]; then
    # This script has to be run as source so it can operate with NVM (and
    # adjust the current session)
    echo "Error: This script must be sourced, not executed" >&2
    echo "Use: source ${(%):-%x}" >&2
    exit 1
fi

aws_role="${AWS_ROLE:-once-chat-development-admin}"
# We only expect people to be deploying to testing this on eu-west-1, if we
# have reasons to deploy elsewhere we could change this to allow an env var
# override
aws_region=eu-west-1

echo "== Exporting AWS credentials for role: $aws_role on region: $aws_region =="

env_vars=$(gds aws "$aws_role" -r "$aws_region" -e)
cmd_status=$?

if (( $cmd_status != 0 )); then
    echo "Error: gds-cli failed with exit code $cmd_status" >&2
    return 1
fi

eval $env_vars

echo "== Checking AWS credentials work =="
aws sts get-caller-identity --no-cli-pager || return 1
