#!/usr/bin/env bash
set -e

./../../../common/scripts/check-dev-aws-credentials.sh

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

echo ""
echo "== Starting app =="

# Using uvicorn rather than FastAPI CLI to have extra reload dirs (FastAPI CLI
# delegate to uvicorn anyway)
uv run uvicorn chat_api.main:app \
    --reload \
    --reload-dir . \
    --reload-dir ../../libs/python/chat-assistants
