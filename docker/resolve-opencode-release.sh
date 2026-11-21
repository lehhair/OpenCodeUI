#!/usr/bin/env bash
set -euo pipefail

. "$(dirname "$0")/opencode-release.sh"
manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT
curl -fsSL --retry 3 --retry-delay 2 --retry-connrefused \
  -o "$manifest" "${OPENCODE_MANIFEST_URL:-https://opencode.ai/update/api/latest/cli/opencode}"
version="$(opencode_release_version "$manifest")"
printf 'version=%s\n' "$version"
# Single-line base64 preserves JSON through the action's build-args list parser.
printf 'manifest=%s\n' "$(base64 < "$manifest" | tr -d '\n')"
