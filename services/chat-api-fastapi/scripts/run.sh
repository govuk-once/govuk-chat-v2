#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

scripts/export-aws-credentials.sh

echo ""
echo "== Starting app =="

# Using uvicorn rather than FastAPI CLI to have extra reload dirs (FastAPI CLI
# delegate to uvicorn anyway)
uv run uvicorn chat_api.main:app \
    --reload \
    --reload-dir . \
    --reload-dir ../../libs/python/chat-assistants
