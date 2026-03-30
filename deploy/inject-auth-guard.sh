#!/bin/bash
# inject-auth-guard.sh — 在 HTML 文件的 </head> 前注入 auth-guard.js
set -euo pipefail

TARGET="${1:-dist/index.html}"

if [ ! -f "$TARGET" ]; then
    echo "ERROR: File not found: $TARGET" >&2
    exit 1
fi

# 检查是否已注入（幂等）
if grep -q 'auth-guard\.js' "$TARGET"; then
    echo "SKIP: auth-guard.js already injected in $TARGET"
    exit 0
fi

# 在 </head> 前插入
sed -i 's|</head>|<script src="/auth-guard.js"></script>\n</head>|' "$TARGET"
echo "DONE: auth-guard.js injected into $TARGET"
