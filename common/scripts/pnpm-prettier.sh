#!/usr/bin/env bash

# Prettier walks up the directory tree for config, but not for ignore paths
# so we have to do it for it.
# Establish original source location for ignore paths
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  # If the symlink was relative, resolve relative to the directory
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done

ROOT_PATH="$(dirname "$SOURCE")/../.."
IGNORE_LIST="$ROOT_PATH/.gitignore $ROOT_PATH/.prettierignore"

IGNORE_CMD=""
for ignore_file in $IGNORE_LIST; do
    IGNORE_CMD+=" --ignore-path $ignore_file"
done


# change directory to project
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

if [ -n "$CI" ]; then
    pnpm exec prettier . --check $IGNORE_CMD
else
    pnpm exec prettier . --write $IGNORE_CMD
fi
