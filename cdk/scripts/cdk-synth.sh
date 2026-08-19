#!/usr/bin/env bash

# If this script is running slow for you, it may be because you have a lot
# of files in your `cdk.out` directory and a CloudFormationValidation step
# is hashing them. Run this script with --validation=false to disable that step

set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

pnpm exec cdk synth --quiet "$@"
