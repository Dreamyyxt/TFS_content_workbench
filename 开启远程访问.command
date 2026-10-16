#!/bin/zsh
# 开启「远程访问」：手机 / 别的电脑用浏览器就能使用这台 Mac 的剪辑与生成能力。
# 做三件事：① 确认 Tailscale 已登录 ② 把 HTTPS 域名转发到本机制作服务 ③ 打印访问网址。
# 前置：已装 Tailscale 并登录同一账号；制作服务在跑（双击「重启制作服务.command」）。
# 说明与排障：docs/REMOTE-ACCESS.md

cd "$(dirname "$0")" || exit 1

TS=""
for c in "/Applications/Tailscale.app/Contents/MacOS/Tailscale" "/opt/homebrew/bin/tailscale" "/usr/local/bin/tailscale" "$(command -v tailscale 2>/dev/null)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then TS="$c"; break; fi
done

if [ -z "$TS" ]; then
  print -r -- "✘ 没找到 Tailscale。"
  print -r -- "  ① 安装： brew install --cask tailscale"
  print -r -- "  ② 打开 Tailscale 应用并登录，首次会要求在「系统设置 → 隐私与安全性」允许网络扩展"
  print -r -- "  ③ 再双击本脚本"
  print -r -- ""
  read -r "?按回车关闭窗口…"; exit 0
fi

STATUS_JSON="$("$TS" status --json 2>/dev/null)"
STATE="$(print -r -- "$STATUS_JSON" | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("BackendState",""))' 2>/dev/null)"
if [ "$STATE" != "Running" ]; then
  print -r -- "✘ Tailscale 还没登录 / 没启动（当前状态：${STATE:-未知}）。"
  print -r -- "  请打开 Tailscale 应用，登录（Google / Apple / GitHub / Microsoft 任一账号），"
  print -r -- "  并在「系统设置 → 隐私与安全性」里允许它的网络扩展，然后重跑本脚本。"
  print -r -- ""
  read -r "?按回车关闭窗口…"; exit 0
fi

DNS="$(print -r -- "$STATUS_JSON" | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("Self",{}).get("DNSName","").rstrip("."))' 2>/dev/null)"
if [ -z "$DNS" ]; then
  print -r -- "✘ 读不到 Tailscale 域名（MagicDNS 可能没开）。请把下面内容发我："
  print -r -- "$STATUS_JSON" | head -20
  print -r -- ""
  read -r "?按回车关闭窗口…"; exit 0
fi

print -r -- "正在把 https://$DNS/ 转发到本机制作服务 127.0.0.1:4191 …"
OUT="$("$TS" serve --bg --https=443 http://127.0.0.1:4191 2>&1)"
print -r -- "$OUT"
if print -r -- "$OUT" | grep -qi "error\|not enabled\|forbidden"; then
  print -r -- ""
  print -r -- "提示：若报的是 HTTPS 证书 / 未启用，请到 Tailscale 管理后台"
  print -r -- "      （login.tailscale.com → DNS → HTTPS Certificates）开启一次即可。"
fi

print -r -- ""
if lsof -nP -iTCP:4191 -sTCP:LISTEN -t >/dev/null 2>&1; then
  print -r -- "✔ 制作服务正在运行。"
else
  print -r -- "⚠ 制作服务当前没在跑 → 双击「重启制作服务.command」把它拉起来。"
fi
print -r -- "✔ 远程入口：  https://$DNS/"
print -r -- ""
print -r -- "手机 / 别的电脑：装 Tailscale 并登录同一账号 → 浏览器打开上面的网址即可。"
print -r -- "⚠ 改了这里的授权域名后，需要重启制作服务才生效：双击「重启制作服务.command」。"
print -r -- "(若刚重启过服务，也可以现在就再重启一次，确保它读到域名。)"
print -r -- ""
read -r "?按回车关闭窗口…"
