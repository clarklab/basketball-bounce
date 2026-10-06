#!/bin/sh
# Assembles the deployed site in _site/:
#   /         the picker (index.html) and the recording (bounce.mp4)
#   /claude/  static files, served as they are
#   /gpt/     the Vite build of gpt/, built to live under that path
set -e
cd "$(dirname "$0")"

(cd gpt && npm ci && npm run build -- --base=/gpt/)

rm -rf _site
mkdir -p _site/claude _site/gpt
cp index.html bounce.mp4 _site/
cp claude/index.html _site/claude/
cp -R claude/src _site/claude/
cp -R gpt/dist/. _site/gpt/
