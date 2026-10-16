#!/bin/zsh
# 卸载「剪映制作服务」的登录自启，回到手动双击「启动剪映制作.command」的方式。

cd "$(dirname "$0")" || exit 1
LABEL="com.wujiseason.jianying-connector"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ ! -f "$PLIST" ]; then
  print -r -- "没有安装自启（找不到 $PLIST），无需卸载。"
  print -r -- ""
  read -r "?按回车关闭窗口…"; exit 0
fi

print -r -- "将停止服务并移除自启配置。"
print -r -- ""
read -r "?确定卸载吗？直接回车继续，Ctrl-C 取消："

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
rm -f "$PLIST"

sleep 1
if lsof -nP -iTCP:4191 -sTCP:LISTEN -t >/dev/null 2>&1; then
  print -r -- "⚠️ 4191 端口仍被占用，可能有残留进程："
  lsof -nP -iTCP:4191 -sTCP:LISTEN 2>/dev/null
else
  print -r -- "✔ 已停止，自启配置已移除。"
fi

print -r -- ""
print -r -- "以后想用服务，双击「启动剪映制作.command」即可。"
print -r -- ""
read -r "?按回车关闭窗口…"
