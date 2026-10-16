#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "没有找到 node 命令。请先装 Node.js，或改用终端手动运行："
  echo "  node tools/archive-assets.cjs"
  echo ""
  read -r "?按回车关闭窗口…"
  exit 1
fi
node tools/archive-assets.cjs "$@"
echo ""
read -r "?按回车关闭窗口…"
