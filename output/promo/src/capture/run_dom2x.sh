#!/bin/bash
# 2x DOM effect captures, each retried on fresh servers until the real server roll succeeds.
cd "$(dirname "$0")"
for i in $(seq 1 12); do
  ./serve.sh 3902 > /dev/null
  RPG_BASE=http://localhost:3902 node dom_clips.js fusion '{"w":960,"h":540,"scale":2,"out":"fusion2"}' > clip_fusion2.log 2>&1 && break
done
echo "FUSION2DONE try $i" >> clip_fusion2.log
for i in $(seq 1 14); do
  ./serve.sh 3902 > /dev/null
  RPG_BASE=http://localhost:3902 node dom_clips.js enhance '{"item":"콰트로 1악장","w":480,"h":860,"scale":2,"out":"enhance2"}' > clip_enhance2.log 2>&1 && break
done
echo "ENH2DONE try $i" >> clip_enhance2.log
