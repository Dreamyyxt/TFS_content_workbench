#!/bin/zsh
set -eu
cd "$(dirname "$0")/.."
exec npm run studio
