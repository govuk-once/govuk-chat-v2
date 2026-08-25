#!/usr/bin/env bash

set -e

echo "== Cleaning orphaned CDK assets =="

CDK_OUT_DIR="$(dirname "${BASH_SOURCE[0]}")/../cdk/cdk.out"

if [ ! -d "$CDK_OUT_DIR" ]; then
  echo "No cdk.out directory to clean"
  exit 0
fi

# Check the <Stack Name>.assets.json files to see if they have the hash
# as a way to confirm an asset is not orphaned
is_referenced() {
  local hash="$1"
  grep -ql "$hash" "$CDK_OUT_DIR"/*.assets.json 2>/dev/null
}

deleted=0
# Look at all the files and directories that are prefixed with asset.<hash>
# where some of these may no longer be referenced in a stack.
for entry in "$CDK_OUT_DIR"/asset.*; do
  [ -e "$entry" ] || continue

  basename="$(basename "$entry")"

  # Strip asset. prefix, .zip suffix, and -building suffix to get the hash
  hash="${basename#asset.}"
  hash="${hash%.zip}"
  hash="${hash%-building}"

  if ! is_referenced "$hash"; then
    rm -rf "$entry"
    deleted=$((deleted + 1))
  fi
done

echo "Removed $deleted orphaned asset(s) from cdk.out"
