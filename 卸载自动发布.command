#!/bin/bash
# 卸载「自动发布」（只是停掉定时检查，不动任何代码、不影响制作服务）

set -uo pipefail
cd "$(dirname "$0")" || exit 1
LABEL="com.wujiseason.auto-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "───────────────────────────────────────────"
echo " 卸载自动发布"
echo "───────────────────────────────────────────"

/bin/launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
/bin/launchctl unload -w "$PLIST" >/dev/null 2>&1
/bin/launchctl remove "$LABEL" >/dev/null 2>&1

if [ -f "$PLIST" ]; then
  rm -f "$PLIST"
  echo "✅ 已删除 $PLIST"
else
  echo "（plist 本来就不存在）"
fi

if /bin/launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "⚠️ 任务似乎还在，重启电脑后就彻底没了"
else
  echo "✅ 定时检查已停止"
fi

echo
echo "说明："
echo "  · 代码、制作服务、Tailscale 远程访问都不受影响；"
echo "  · 状态记录保留在 ~/.wujiseason/deploy-state.json（重装时不会重复发布）；"
echo "  · 想重新开启，双击「安装自动发布.command」。"
echo
read -r -p "按回车关闭…" _
