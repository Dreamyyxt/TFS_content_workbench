#!/bin/zsh
# 把「剪映制作服务」装成登录自启：登录后自动运行，意外退出自动拉起。
# 反向操作 = 双击「卸载开机自启.command」；改了剪辑代码要重启用「重启制作服务.command」。
#
# 说明：本脚本在安装时按当前实际路径生成 plist，所以仓库里不会留下写死的本机路径。

cd "$(dirname "$0")" || exit 1
ROOT="$PWD"
LABEL="com.wujiseason.jianying-connector"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
LOGDIR="$ROOT/logs"
SKILL="$HOME/.codex/skills/jianying-editor"

pick() { for p in "$@"; do [ -n "$p" ] && [ -x "$p" ] && { print -r -- "$p"; return 0; }; done; return 1; }
NODE="$(pick "$HOME/.workbuddy/binaries/node/versions/22.22.2-6/bin/node" "$(command -v node 2>/dev/null)")"
PYTHON="$(pick "$HOME/.workbuddy/binaries/python/envs/default/bin/python" "$(command -v python3 2>/dev/null)")"

if [ -z "$NODE" ]; then
  print -r -- "✘ 找不到 node。请先安装 Node.js，或把 node 的绝对路径告诉脚本。"
  read -r "?按回车关闭窗口…"; exit 1
fi

print -r -- "项目目录 ：$ROOT"
print -r -- "node     ：$NODE"
print -r -- "python   ：${PYTHON:-（未找到 —— 剪映剪辑会不可用，火山生成仍可用）}"
print -r -- "剪映技能 ：$SKILL"
print -r -- ""

# 1) 先停掉手工启动的实例，否则两边抢 4191 会互相踢
PIDS=($(lsof -nP -iTCP:4191 -sTCP:LISTEN -t 2>/dev/null))
if [ ${#PIDS[@]} -gt 0 ]; then
  print -r -- "检测到制作服务已经在运行（进程 ${PIDS[@]}）。"
  print -r -- "安装后启动方式会从「双击 .command」变成「登录自动启动」，需要先停掉它。"
  print -r -- ""
  read -r "?继续吗？直接回车接管，Ctrl-C 取消："
  kill ${PIDS[@]} 2>/dev/null
  sleep 2
  print -r -- "已停止旧实例。"
  print -r -- ""
fi

mkdir -p "$LOGDIR" "$HOME/Library/LaunchAgents"

# 2) 生成 plist（launchd 不继承 shell 环境，所有路径必须写绝对路径）
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>$NODE</string>
		<string>$ROOT/workbench/start-jianying.cjs</string>
	</array>
	<key>WorkingDirectory</key>
	<string>$ROOT/workbench</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
		<key>HOME</key>
		<string>$HOME</string>
		<key>JY_PYTHON</key>
		<string>$PYTHON</string>
		<key>JY_SKILL_ROOT</key>
		<string>$SKILL</string>
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>ThrottleInterval</key>
	<integer>10</integer>
	<key>StandardOutPath</key>
	<string>$LOGDIR/jianying-connector.log</string>
	<key>StandardErrorPath</key>
	<string>$LOGDIR/jianying-connector.error.log</string>
</dict>
</plist>
EOF

# 3) 加载（先卸掉旧的一份，重复执行本脚本是安全的）
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
launchctl enable "$DOMAIN/$LABEL" 2>/dev/null
if ! launchctl bootstrap "$DOMAIN" "$PLIST" 2>&1; then
  print -r -- "✘ 加载失败。请把上面这行报错发给我。"
  read -r "?按回车关闭窗口…"; exit 1
fi
print -r -- "已加载自启配置：$PLIST"
print -r -- ""

# 4) 等它起来并探活
print -r -- "正在等待服务启动…"
OK=""
for _ in {1..30}; do
  sleep 1
  if lsof -nP -iTCP:4191 -sTCP:LISTEN -t >/dev/null 2>&1; then OK=1; break; fi
done
print -r -- ""

if [ -n "$OK" ]; then
  print -r -- "✔ 制作服务已在本机启动（127.0.0.1:4191）"
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' -H 'Authorization: Bearer x' http://127.0.0.1:4191/api/jianying/status 2>/dev/null)
  print -r -- "  接口探活：/api/jianying/status → $CODE（401 = 服务在跑且要求鉴权，正常）"
  print -r -- "  进程状态：$(launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -m1 'state = ' | tr -d ' ')"
else
  print -r -- "✘ 30 秒内没起来。请把下面这个日志的最后几十行发给我："
  print -r -- "  $LOGDIR/jianying-connector.error.log"
  tail -n 20 "$LOGDIR/jianying-connector.error.log" 2>/dev/null
fi

print -r -- ""
print -r -- "以后不用再双击「启动剪映制作.command」了 —— 登录后它会自己起来。"
print -r -- "⚠️ 若 Mac 重启后停在登录界面（没开自动登录），服务不会起 —— 见「系统设置 → 用户与群组 → 自动登录」。"
print -r -- "改了剪辑代码后，双击「重启制作服务.command」即可（比关终端再双击省事）。"
print -r -- ""
read -r "?按回车关闭窗口…"
