#!/bin/bash
# Restart a real RPGenius server (default :3900) with the in-memory DynamoDB mock. Usage: serve.sh [port]
CAP=$(cd "$(dirname "$0")" && pwd)
PORT=${1:-3900}
PIDF="$CAP/server-$PORT.pid"
[ "$PORT" = "3900" ] && [ -f "$CAP/server.pid" ] && PIDF="$CAP/server.pid"
[ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null; sleep 0.5
cd "$CAP/../../../.."   # repo root
# Safety: never touch production. With fake credentials any AWS call the mock does not intercept
# (e.g. the S3 asset sync at boot) is rejected instead of reading or writing real DynamoDB/S3 data.
PORT=$PORT AWS_ACCESS_KEY_ID=offline-capture AWS_SECRET_KEY_ID=offline-capture AWS_SECRET_ACCESS_KEY=offline-capture \
  AWS_ENDPOINT_URL=http://127.0.0.1:9 nohup node -r "$CAP/mock_dynamo.js" server.js > "$CAP/server-$PORT.log" 2>&1 &
echo $! > "$PIDF"
for i in $(seq 1 40); do curl -s -o /dev/null http://localhost:$PORT/ && break; sleep 0.25; done
sleep 1.5; echo "server up on $PORT"
