#!/bin/bash
# 查看自动发布的运行状态（只读，不改任何东西）

set -uo pipefail
cd "$(dirname "$0")" || exit 1
REPO="$(pwd)"
STATE_DIR="$HOME/.wujiseason"
STATE="$STATE_DIR/deploy-state.json"
LOG="$STATE_DIR/auto-sync.log"
LABEL="com.wujiseason.auto-sync"
SITE="https://nail-content-workbench.app.workbuddy.host"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

line() { printf '%s\n' "───────────────────────────────────────────"; }

line
echo " 自动发布状态"
line

# 1. 守护进程
printf '守护进程  : '
if /bin/launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  INFO="$(/bin/launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E '^\s+(state|pid|runs) ' | tr -s ' ' | tr '\n' ' ')"
  echo "运行中  ${INFO}"
else
  echo "未安装（双击「安装自动发布.command」）"
fi

# 2. 状态文件
echo
if [ -f "$STATE" ]; then
  echo "状态记录  :"
  /usr/bin/python3 - "$STATE" <<'PY' 2>/dev/null || cat "$STATE"
import json,sys
d=json.load(open(sys.argv[1]))
def short(s): return (s or '')[:7] if s else '—'
print(f"  已上线     : {short(d.get('lastDeployed'))}")
print(f"  已处理     : {short(d.get('lastProcessed'))}")
p=d.get('pending')
if p:
    icon={'ready':'⏳ 等待发布','failed':'❌ 处理失败'}.get(p.get('status'), p.get('status'))
    print(f"  待发布     : {icon}  {short(p.get('commit'))}  {p.get('subject','')}")
    if p.get('note'): print(f"               原因：{p['note']}")
else:
    print("  待发布     : 无")
PY
else
  echo "状态记录  : 还没有（未安装过或从未触发）"
fi

# 3. git 现状
echo
echo "代码现状  :"
echo "  本地 main : $(git rev-parse --short HEAD 2>/dev/null)  $(git log -1 --format=%s 2>/dev/null | cut -c1-42)"
git fetch --quiet origin main 2>/dev/null
echo "  远端 main : $(git rev-parse --short origin/main 2>/dev/null)"
AB="$(git rev-list --left-right --count main...origin/main 2>/dev/null)"
echo "  落后/领先 : 落后 $(echo "$AB" | awk '{print $2}')，领先 $(echo "$AB" | awk '{print $1}')"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "  ⚠️ 工作区有未提交改动 → 自动同步会暂停"
else
  echo "  ✅ 工作区干净"
fi

# 4. 线上
echo
printf '线上站点  : '
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/" 2>/dev/null || echo 000)"
[ "$CODE" = "200" ] && echo "✅ $CODE  $SITE" || echo "⚠️ $CODE  $SITE"

# 5. 最近日志
echo
echo "最近日志  :"
if [ -f "$LOG" ] && [ -s "$LOG" ]; then
  tail -n 18 "$LOG" | sed 's/^/  /'
else
  echo "  （暂无记录）"
fi

echo
line
read -r -p "按回车关闭…" _
