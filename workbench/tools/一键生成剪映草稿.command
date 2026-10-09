#!/bin/bash
# 第五季 · 一键生成剪映草稿
# 双击运行：把素材文件夹拖进来，自动生成剪映草稿

cd "$(dirname "$0")" || exit 1
PY="/Users/dreamyyxt/.workbuddy/binaries/python/envs/default/bin/python"

clear
echo "=============================================="
echo "  第五季 · 一键生成剪映草稿"
echo "=============================================="
echo
echo "用法：把「装着素材的文件夹」从访达拖到下面，然后回车。"
echo "（也可以在访达里拖进来，会自带路径）"
echo
read -r -p "素材文件夹： " MEDIA
MEDIA="${MEDIA%\"}"; MEDIA="${MEDIA#\"}"     # 去掉拖拽带来的引号
MEDIA="${MEDIA//\\ / }"                       # 处理转义空格

if [ ! -d "$MEDIA" ]; then
  echo
  echo "❌ 找不到这个文件夹：$MEDIA"
  echo "按回车键关闭…"; read -r; exit 1
fi

echo
read -r -p "背景音乐（可留空直接回车）： " BGM
BGM="${BGM%\"}"; BGM="${BGM#\"}"

echo
echo "可选的脚本（按回车用最新一条）："
"$PY" make-jianying-draft.py --list-scripts
echo
read -r -p "脚本 id： " SID

ARGS=(--media "$MEDIA")
[ -n "$SID" ] && ARGS+=(--script-id "$SID")
[ -n "$BGM" ] && [ -f "$BGM" ] && ARGS+=(--bgm "$BGM")

echo
"$PY" make-jianying-draft.py "${ARGS[@]}"

echo
echo "=============================================="
echo "  完成。打开（或重启）剪映就能看到这份草稿。"
echo "=============================================="
echo "按回车键关闭…"
read -r
