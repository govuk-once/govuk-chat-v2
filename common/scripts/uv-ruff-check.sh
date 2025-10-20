#!/usr/bin/env bash

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

if [ -n "$CI" ]; then
    uv run ruff check --output-format=github
else
    uv run ruff check
fi
