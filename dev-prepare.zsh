#!/usr/bin/env zsh

if [[ "${ZSH_EVAL_CONTEXT}" == "toplevel" ]]; then
    # This script has to be run as source so it can operate with NVM (and
    # adjust the current session)
    echo "Error: This script must be sourced, not executed" >&2
    echo "Use: source ${(%):-%x}" >&2
    exit 1
fi

# Get script directory in zsh
SCRIPT_DIR="${${(%):-%x}:A:h}"
CURRENT_DIR="$(pwd)"

if test "$CURRENT_DIR" != "$SCRIPT_DIR"; then
    echo "== Changing directory to ${SCRIPT_DIR}"
    cd $SCRIPT_DIR
fi

echo "== Checking uv is installed =="
if command -v uv >/dev/null 2>&1; then
    uv --version
else
    echo "Error: 'uv' is not installed, go to https://docs.astral.sh/uv/getting-started/installation/ to install"
    return 1
fi

echo "== Checking uv python installation =="
uv python install

echo "== Installing uv python dependencies =="
uv sync --all-packages --dev

echo "== Checking nvm is installed =="
if command -v nvm >/dev/null 2>&1; then
    nvm --version
else
    echo "Error: 'nvm' is not installed, go to https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating to install"
    return 1
fi

echo "== Selecting node version =="
nvm use

echo "== Checking pnpm is installed =="
if command -v pnpm >/dev/null 2>&1; then
    pnpm --version
else
    echo "pnpm is not installed, installing now"
    npm install -g pnpm
fi

echo "== Installing pnpm dependencies =="
pnpm install

echo "== Checking GDS CLI is installed =="
if command -v gds >/dev/null 2>&1; then
    gds --version
else
    echo "Error: GDS CLI is not installed, go to https://github.com/alphagov/gds-cli to install"
    return 1
fi

if ! ./common/scripts/check-dev-aws-credentials.sh --no-suggestion; then
    source ./refresh-dev-aws-credentials.zsh
fi

if test "$CURRENT_DIR" != "$SCRIPT_DIR"; then
    echo "== Changing back to ${CURRENT_DIR}"
    cd $CURRENT_DIR
fi
