#!/bin/zsh
# 关闭「远程访问」：保留本机使用，只停掉对外的 HTTPS 入口。
# 需要再次开启时双击「开启远程访问.command」。

cd "$(dirname "$0")" || exit 1

TS=""
for c in "/Applications/Tailscale.app/Contents/MacOS/Tailscale" "/opt/homebrew/bin/tailscale" "/usr/local/bin/tailscale" "$(command -v tailscale 2>/dev/null)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then TS="$c"; break; fi
done

if [ -z "$TS" ]; then
  print -r -- "✘ 没找到 Tailscale（可能没装，或已卸掉）。"
  print -r -- ""
  read -r "?按回车关闭窗口…"; exit 0
fi

print -r -- "正在关闭远程入口…"
"$TS" serve --https=443 off 2>&1
print -r -- ""
print -r -- "✔ 远程入口已关闭（本机 http://127.0.0.1:4191 不受影响）。"
print -r -- "  再次开启：双击「开启远程访问.command」"
print -r -- ""
read -r "?按回车关闭窗口…"
