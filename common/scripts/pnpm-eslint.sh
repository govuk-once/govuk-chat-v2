#!/usr/bin/env bash

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

if [ -n "$CI" ]; then
    pnpm exec eslint . --max-warnings 0 
else
    pnpm exec eslint . --fix 
fi
