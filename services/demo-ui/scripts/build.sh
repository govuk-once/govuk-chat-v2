#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Builds the standalone output the web function runs. CDK runs this to
# bundle the app, and CI runs it to catch a build that would fail to deploy.
NEXT_TELEMETRY_DISABLED=1 pnpm exec next build "$@"
