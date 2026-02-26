#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -n "$CI" ]; then
    uv run ruff format --check
else
    uv run ruff format
fi
