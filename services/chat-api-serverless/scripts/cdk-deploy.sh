#!/usr/bin/env bash

# Script for running the dev checks one runs before pushing up a PR

set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

../../common/scripts/export-aws-credentials.sh

cd ../cdk

cdk deploy "
