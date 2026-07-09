#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -n "$CI" ]; then
    pnpm exec eslint . --max-warnings 0 
else
    pnpm exec eslint . --fix 
fi
