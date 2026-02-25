#!/usr/bin/env bash
set -e

PROJECT_DIR="$(dirname "${BASH_SOURCE[0]}")/.."

${PROJECT_DIR}/../../common/scripts/check-dev-aws-credentials.sh

cd "$PROJECT_DIR"

echo ""
echo "== Starting app =="

# Using uvicorn rather than FastAPI CLI to have extra reload dirs (FastAPI CLI
# delegate to uvicorn anyway)
uv run uvicorn chat_api.main:app \
    --reload \
    --reload-dir . \
    --reload-dir ../../libs/python/chat-assistants
