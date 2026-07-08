#!/usr/bin/env zsh

# This script has to be run as source so it can operate with NVM and set env
# vars for the current shell
#
# The reason it has loads of `return 1` is so that if it hits an error it can
# stop processing.
if [[ "${ZSH_EVAL_CONTEXT}" == "toplevel" ]]; then
    echo "Error: This script must be sourced, not executed" >&2
    echo "Use: source ${(%):-%x}" >&2
    exit 1
fi

# Find project root directory with cryptic ZSH parameter expansion
ROOT_DIR="${${(%):-%x}:A:h:h}"
CURRENT_DIR="$(pwd)"

if test "$CURRENT_DIR" != "$ROOT_DIR"; then
    echo "== Changing directory to ${ROOT_DIR}"
    cd $ROOT_DIR
fi

echo "== Checking GitHub Authentication =="
if [[ -z "${GITHUB_TOKEN}" ]]; then
    if command -v gh >/dev/null 2>&1; then
        if ! gh auth status >/dev/null 2>&1; then
            echo "Error: You are not logged into GitHub CLI."
            echo "Run: gh auth login"
            return 1
         fi
         echo "Setting GITHUB_TOKEN from GitHub CLI"
         export GITHUB_TOKEN=$(gh auth token)
    else
        echo "Error: 'gh' (GitHub CLI) is not installed."
        echo "Install it via Homebrew: brew install gh"
        return 1
    fi
else
    echo "GITHUB_TOKEN already set, skipping export"
fi

echo "== Checking uv is installed =="
if command -v uv >/dev/null 2>&1; then
    uv --version || return 1
else
    echo "Error: 'uv' is not installed, go to https://docs.astral.sh/uv/getting-started/installation/ to install"
    return 1
fi

echo "== Checking uv python installation =="
uv python install || return 1

echo "== Installing uv python dependencies =="
uv sync --all-packages --dev || return 1

echo "== Checking nvm is installed =="
if command -v nvm >/dev/null 2>&1; then
    nvm --version || return 1
else
    echo "Error: 'nvm' is not installed, go to https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating to install"
    return 1
fi

echo "== Selecting node version =="
nvm use || nvm install || return 1

echo "== Checking pnpm is installed =="
if command -v pnpm >/dev/null 2>&1; then
    pnpm --version || return 1
else
    echo "pnpm is not installed, installing now"
    npm install -g pnpm || return 1
fi

echo "== Installing pnpm dependencies =="
pnpm install || return 1

echo "== Checking GDS CLI is installed =="
if command -v gds >/dev/null 2>&1; then
    gds --version || return 1
else
    echo "Error: GDS CLI is not installed, go to https://github.com/alphagov/gds-cli to install"
    return 1
fi

if ! ${ROOT_DIR}/scripts/check-dev-aws-credentials.sh --no-suggestion; then
    source ${ROOT_DIR}/scripts/refresh-dev-aws-credentials.zsh
fi

if test "$CURRENT_DIR" != "$ROOT_DIR"; then
    echo "== Changing back to ${CURRENT_DIR}"
    cd $CURRENT_DIR
fi
