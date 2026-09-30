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
  # 镜像里已经装好了（Dockerfile 构建期安装 + sha256 校验），这里只是兜底：
  # 只有当 /root 卷被换掉、二进制丢失时才重新下载。
  if opencode --version >/dev/null 2>&1; then
    return
  fi

  # 🔴 必须走 opencode.ai/files 渠道，**不能用 GitHub Releases 的 latest**：
  # GitHub 的 `latest` 已经停在 v1.18.33（V1），而本 UI 只支持 V2
  # （V2 不在 GitHub Releases；npm 上的 v2 在 `@opencode/cli` 包，不是 `opencode-ai`）。
  # 详见 docker/Dockerfile.backend 的注释。
  # 版本号由 Dockerfile 的 ENV OPENCODE_VERSION 传进来。
  case "$(uname -m)" in
    x86_64)  OC_ARCH=x64 ;;
    aarch64|arm64) OC_ARCH=arm64 ;;
    *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
  esac

  curl -fsSL -o /tmp/opencode.tar.gz \
    "https://opencode.ai/files/bin/${OPENCODE_VERSION:-2.0.19}/opencode-linux-${OC_ARCH}.tar.gz"
  tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin opencode
  rm -f /tmp/opencode.tar.gz
  chmod +x /usr/local/bin/opencode
  # 兜底下载后做一次版本确认：装成 V1 时立刻失败，而不是等到界面连不上才排查。
  opencode --version
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

# 🔴 版本守卫（阶段 4 新增）：本 UI 只支持 opencode **V2**。
# 如果容器里的二进制是 V1（典型场景：还在用改造前构建的旧镜像），
# 表现是「界面能打开、一发消息就连不上」，排查成本极高 —— 所以在这里直接喊出来。
# 注意是**警告不是退出**：万一 --version 输出格式变了，不应该让容器起不来。
OC_VERSION_OUTPUT="$(opencode --version 2>/dev/null || echo unknown)"
case "${OC_VERSION_OUTPUT}" in
  *v2.*) ;;
  *)
    echo "WARNING: opencode 版本不是 V2（实测输出：${OC_VERSION_OUTPUT}）。" >&2
    echo "WARNING: 本 UI 只支持 V2。请更新或重建后端镜像（见 docker/Dockerfile.backend）。" >&2
    ;;
esac

if [ "$#" -eq 0 ]; then
  set -- opencode serve --port 4096 --hostname 0.0.0.0
fi

exec "$@"
