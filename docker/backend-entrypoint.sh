#!/usr/bin/env bash
set -eu

. /usr/local/lib/opencode-release.sh

ensure_mise() {
  if command -v mise >/dev/null 2>&1; then
    return
  fi

  # arm64 用 musl 变体（静态链接），避免 gnu 版对 GLIBC_2.38+ 的依赖。
  case "$(uname -m)" in
    x86_64)  MISE_ARCH=x64 ;;
    aarch64|arm64) MISE_ARCH=arm64-musl ;;
    *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
  esac

  # 用脚本内置的当前版本号钉住版本：校验和写在脚本里，tarball 走
  # mise.jdx.dev，避免去 GitHub Releases 现拉 SHASUMS256.txt（容易 504）。
  local installer=/tmp/mise-install.sh
  curl -fsSL --retry 3 --retry-delay 2 --retry-connrefused -o "$installer" "${MISE_INSTALL_URL:-https://mise.run}"
  local pin
  pin="$(sed -n 's/^[[:space:]]*current_version="v\{0,1\}\([0-9][0-9.]*\)".*$/\1/p' "$installer" | head -n1)"

  if [ -n "$pin" ]; then
    MISE_INSTALL_PATH=/usr/local/bin/mise MISE_INSTALL_ARCH="${MISE_ARCH}" MISE_VERSION="$pin" sh "$installer"
  else
    MISE_INSTALL_PATH=/usr/local/bin/mise MISE_INSTALL_FROM_GITHUB=1 MISE_INSTALL_ARCH="${MISE_ARCH}" sh "$installer"
  fi
  rm -f "$installer"
}

ensure_opencode() {
  local manifest=/usr/local/share/opencode/release.json
  local binary=/usr/local/bin/opencode
  local version
  # Missing/invalid saved metadata is an error; never silently switch to latest.
  version="$(opencode_release_version "$manifest")"
  if opencode_matches_version "$binary" "$version"; then
    return
  fi
  install_opencode "$manifest" "$binary" "$(uname -m)"
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

if [ "$#" -eq 0 ]; then
  set -- /usr/local/bin/opencode serve --port 4096 --hostname 0.0.0.0
fi

case "$1" in
  opencode|/usr/local/bin/opencode)
    # Pin the executable even when /root contains an older command earlier in PATH.
    set -- /usr/local/bin/opencode "${@:2}"
    if [ "${2:-}" = serve ]; then
      export OPENCODE_PASSWORD="${OPENCODE_PASSWORD:-${OPENCODE_SERVER_PASSWORD:-}}"
      : "${OPENCODE_PASSWORD:?Set OPENCODE_PASSWORD or OPENCODE_SERVER_PASSWORD to a non-empty password}"
    fi
    ;;
esac

ensure_mise
ensure_opencode
ensure_package_mirrors

exec "$@"
