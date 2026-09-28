#!/bin/bash
# Full build: game assets -> cue sheet -> soundtrack -> 5400 frames (90 s @ 60 fps) -> H.264/AAC MP4.
# Usage: ./build.sh [workers]
set -euo pipefail
cd "$(dirname "$0")"
WORKERS=${1:-4}
# fonts: Pretendard comes from npm; Black Han Sans ships in ad/fonts
[ -d node_modules ] || npm install --no-audit --no-fund
for w in Bold ExtraBold Black; do cp -n node_modules/pretendard/dist/web/static/woff2/Pretendard-$w.woff2 ad/fonts/; done
python3 prep_assets.py
node render.js --cues audio/cues.json
python3 audio/music2.py audio/cues.json audio/soundtrack.wav
rm -rf frames && mkdir -p frames out
node render.js --from 0 --to 90 --fps 60 --workers "$WORKERS" --out frames
X="-c:v libx264 -preset slow -tune animation -b:v 4000k -maxrate 7000k -bufsize 10000k -profile:v high -level 4.2 -pix_fmt yuv420p -x264-params keyint=120:min-keyint=60"
ffmpeg -y -hide_banner -loglevel error -framerate 60 -i frames/%05d.jpg $X -pass 1 -passlogfile out/x264 -an -f mp4 /dev/null
ffmpeg -y -hide_banner -loglevel error -framerate 60 -i frames/%05d.jpg -i audio/soundtrack.wav $X -pass 2 -passlogfile out/x264 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest out/RPGenius_pop_90s.mp4
echo "built out/RPGenius_pop_90s.mp4"
