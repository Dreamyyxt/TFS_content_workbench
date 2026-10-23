#!/bin/bash
# 自动同步引擎（由 launchd 每 2 分钟调用一次，也可手动跑）
#
#   bash tools/auto-sync.sh            同步一次
#   bash tools/auto-sync.sh --dry-run  只看会不会动，不真的 merge / 重启
#
# 它只做三件事：拉代码 → 体检 → 重启本机服务。
# **发布（传到线上）不在这里做** —— 那需要客户端鉴权，由 WorkBuddy 的定时任务读
# ~/.wujiseason/deploy-state.json 里的 pending 完成。
#
# 安全底线（不可改）：
#   · 只用 `git merge --ff-only`，永远不 reset / clean / stash / 强推；
#   · 工作区有未提交改动 → 立即跳过，不碰用户正在编辑的文件；
#   · 体检不通过 → 不写 pending，绝不把坏代码发上线；
#   · 同一 commit 只处理一次，避免每 2 分钟重复重启 + 通知轰炸。

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/workbench"
STATE_DIR="$HOME/.wujiseason"
STATE="$STATE_DIR/deploy-state.json"
LOG="$STATE_DIR/auto-sync.log"
LOCK="$STATE_DIR/.auto-sync.lock"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
NODE_BIN="/Users/dreamyyxt/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node || true)"
LAUNCH_LABEL="com.wujiseason.jianying-connector"

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

mkdir -p "$STATE_DIR"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"; }

notify() { # $1=标题 $2=正文
  [ "$DRY" -eq 1 ] && { log "（dry-run 跳过通知）$1 / $2"; return; }
  /usr/bin/osascript -e "display notification \"$2\" with title \"$1\" sound name \"Glass\"" >/dev/null 2>&1 || true
}

# ── 状态读写（借 node 处理 JSON，避免 bash 拼 JSON 出错）────────────
state_get() { # $1=dotted.path
  [ -f "$STATE" ] || { echo ""; return; }
  "$NODE_BIN" -e '
    const fs=require("fs");
    let d={}; try{d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));}catch(e){}
    const v=process.argv[2].split(".").reduce((o,k)=>(o&&o[k]!==undefined)?o[k]:undefined,d);
    process.stdout.write(v===undefined||v===null?"":String(v));
  ' "$STATE" "$1" 2>/dev/null
}

state_set() { # $1=key $2=value（键值为字符串；pending 用 set_pending）
  [ "$DRY" -eq 1 ] && return
  "$NODE_BIN" -e '
    const fs=require("fs"),p=process.argv[1];
    let d={}; try{d=JSON.parse(fs.readFileSync(p,"utf8"));}catch(e){}
    d[process.argv[2]]=process.argv[3];
    fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
  ' "$STATE" "$1" "$2" 2>/dev/null
}

set_pending() { # $1=commit $2=subject $3=status $4=note
  [ "$DRY" -eq 1 ] && { log "（dry-run）将写 pending: $1 $3"; return; }
  "$NODE_BIN" -e '
    const fs=require("fs"),p=process.argv[1];
    let d={}; try{d=JSON.parse(fs.readFileSync(p,"utf8"));}catch(e){}
    d.pending={commit:process.argv[2],subject:process.argv[3],status:process.argv[4],note:process.argv[5]||"",at:new Date().toISOString()};
    fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
  ' "$STATE" "$1" "$2" "$3" "$4" 2>/dev/null
}

clear_pending() {
  [ "$DRY" -eq 1 ] && return
  "$NODE_BIN" -e '
    const fs=require("fs"),p=process.argv[1];
    let d={}; try{d=JSON.parse(fs.readFileSync(p,"utf8"));}catch(e){}
    delete d.pending;
    fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");
  ' "$STATE" 2>/dev/null
}

# ── 单实例锁 ─────────────────────────────────────────────────────
if ! mkdir "$LOCK" 2>/dev/null; then
  # 锁超过 15 分钟视为残留（例如进程被杀）
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null
    mkdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# ── 日志轮转（保留最近 500 行）──────────────────────────────────
if [ -f "$LOG" ] && [ "$(wc -l <"$LOG" 2>/dev/null || echo 0)" -gt 800 ]; then
  tail -n 500 "$LOG" >"$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi

cd "$REPO" || { log "❌ 进不去仓库 $REPO"; exit 1; }

# ── 1. 分支守卫：只在 main 上自动同步 ───────────────────────────
BRANCH="$(git branch --show-current 2>/dev/null)"
if [ "$BRANCH" != "main" ]; then
  log "跳过：当前在分支 $BRANCH（自动同步只在 main 生效）"
  exit 0
fi

# ── 2. 工作区守卫：有未提交改动就不动 ───────────────────────────
# 只看「已跟踪文件」的改动（M/A/D/R）。纯 untracked 不算阻塞：
# 拉代码不会覆盖它们，而且 git merge 遇到同名冲突会自己拒绝，不会毁掉内容。
TRACKED_DIRTY="$(git status --porcelain 2>/dev/null | grep -vE '^\?\?' | head -20)"
UNTRACKED_CNT="$(git status --porcelain 2>/dev/null | grep -cE '^\?\?' || true)"
if [ -n "$TRACKED_DIRTY" ]; then
  if [ "$(state_get dirtyWarned)" != "1" ]; then
    log "跳过：有未提交的代码改动，不自动合并"
    log "$TRACKED_DIRTY"
    notify "自动同步已暂停" "有未提交的代码改动，处理完会自动恢复"
    state_set dirtyWarned "1"
  fi
  exit 0
fi
if [ "$(state_get dirtyWarned)" = "1" ]; then
  log "已恢复：工作区没有未提交的代码改动"
  state_set dirtyWarned "0"
