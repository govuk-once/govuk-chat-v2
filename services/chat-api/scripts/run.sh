#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

scripts/export-aws-credentials.sh

echo ""
echo "== Starting app =="

uv run fastapi dev src/chat_api/main.py
