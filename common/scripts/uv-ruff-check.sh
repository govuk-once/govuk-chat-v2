#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -n "$CI" ]; then
    uv run ruff check --output-format=github
else
    uv run ruff check
fi
