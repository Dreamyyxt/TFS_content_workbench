#!/bin/bash
# 工作台发布前置检查（只检查，不改文件、不发布）
#
# 用法：
#   bash tools/publish.sh          # 全量体检
#   bash tools/publish.sh --quiet  # 只报错，不打印明细
#
# 检查完把下面「发布参数」整段交给助手即可。机制与步骤见 docs/PUBLISH.md。
#
# 历史提醒：旧版脚本会把 workbench/ rsync 到 /Users/…/2026-10-05-12-31-27/workbench
# 这个「发布镜像」。该镜像已废弃（目录已清空），这条同步会让线上静默回退，故移除。

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/workbench"

APP_ID="wbapp_OVXOIXh914a31yrMdLVAOD"
DOMAIN_PREFIX="nail-content-workbench"
APP_NAME="第五季内容工作台"
SITE="https://nail-content-workbench.app.workbuddy.host"

QUIET=0
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

red() { printf "\033[31m%s\033[0m\n" "$1"; }
grn() { printf "\033[32m%s\033[0m\n" "$1"; }
yel() { printf "\033[33m%s\033[0m\n" "$1"; }
say() { [ "$QUIET" -eq 1 ] || echo "$1"; }

FAIL=0
WARN=0

[ "$QUIET" -eq 1 ] || echo "工程目录：$SRC"
[ "$QUIET" -eq 1 ] || echo "线上应用：${APP_NAME}（${APP_ID}）"
[ "$QUIET" -eq 1 ] || echo

if [ ! -f "$SRC/server.js" ]; then
  red "❌ 找不到 $SRC/server.js"
  exit 1
fi

# ── 1. git 同步状态 ───────────────────────────────────────────
[ "$QUIET" -eq 1 ] || echo "── 1/5 git 同步 ─────────────────────────────"
BRANCH="$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null)"
if [ "$BRANCH" != "main" ]; then
  yel "⚠️  当前分支是 ${BRANCH}（不是 main）"
  WARN=$((WARN+1))
fi

if git -C "$REPO_ROOT" rev-parse --verify -q origin/main >/dev/null 2>&1; then
  AHEAD_BEHIND="$(git -C "$REPO_ROOT" rev-list --left-right --count main...origin/main 2>/dev/null)"
  AHEAD="$(echo "$AHEAD_BEHIND" | awk '{print $1}')"
  BEHIND="$(echo "$AHEAD_BEHIND" | awk '{print $2}')"
  if [ "${BEHIND:-0}" != "0" ]; then
    red "❌ 本地 main 落后 origin/main $BEHIND 个提交 —— 直接发布会把别人的改动覆盖掉"
    red "   先执行：git fetch origin && git merge origin/main"
    FAIL=1
  elif [ "${AHEAD:-0}" != "0" ]; then
    yel "⚠️  本地 main 领先 origin/main $AHEAD 个提交（未推送）"
    WARN=$((WARN+1))
  else
    say "✅ main 与 origin/main 一致"
  fi
  if ! git -C "$REPO_ROOT" diff --quiet; then
    yel "⚠️  工作区有未提交改动（发布会带上磁盘上的内容，而不是 git 内容）"
    WARN=$((WARN+1))
  fi
else
  yel "⚠️  没有 origin/main 引用，跳过同步检查"
  WARN=$((WARN+1))
fi

# ── 2. 测试 ───────────────────────────────────────────────────
[ "$QUIET" -eq 1 ] || echo
[ "$QUIET" -eq 1 ] || echo "── 2/5 测试 ─────────────────────────────────"
NODE_BIN="$(command -v node || true)"
[ -x "/Users/dreamyyxt/.workbuddy/binaries/node/versions/22.22.2-6/bin/node" ] && \
  NODE_BIN="/Users/dreamyyxt/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"
if [ -z "$NODE_BIN" ]; then
  red "❌ 找不到 node"
  exit 1
fi
TEST_OUT="$(cd "$SRC" && "$NODE_BIN" --test tests/*.test.cjs 2>&1)"
TEST_SUM="$(echo "$TEST_OUT" | grep -E '^# (pass|fail)' | tr '\n' ' ')"
if echo "$TEST_OUT" | grep -qE '^# fail 0'; then
  say "✅ $TEST_SUM"
else
  red "❌ 测试未通过：$TEST_SUM"
  echo "$TEST_OUT" | grep -A 20 '^not ok' | head -30
  FAIL=1
fi

# ── 3. 静态白名单 ─────────────────────────────────────────────
# index.html 引用的每个 ./x.js 都必须在 server.js 的 STATIC_FILES 里，
# 否则线上 404、页面静默少功能。
[ "$QUIET" -eq 1 ] || echo
[ "$QUIET" -eq 1 ] || echo "── 3/5 前端脚本白名单 ───────────────────────"
MISSING=""
for f in $(grep -oE '\./[a-zA-Z0-9._-]+\.js' "$SRC/index.html" | sed 's|^\./||' | sort -u); do
  if ! grep -q "'/$f'" "$SRC/server.js"; then
    MISSING="$MISSING $f"
  fi
done
if [ -n "$MISSING" ]; then
  red "❌ 这些前端脚本没有登记进 server.js 的 STATIC_FILES：$MISSING"
  red "   线上会 404 并静默缺功能。"
  FAIL=1
else
  say "✅ index.html 引用的脚本都已登记"
fi

# ── 4. 语法 ───────────────────────────────────────────────────
[ "$QUIET" -eq 1 ] || echo
[ "$QUIET" -eq 1 ] || echo "── 4/5 语法检查 ─────────────────────────────"
BAD=""
for f in "$SRC"/*.js; do
  "$NODE_BIN" --check "$f" >/dev/null 2>&1 || BAD="$BAD $(basename "$f")"
done
if [ -n "$BAD" ]; then
  red "❌ 语法错误：$BAD"
  FAIL=1
else
  say "✅ 全部 .js 语法通过"
fi

# ── 5. 线上现状 ───────────────────────────────────────────────
[ "$QUIET" -eq 1 ] || echo
[ "$QUIET" -eq 1 ] || echo "── 5/5 线上现状 ─────────────────────────────"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/" || echo 000)"
if [ "$CODE" = "200" ]; then
  say "✅ 线上可访问（${CODE}）"
else
  yel "⚠️  线上首页返回 ${CODE}（发布后再复核）"
  WARN=$((WARN+1))
fi

# ── 结论 + 发布参数 ───────────────────────────────────────────
echo
if [ "$FAIL" -ne 0 ]; then
  red "❌ 体检未通过，请修好再发布。"
  exit 1
fi

if [ "$WARN" -ne 0 ]; then
  yel "⚠️  有 $WARN 条提醒，可继续。"
fi
grn "✅ 体检通过。"
echo
echo "发布参数（交给助手，参数固定）："
echo "  directory    = $SRC"
echo "  appId        = $APP_ID        ← 必须带，否则会在别的机器上新建应用"
echo "  domainPrefix = $DOMAIN_PREFIX"
echo "  appName      = $APP_NAME"
echo "  language     = node"
echo
echo "发布后复核："
echo "  curl -sI $SITE/ | head -1                                  # 200"
echo "  curl -s  $SITE/api/health                                  # ok:true"
echo "  curl -s  $SITE/ | grep -c wj-local-service                 # 0"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' $SITE/server.js  # 404"
