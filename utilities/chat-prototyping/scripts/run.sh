#!/usr/bin/env bash
set -e

PROJECT_DIR="$(dirname "${BASH_SOURCE[0]}")/.."

${PROJECT_DIR}/../../common/scripts/check-dev-aws-credentials.sh

cd "$PROJECT_DIR"

echo ""
echo "== Starting gradio =="

uv run gradio --watch-dirs="$(realpath ../../libs/python/chat-assistants)" src/chat_prototyping/main.py
