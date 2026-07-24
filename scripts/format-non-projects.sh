#!/usr/bin/env bash
set -e

# change directory to root
cd "$(dirname "${BASH_SOURCE[0]}")/.."

IGNORE_LIST=".gitignore .prettierignore .non-projects.prettierignore"

IGNORE_CMD=""
for ignore_file in $IGNORE_LIST; do
    IGNORE_CMD+=" --ignore-path $ignore_file"
done

if [ -n "$CI" ]; then
    pnpm exec prettier . --check $IGNORE_CMD
else
    pnpm exec prettier . --write $IGNORE_CMD
fi
