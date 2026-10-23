#!/bin/bash
# 安装「自动发布」：git 一有 push，这台电脑每 2 分钟检查一次，
# 有新提交就自动拉取 → 体检 → 重启制作服务 → 标记待发布。
#
# 双击运行。装完不用重启电脑。

set -uo pipefail
cd "$(dirname "$0")" || exit 1
REPO="$(pwd)"
STATE_DIR="$HOME/.wujiseason"
LABEL="com.wujiseason.auto-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_OUT="$STATE_DIR/auto-sync.out.log"
LOG_ERR="$STATE_DIR/auto-sync.err.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

echo "───────────────────────────────────────────"
echo " 安装自动发布"
echo "───────────────────────────────────────────"
echo "仓库：$REPO"
echo

if [ ! -f "$REPO/tools/auto-sync.sh" ]; then
  echo "❌ 找不到 tools/auto-sync.sh，是不是目录不对？"
  read -r -p "按回车关闭…" _; exit 1
fi
chmod +x "$REPO/tools/auto-sync.sh" 2>/dev/null

# ── 1. 确认能拉代码（launchd 是干净环境，SSH 必须无口令）────────
echo "1) 检查能否免密拉取 GitHub…"
if env -i HOME="$HOME" PATH="$PATH" git -C "$REPO" ls-remote origin main >/dev/null 2>&1; then
  echo "   ✅ 可以（SSH key 免密）"
else
  echo "   ❌ 拉不到。请先在终端确认：git -C \"$REPO\" fetch origin"
  read -r -p "按回车关闭…" _; exit 1
fi
echo

# ── 2. 初始化状态：把「当前线上版本」当作已发布 ─────────────────
mkdir -p "$STATE_DIR"
git -C "$REPO" fetch --quiet origin main 2>/dev/null
CUR="$(git -C "$REPO" rev-parse origin/main 2>/dev/null)"
if [ ! -f "$STATE_DIR/deploy-state.json" ]; then
  cat >"$STATE_DIR/deploy-state.json" <<JSON
{
  "lastProcessed": "$CUR",
  "lastDeployed": "$CUR",
  "installedAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
JSON
  echo "2) 初始化状态：以 ${CUR:0:7} 为「已上线」基线（不会立刻重复发布）"
else
  echo "2) 状态文件已存在，保留现有记录（不会重复发布）"
  echo "   lastDeployed = $(/usr/bin/python3 -c "import json;print(json.load(open('$STATE_DIR/deploy-state.json')).get('lastDeployed','')[:7])" 2>/dev/null)"
fi
echo

# ── 3. 写 LaunchAgent ───────────────────────────────────────────
echo "3) 写入 LaunchAgent…"
mkdir -p "$HOME/Library/LaunchAgents"
cat >"$PLIST" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$REPO/tools/auto-sync.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO</string>
    <key>StartInterval</key>
    <integer>120</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>60</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_OUT</string>
    <key>StandardErrorPath</key>
    <string>$LOG_ERR</string>
</dict>
</plist>
XML

if ! /usr/bin/plutil -lint "$PLIST" >/dev/null 2>&1; then
  echo "   ❌ plist 格式有问题，已中止"
  read -r -p "按回车关闭…" _; exit 1
fi
echo "   ✅ $PLIST"
echo

# ── 4. 加载（先卸旧的）──────────────────────────────────────────
echo "4) 加载任务…"
/bin/launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
if /bin/launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then
  echo "   ✅ 已加载"
else
  # 部分环境 bootstrap 会返回 EIO，退回到旧接口
  if /bin/launchctl load -w "$PLIST" 2>/dev/null; then
    echo "   ✅ 已加载（load 兼容模式）"
  else
    echo "   ❌ 加载失败。请在终端执行："
    echo "      launchctl bootstrap gui/\$(id -u) \"$PLIST\""
    read -r -p "按回车关闭…" _; exit 1
  fi
fi
echo

sleep 2
if /bin/launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "   ✅ 任务已在运行（每 120 秒检查一次）"
else
  echo "   ⚠️ 查不到任务状态，稍后可用「查看自动发布状态.command」确认"
fi

echo
echo "───────────────────────────────────────────"
echo " 装好了"
echo "───────────────────────────────────────────"
echo
echo "现在的流程："
echo "  别的电脑 git push → 这台 Mac 2 分钟内自动拉取 + 体检 + 重启服务"
echo "  → 标记待发布 → WorkBuddy 定时任务每小时把待发布的内容真正发上线"
echo
echo "任何一步有动静都会弹系统通知。"
echo "手动查看：双击「查看自动发布状态.command」"
echo
read -r -p "按回车关闭…" _
