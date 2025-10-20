#!/usr/bin/env bash

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

if [ -n "$CI" ]; then
    uv run ruff format --check
else
    uv run ruff format
fi
