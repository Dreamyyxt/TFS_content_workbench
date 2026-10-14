#!/bin/bash
# 同步「发布镜像」目录 —— 每次重新发布工作台之前必须跑一次
#
# ⚠️ 现在推荐直接跑 `bash tools/publish.sh`：它在本脚本的基础上多了「回退体检」与
#    「sha256 + node --check 复核」。本脚本保留为「只同步、不检查」的轻量入口。
#    完整发布流程见 docs/PUBLISH.md
#
# 为什么要这个镜像：
#   工作台的线上应用（appId wbapp_OVXOIXh914a31yrMdLVAOD，链接 nail-content-workbench）
#   是按【本地目录路径】绑定的。工程在 2026-10-09 改名搬迁后，发布工具认不回旧应用，
#   会新建一个 App —— 新 App 的域名被云端拒绝（403 the request origin is not allowed），
#   素材库/脚本/排期/风向大家全读不出来。所以发布必须从旧路径发起。
#
#   正式工程（唯一真源，git 仓库）：/Users/dreamyyxt/WorkBuddy/第五季内容工作台/workbench
#   发布镜像（自动生成，请勿手改）：/Users/dreamyyxt/WorkBuddy/2026-10-05-12-31-27/workbench
#
# 用法：
#   bash tools/sync-publish-mirror.sh
#   然后由助手从「发布镜像」路径调用发布。

set -e

SRC="/Users/dreamyyxt/WorkBuddy/第五季内容工作台/workbench"
DST="/Users/dreamyyxt/WorkBuddy/2026-10-05-12-31-27/workbench"

if [ ! -f "$SRC/server.js" ]; then
  echo "❌ 找不到正式工程：$SRC"
  exit 1
fi

mkdir -p "$DST"

rsync -a --delete \
  --exclude='.DS_Store' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='_sample' \
  "$SRC/" "$DST/"

echo "✅ 发布镜像已同步：$DST"
echo
echo "已同步的关键文件："
for f in server.js app.js index.html styles.css studio.js video-api.js package.json; do
  [ -f "$DST/$f" ] && printf "  %-16s %s 字节\n" "$f" "$(stat -f%z "$DST/$f")"
done
echo
echo "下一步：请助手从「发布镜像」目录发布（domainPrefix: nail-content-workbench）。"
