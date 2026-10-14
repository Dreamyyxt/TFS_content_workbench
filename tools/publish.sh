#!/bin/bash
# 工作台一键发布前置 —— 体检 + 同步镜像 + 复核
#
# 用法：
#   bash tools/publish.sh              # 体检 + 同步 + 复核
#   bash tools/publish.sh --check-only # 只做回退体检，不动文件
#   bash tools/publish.sh --force      # 体检发现问题也继续同步（慎用）
#
# 说明与完整流程见 docs/PUBLISH.md
#
# 路径约定：
#   工程源   = 本脚本所在仓库的 workbench/ （自动探测，换机后无需改）
#   发布镜像 = 默认 /Users/dreamyyxt/WorkBuddy/2026-10-05-12-31-27/workbench
#              —— 这条路径是「正式域名的锚点」，改掉会丢应用绑定，故写成固定默认值。
#              换机器可用环境变量覆盖：PUBLISH_MIRROR_ROOT=/path/to/2026-10-05-12-31-27

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/workbench"
MIRROR_ROOT="${PUBLISH_MIRROR_ROOT:-/Users/dreamyyxt/WorkBuddy/2026-10-05-12-31-27}"
DST="$MIRROR_ROOT/workbench"

EXCLUDES=(--exclude='.DS_Store' --exclude='__pycache__' --exclude='*.pyc' --exclude='_sample')

CHECK_ONLY=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=1 ;;
    --force)      FORCE=1 ;;
    -h|--help)    sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

red()  { printf "\033[31m%s\033[0m\n" "$1"; }
grn()  { printf "\033[32m%s\033[0m\n" "$1"; }
yel()  { printf "\033[33m%s\033[0m\n" "$1"; }

echo "工程源  ：$SRC"
echo "发布镜像：$DST"
echo

if [ ! -f "$SRC/server.js" ]; then
  red "❌ 找不到工程源：$SRC/server.js"
  exit 1
fi

# ── 1. 回退体检：镜像里有、源里没有的文件 = 源侧回退了 ──────────────
# 必须放在同步之前做：一旦同步，--delete 就会把这些文件真的删掉，线上静默回退。
echo "── 1/3 回退体检 ─────────────────────────────"
if [ ! -d "$DST" ]; then
  yel "⚠️  发布镜像尚不存在（首次发布？），跳过体检。"
  DELETIONS=""
else
  # -8/--8-bit-output：让 rsync 原样输出中日韩文件名，不要转义成 \#232 这种八进制
  DELETIONS="$(rsync -a --delete --dry-run --itemize-changes --8-bit-output "${EXCLUDES[@]}" "$SRC/" "$DST/" 2>/dev/null | grep '^\*deleting' || true)"
fi

if [ -n "$DELETIONS" ]; then
  red "❌ 检测到「镜像有、源没有」的文件 —— 当前分支很可能回退了："
  echo "$DELETIONS" | sed 's/^\*deleting[[:space:]]*/    /' | sed 's/^/  /'
  echo
  yel "  直接同步会让线上静默丢掉这些能力。请先确认分支："
  yel "    git -C \"$REPO_ROOT\" status --short --branch"
  yel "    git -C \"$REPO_ROOT\" log --oneline -5"
  if [ "$FORCE" -ne 1 ]; then
    red "已中止（确要继续请加 --force）。"
    exit 1
  fi
  yel "  已指定 --force，继续。"
else
  grn "✅ 无回退信号。"
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo
  grn "仅体检模式结束。"
  exit 0
fi

# ── 2. 同步镜像 ────────────────────────────────────────────────
echo
echo "── 2/3 同步发布镜像 ─────────────────────────"
mkdir -p "$DST"
rsync -a --delete "${EXCLUDES[@]}" "$SRC/" "$DST/" || { red "❌ rsync 失败"; exit 1; }
grn "✅ 镜像已同步。"

# ── 3. 复核：关键文件一致 + 语法检查 ───────────────────────────
echo
echo "── 3/3 一致性复核 ───────────────────────────"

KEY_FILES=(server.js index.html app.js styles.css studio.css edit-plan.js jy-catalog.js jianying-studio.js)
FAIL=0
for f in "${KEY_FILES[@]}"; do
  [ -f "$SRC/$f" ] || continue
  a="$(shasum -a 256 "$SRC/$f" | cut -d' ' -f1)"
  b="$(shasum -a 256 "$DST/$f" | cut -d' ' -f1)"
  if [ "$a" = "$b" ]; then
    printf "  %-22s %s\n" "$f" "一致"
  else
    printf "  %-22s %s\n" "$f" "不一致"
    FAIL=1
  fi
done

NODE_BIN="$(command -v node || true)"
[ -x "/Users/dreamyyxt/.workbuddy/binaries/node/versions/22.22.2-6/bin/node" ] && \
  NODE_BIN="/Users/dreamyyxt/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"

if [ -n "$NODE_BIN" ]; then
  while IFS= read -r js; do
    if ! "$NODE_BIN" --check "$js" >/dev/null 2>&1; then
      red "  语法错误：${js#$DST/}"
      FAIL=1
    fi
  done < <(find "$DST" -maxdepth 2 -name '*.js' -not -path '*/node_modules/*' -not -path '*/__pycache__/*')
  [ "$FAIL" -eq 0 ] && grn "✅ 前端脚本语法检查通过。"
else
  yel "⚠️  未找到 node，跳过语法检查。"
fi

if [ "$FAIL" -ne 0 ]; then
  red "❌ 复核未通过，请修好再发布。"
  exit 1
fi

# ── 下一步 ────────────────────────────────────────────────────
echo
grn "✅ 前置全部通过。"
echo
echo "下一步：让助手从这里发布（参数固定）"
echo "  directory    = $DST"
echo "  domainPrefix = nail-content-workbench"
echo "  appName      = 第五季内容工作台"
echo
echo "发布后复核："
echo "  curl -sI https://nail-content-workbench.app.workbuddy.host/            # 期望 200"
echo "  curl -sI https://nail-content-workbench.app.workbuddy.host/server.js   # 期望 404"
