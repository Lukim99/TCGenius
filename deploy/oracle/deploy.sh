#!/usr/bin/env bash
set -Eeuo pipefail
revision=${1:-}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full commit SHA' >&2; exit 2; }
exec 9>/var/lock/rpgenius-deploy.lock
flock -w 900 9
cd /opt/rpgenius/source
git fetch --depth=1 origin main
[[ "$revision" == "$(git rev-parse origin/main)" ]] || { echo 'Commit superseded; skipping'; exit 0; }
git checkout --detach "$revision"
image="rpgenius:$revision"
docker build --label app=rpgenius -t "$image" .

ready() {
    for attempt in $(seq 1 90); do
        if curl --fail --silent --max-time 5 http://127.0.0.1:3000/healthz >/dev/null; then return 0; fi
        sleep 2
    done
    return 1
}
start() {
    docker run -d --name rpgenius --restart unless-stopped --stop-timeout 30 \
        --env-file /etc/rpgenius/app.env -e PORT=3000 -e "DEPLOY_REVISION=$2" \
        --publish 127.0.0.1:3000:3000 \
        --mount type=volume,source=rpgenius-cardImage,target=/DB/RPGenius/cardImage \
        --mount type=volume,source=rpgenius-itemImage,target=/DB/RPGenius/itemImage \
        --mount type=volume,source=rpgenius-ui,target=/DB/RPGenius/ui \
        --log-opt max-size=10m --log-opt max-file=3 "$1"
}

previous=$(docker inspect -f '{{.Config.Image}}' rpgenius 2>/dev/null || true)
previous_revision=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' rpgenius 2>/dev/null | sed -n 's/^DEPLOY_REVISION=//p' || true)
touch /var/lib/rpgenius/maintenance
restore() {
    trap - ERR
    echo 'Deployment failed; restoring previous image' >&2
    docker logs --tail 60 rpgenius >&2 || true
    docker stop --time 30 rpgenius >/dev/null 2>&1 || true
    docker rm rpgenius >/dev/null 2>&1 || true
    if [[ -n "$previous" ]] && start "$previous" "$previous_revision" && ready; then
        rm -f /var/lib/rpgenius/maintenance
    fi
    exit 1
}
trap restore ERR
# Stop new requests before flushing the single process's delayed user saves.
sleep 5
if [[ -n "$previous" ]]; then
    docker stop --time 30 rpgenius
    docker rm rpgenius
fi
start "$image" "$revision"
ready
rm -f /var/lib/rpgenius/maintenance
trap - ERR
printf 'Healthy deployment: %s\n' "$revision"
# Keep the current and immediately previous image for rollback, without unbounded disk use.
while read -r tag; do
    [[ "$tag" == "$image" || "$tag" == "$previous" ]] || docker image rm "$tag" || true
done < <(docker image ls rpgenius --format '{{.Repository}}:{{.Tag}}')
docker image prune -f --filter label=app=rpgenius >/dev/null
