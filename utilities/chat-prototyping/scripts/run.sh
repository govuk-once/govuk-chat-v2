#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

scripts/export-aws-credentials.sh

echo ""
echo "== Starting gradio =="

uv run gradio --watch-dirs="$(realpath ../../libs/python/chat-assistants)" src/chat_prototyping/main.py
