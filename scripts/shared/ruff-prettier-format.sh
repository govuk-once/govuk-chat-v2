#!/usr/bin/env bash
set -e

# Local convenience wrapper that runs every formatter for a project.
# CI runs the individual `format-*.sh` scripts as separate jobs so that each
# only needs its own toolchain (uv for Python, pnpm for Prettier).
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "== Ruff formatter == "
./format-ruff.sh

echo "== Prettier formatter =="
./format-prettier.sh
