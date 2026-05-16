#!/usr/bin/env bash
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

  curl -fsSL "${MISE_INSTALL_URL:-https://mise.run}" | sh

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

  curl -fsSL "${OPENCODE_INSTALL_URL:-https://opencode.ai/install}" | bash

  OPENCODE_BIN="$(find /root -name opencode -type f 2>/dev/null | head -1)"
  if [ -z "${OPENCODE_BIN}" ]; then
    echo "opencode install failed: binary not found" >&2
    exit 1
  fi

  rm -f /usr/local/bin/opencode
  cp "${OPENCODE_BIN}" /usr/local/bin/opencode
  chmod +x /usr/local/bin/opencode
}

ensure_package_mirrors() {
  mkdir -p /root/.config/pip

  if [ ! -f /root/.npmrc ]; then
    cat > /root/.npmrc <<EOF
registry=${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}
fund=false
audit=false
EOF
  fi

  if [ ! -f /root/.config/pip/pip.conf ]; then
    cat > /root/.config/pip/pip.conf <<EOF
[global]
index-url = ${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}
trusted-host = ${PIP_TRUSTED_HOST:-pypi.tuna.tsinghua.edu.cn}
timeout = 120
EOF
  fi
}

ensure_mise
ensure_opencode
ensure_package_mirrors

if [ "$#" -eq 0 ]; then
  set -- opencode serve --port 4096 --hostname 0.0.0.0
fi

exec "$@"
