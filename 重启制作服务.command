#!/bin/zsh
# 重启「剪映制作服务」。
# 改完剪辑相关代码（jy-catalog.js / edit-plan.js / jianying_*.py / server.js 等）必须重启才生效。

cd "$(dirname "$0")" || exit 1
LABEL="com.wujiseason.jianying-connector"
DOMAIN="gui/$(id -u)"

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  print -r -- "正在重启自启服务…"
  launchctl kickstart -k "$DOMAIN/$LABEL" 2>&1 || print -r -- "✘ kickstart 失败"
else
  print -r -- "没有安装自启服务。"
  print -r -- "请先双击「安装开机自启.command」，或直接双击「启动剪映制作.command」手工启动。"
  print -r -- ""
  read -r "?按回车关闭窗口…"; exit 0
fi

for _ in {1..30}; do
  sleep 1
  if lsof -nP -iTCP:4191 -sTCP:LISTEN -t >/dev/null 2>&1; then
    print -r -- "✔ 已重启，服务在 127.0.0.1:4191 上运行。"
    print -r -- "  回到工作台点一次「连接制作服务」即可（每次重启都会换新令牌）。"
    print -r -- ""
    read -r "?按回车关闭窗口…"; exit 0
  fi
done

print -r -- "✘ 30 秒内没起来，请把下面日志的最后几十行发给我："
print -r -- "  $PWD/logs/jianying-connector.error.log"
tail -n 20 "$PWD/logs/jianying-connector.error.log" 2>/dev/null
print -r -- ""
read -r "?按回车关闭窗口…"
