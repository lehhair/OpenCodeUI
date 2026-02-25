#!/bin/sh
set -eu

ensure_mise() {
  if command -v mise >/dev/null 2>&1; then
    return
  fi

  if [ -x /root/.local/bin/mise ]; then
    rm -f /usr/local/bin/mise
    cp /root/.local/bin/mise /usr/local/bin/mise
    chmod +x /usr/local/bin/mise
    return
  fi

  curl -fsSL https://mise.run | sh

  MISE_BIN="$(find /root -name mise -type f 2>/dev/null | head -1)"
  if [ -z "${MISE_BIN}" ]; then
    echo "mise install failed: binary not found" >&2
    exit 1
  fi

  rm -f /usr/local/bin/mise
  cp "${MISE_BIN}" /usr/local/bin/mise
  chmod +x /usr/local/bin/mise
}

ensure_opencode() {
  if opencode --version >/dev/null 2>&1; then
    return
  fi

  OPENCODE_BIN="$(find /root -name opencode -type f 2>/dev/null | head -1)"
  if [ -n "${OPENCODE_BIN}" ]; then
    rm -f /usr/local/bin/opencode
    cp "${OPENCODE_BIN}" /usr/local/bin/opencode
    chmod +x /usr/local/bin/opencode
    if opencode --version >/dev/null 2>&1; then
      return
    fi
  fi

  curl -fsSL https://opencode.ai/install | bash

  OPENCODE_BIN="$(find /root -name opencode -type f 2>/dev/null | head -1)"
  if [ -z "${OPENCODE_BIN}" ]; then
    echo "opencode install failed: binary not found" >&2
    exit 1
  fi

  rm -f /usr/local/bin/opencode
  cp "${OPENCODE_BIN}" /usr/local/bin/opencode
  chmod +x /usr/local/bin/opencode
}

ensure_mise
ensure_opencode

exec opencode serve --port 4096 --hostname 0.0.0.0