fi
[ "${UNTRACKED_CNT:-0}" -gt 0 ] && log "（有 $UNTRACKED_CNT 个未跟踪文件，不影响同步）"

# ── 3. 取远端 ───────────────────────────────────────────────────
if ! git fetch --quiet origin main 2>>"$LOG"; then
  log "❌ git fetch 失败（网络？），本轮跳过"
  exit 1
fi

REMOTE_SHA="$(git rev-parse origin/main 2>/dev/null)"
BEFORE_SHA="$(git rev-parse HEAD 2>/dev/null)"
[ -n "$REMOTE_SHA" ] || { log "❌ 取不到 origin/main"; exit 1; }

LAST_PROCESSED="$(state_get lastProcessed)"

# 同一个 commit 只处理一次
if [ "$REMOTE_SHA" = "$LAST_PROCESSED" ]; then
  exit 0
fi

# 本地已经在远端那个位置（例如刚手动 pull 过）→ 记个基线就够，无需再合并
if [ "$REMOTE_SHA" = "$BEFORE_SHA" ]; then
  if [ "$DRY" -eq 1 ]; then
    echo "本地已是最新（${REMOTE_SHA:0:7}），无需动作；仅记录基线"
    exit 0
  fi
  log "本地已是 ${REMOTE_SHA:0:7}，记录基线后跳过"
  state_set lastProcessed "$REMOTE_SHA"
  exit 0
fi

log "发现新提交 ${REMOTE_SHA:0:7}（上次处理 ${LAST_PROCESSED:0:7}）"

if [ "$DRY" -eq 1 ]; then
  echo "将执行：git merge --ff-only origin/main"
  echo "  本地 HEAD : ${BEFORE_SHA:0:7}"
  echo "  远端 main : ${REMOTE_SHA:0:7}"
  echo "  改动文件  :"
  git diff --name-only "$BEFORE_SHA" "$REMOTE_SHA" 2>/dev/null | head -20 | sed 's/^/    /'
  echo "  workbench/ 有变更 : $(git diff --name-only "$BEFORE_SHA" "$REMOTE_SHA" -- workbench/ 2>/dev/null | wc -l | tr -d ' ') 个文件"
  exit 0
fi

# ── 4. 快进合并 ─────────────────────────────────────────────────
if ! git merge --ff-only origin/main >>"$LOG" 2>&1; then
  SUBJECT="$(git log -1 --format=%s "$REMOTE_SHA" 2>/dev/null)"
  log "❌ 无法快进合并（本地与远端已分叉，或在 main 上还有未推送的提交）"
  set_pending "$REMOTE_SHA" "$SUBJECT" "failed" "无法快进合并：本地 main 与 origin/main 分叉"
  state_set lastProcessed "$REMOTE_SHA"
  notify "自动同步失败" "本地 main 与远端分叉，需要手工处理"
  exit 1
fi

NEW_HEAD="$(git rev-parse HEAD 2>/dev/null)"
SUBJECT="$(git log -1 --format=%s "$NEW_HEAD" 2>/dev/null)"
log "✅ 已快进到 ${NEW_HEAD:0:7}：$SUBJECT"

# ── 5. 只有 workbench/ 变了才需要上线 ───────────────────────────
CHANGED_APP="$(git diff --name-only "$BEFORE_SHA" "$NEW_HEAD" -- workbench/ 2>/dev/null | wc -l | tr -d ' ')"
if [ "${CHANGED_APP:-0}" -eq 0 ]; then
  log "workbench/ 无变更（只动了文档/脚本），不发布；已更新的文件下次用户操作即生效"
  state_set lastProcessed "$NEW_HEAD"
  clear_pending
  exit 0
fi
log "workbench/ 有 $CHANGED_APP 个文件变更 → 进入体检"

# ── 6. 发布前体检（含测试、静态白名单、语法）────────────────────
CHECK_OUT="$(bash "$REPO/tools/publish.sh" --quiet 2>&1)"
CHECK_RC=$?
if [ "$CHECK_RC" -ne 0 ]; then
  log "❌ 体检未通过（代码已更新，但不会发布）："
  echo "$CHECK_OUT" >>"$LOG"
  set_pending "$NEW_HEAD" "$SUBJECT" "failed" "体检未通过，见 auto-sync.log"
  state_set lastProcessed "$NEW_HEAD"
  notify "体检未通过，未发布" "「${SUBJECT}」测试失败，代码已拉取但没上线"
  exit 1
fi
log "✅ 体检通过"

# ── 7. 重启本机制作服务（server.js 改动需要重启才生效）──────────
if /bin/launchctl print "gui/$(id -u)/$LAUNCH_LABEL" >/dev/null 2>&1; then
  /bin/launchctl kickstart -k "gui/$(id -u)/$LAUNCH_LABEL" >/dev/null 2>&1
  sleep 3
  if lsof -nP -iTCP:4191 -sTCP:LISTEN >/dev/null 2>&1; then
    log "✅ 制作服务已重启，4191 正常监听"
  else
    log "⚠️ 重启后 4191 未监听，请检查 logs/jianying-connector.log"
    notify "制作服务未起来" "重启后 4191 没在监听，请看日志"
  fi
else
  log "（制作服务未由 launchd 托管，跳过重启）"
fi

# ── 8. 交给发布环节 ─────────────────────────────────────────────
set_pending "$NEW_HEAD" "$SUBJECT" "ready" ""
state_set lastProcessed "$NEW_HEAD"

log "⏳ 已标记待发布：${NEW_HEAD:0:7} $SUBJECT"
notify "代码已同步，等待发布" "「${SUBJECT}」体检通过，稍后自动上线"
exit 0
