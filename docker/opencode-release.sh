#!/usr/bin/env bash
# Shared by the image build and runtime repair. Runtime only reads the saved manifest.

opencode_release_version() {
  local version
  version="$(jq -er '.version | strings | select(test("^v?[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.+-]+)?$"))' "$1")" || return 1
  version="${version#v}"
  if [ "${version%%.*}" -lt 2 ]; then
    echo "OpenCode v2 or newer is required" >&2
    return 1
  fi
  printf '%s\n' "$version"
}

opencode_matches_version() {
  local actual
  actual="$("$1" --version 2>/dev/null)" || return 1
  actual="${actual#opencode }"
  [ "${actual#v}" = "$2" ]
}

install_opencode() (
  set -eu
  local manifest="$1" binary="$2" arch="$3" requested="${4:-}"
  local version file url sha download_dir
  version="$(opencode_release_version "$manifest")"
  if [ -n "$requested" ] && [ "${requested#v}" != "$version" ]; then
    echo "opencode manifest version $version does not match requested $requested" >&2
    exit 1
  fi
  case "$arch" in
    amd64|x86_64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) echo "unsupported arch: $arch" >&2; exit 1 ;;
  esac
  file="opencode-linux-${arch}.tar.gz"
  url="$(jq -er --arg f "$file" '.metadata.files[$f].url | strings | select(length > 0)' "$manifest")"
  sha="$(jq -er --arg f "$file" '.metadata.files[$f].sha256 | strings | select(test("^[a-fA-F0-9]{64}$"))' "$manifest")"
  case "$url" in
    https://*|http://*) ;;
    /*) url="https://opencode.ai${url}" ;;
    *) echo "invalid URL for $file" >&2; exit 1 ;;
  esac

  download_dir="$(mktemp -d)"
  trap 'rm -rf "$download_dir"' EXIT
  curl -fsSL --retry 3 --retry-delay 2 --retry-connrefused -o "$download_dir/opencode.tar.gz" "$url"
  printf '%s  %s\n' "$sha" "$download_dir/opencode.tar.gz" | sha256sum -c -
  tar -xzf "$download_dir/opencode.tar.gz" -C "$download_dir" opencode
  chmod +x "$download_dir/opencode"
  if ! opencode_matches_version "$download_dir/opencode" "$version"; then
    echo "opencode binary version does not match manifest $version" >&2
    exit 1
  fi
  # Verify before replacing the installed binary, including on runtime repair.
  install -m 755 "$download_dir/opencode" "$binary"
)
