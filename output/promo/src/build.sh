#!/bin/bash
# Full build: clip manifest -> cue sheet -> soundtrack -> 3600 frames -> H.264/AAC MP4.
# Usage: ./build.sh [workers]
set -euo pipefail
cd "$(dirname "$0")"
WORKERS=${1:-3}
# fonts: Pretendard comes from npm; Cinzel ships in ad/fonts
[ -d node_modules ] || npm install --no-audit --no-fund
for w in Medium SemiBold Bold ExtraBold Black; do cp -n node_modules/pretendard/dist/web/static/woff2/Pretendard-$w.woff2 ad/fonts/; done
node manifest.js
node render.js --cues audio/cues.json
python3 audio/music.py audio/cues.json audio/soundtrack.wav
rm -rf frames && mkdir -p frames out
node render.js --from 0 --to 60 --fps 60 --workers "$WORKERS" --out frames
ffmpeg -y -hide_banner -loglevel error \
  -framerate 60 -i frames/%05d.jpg -i audio/soundtrack.wav \
  -c:v libx264 -preset slow -crf 17 -profile:v high -level 4.2 -pix_fmt yuv420p \
  -x264-params "keyint=120:min-keyint=60" -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -c:a aac -b:a 256k -ar 48000 -movflags +faststart -shortest \
  out/RPGenius_web_60s.mp4
echo "built out/RPGenius_web_60s.mp4"
