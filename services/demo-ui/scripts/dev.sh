#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Zscaler on managed laptops re-signs the Cognito token endpoint with a root
# CA from the macOS keychain, which Node does not trust by default.
NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--use-system-ca" \
  pnpm exec next dev "$@"
