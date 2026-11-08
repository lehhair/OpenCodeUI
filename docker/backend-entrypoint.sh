#!/usr/bin/env bash
set -eu

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

  curl -fsSL "${MISE_INSTALL_URL:-https://mise.run}" \
    | MISE_INSTALL_PATH=/usr/local/bin/mise MISE_INSTALL_FROM_GITHUB=1 MISE_INSTALL_ARCH="${MISE_ARCH}" sh
}

ensure_opencode() {
  if opencode --version >/dev/null 2>&1; then
    return
  fi

  # 走 opencode.ai 的 CLI 分发清单（v2 发布线）。GitHub 的 releases/latest
  # 仍指向 v1.19.x，装下来和 v2 SDK 前端对不上。
  case "$(uname -m)" in
    x86_64)  OC_ARCH=x64 ;;
    aarch64|arm64) OC_ARCH=arm64 ;;
    *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
  esac

  local manifest=/tmp/opencode-release.json
  curl -fsSL --retry 3 --retry-delay 2 --retry-connrefused -o "$manifest" "${OPENCODE_MANIFEST_URL:-https://opencode.ai/update/api/latest/cli/opencode}"

  local file="opencode-linux-${OC_ARCH}.tar.gz"
  local url sha
  url="$(jq -r --arg f "$file" '.metadata.files[$f].url // empty' "$manifest")"
  sha="$(jq -r --arg f "$file" '.metadata.files[$f].sha256 // empty' "$manifest")"
  if [ -z "$url" ] || [ -z "$sha" ]; then
    echo "no ${file} entry in opencode manifest" >&2
    exit 1
  fi
  case "$url" in
    http*) ;;
    *) url="https://opencode.ai${url}" ;;
  esac

  curl -fsSL --retry 3 --retry-delay 2 --retry-connrefused -o /tmp/opencode.tar.gz "$url"
  echo "${sha}  /tmp/opencode.tar.gz" | sha256sum -c -
  tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin opencode
  rm -f /tmp/opencode.tar.gz "$manifest"
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
