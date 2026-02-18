#!/usr/bin/env bash
set -e

./../../common/scripts/check-dev-aws-credentials.sh

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

echo ""
echo "== Starting gradio =="

uv run gradio --watch-dirs="$(realpath ../../libs/python/chat-assistants)" src/chat_prototyping/main.py
