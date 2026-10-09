#!/bin/bash
# 第五季 · 一键卡点成片
# 双击运行：拖进素材文件夹 + BGM，自动出踩在拍子上的竖版成片

cd "$(dirname "$0")" || exit 1
PY="/Users/dreamyyxt/.workbuddy/binaries/python/envs/default/bin/python"
ROOT="$(cd ../.. && pwd)"
OUTDIR="$ROOT/outputs"

clear
echo "=============================================="
echo "  第五季 · 一键卡点成片"
echo "=============================================="
echo
echo "把「装着图片和视频的文件夹」从访达拖到下面，然后回车。"
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
echo "把 BGM 文件拖进来，然后回车。"
echo "（版权提醒：发抖音请用抖音音乐库里的曲子，别用商业歌曲原曲）"
echo
read -r -p "背景音乐： " BGM
BGM="${BGM%\"}"; BGM="${BGM#\"}"
BGM="${BGM//\\ / }"

if [ ! -f "$BGM" ]; then
  echo
  echo "❌ 找不到这个音频文件：$BGM"
  echo "按回车键关闭…"; read -r; exit 1
fi

echo
echo "开场标题（可留空直接回车）。用 \\n 换行，例如："
echo "   静安·第五季美甲美睫\\n一个客人 一个设计"
echo
read -r -p "标题： " TITLE

echo
echo "转场风格：1=柔和高端（默认）  2=带节奏  3=快闪"
read -r -p "选 1 / 2 / 3 ： " STYLE_N
case "$STYLE_N" in
  2) STYLE="punchy" ;;
  3) STYLE="hard" ;;
  *) STYLE="soft" ;;
esac

echo
read -r -p "片尾卡秒数（回车=3 秒，填 0 = 不要）： " ENDCARD
ENDCARD="${ENDCARD:-3}"

STAMP=$(date +%m%d-%H%M)
OUT="$OUTDIR/卡点成片-$STAMP.mp4"

ARGS=(--media "$MEDIA" --bgm "$BGM" --out "$OUT" --style "$STYLE" --endcard "$ENDCARD")
[ -n "$TITLE" ] && ARGS+=(--title "$TITLE")

echo
echo "----------------------------------------------"
"$PY" make-beat-video.py "${ARGS[@]}"

if [ -f "$OUT" ]; then
  echo
  echo "=============================================="
  echo "  ✅ 完成：$OUT"
  echo "=============================================="
  open -R "$OUT" 2>/dev/null || true
else
  echo
  echo "❌ 没生成出文件，把上面的报错发给我看看。"
fi

echo "按回车键关闭…"
read -r
