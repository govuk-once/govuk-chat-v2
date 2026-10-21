#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Generates the types that check pages, layouts and route handlers export
# what Next expects. Without them tsc still passes but skips those checks.
pnpm exec next typegen
pnpm exec tsc --noEmit
