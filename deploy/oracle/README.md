# Oracle production

RPGenius runs as one Docker container on Ubuntu ARM (`VM.Standard.A1.Flex`, 1 OCPU, 6 GB RAM, 50 GB boot volume) in Chuncheon. Caddy provides HTTPS for `rpgenius.kro.kr` and forwards requests to `127.0.0.1:3000`.

The existing DynamoDB tables, S3 assets and Supabase connections remain authoritative. Do not import local JSON defaults or run content initialization scripts during deployment. Kakao automatic login remains disabled in `new_engine.js`.

## Deployment

Push to `main`, or run the **Deploy Oracle** GitHub Actions workflow. The repository variable `ORACLE_HOST` and secrets `ORACLE_SSH_KEY` / `ORACLE_SSH_KNOWN_HOSTS` configure SSH. The key is restricted to a forced deployment command on the VM. It cannot open a shell or forward ports.

The root-owned `/usr/local/sbin/rpgenius-deploy` is installed from `deploy.sh`. It accepts only the current `origin/main` commit, serializes deployments, builds before stopping the old process, temporarily blocks requests, sends SIGTERM to flush delayed saves, and waits for `/healthz` to confirm data, user cache and assets are loaded. A startup failure restores the preceding image. Builds retain only the current and preceding image. Changes to the root-owned deploy script require explicit installation by the administrator.

Runtime variables are in `/etc/rpgenius/app.env` (root-only, never committed). Assets use Docker volumes `rpgenius-cardImage`, `rpgenius-itemImage`, and `rpgenius-ui`. Container logs rotate at 3 × 10 MB. Docker and Caddy start on VM reboot.

Useful administrator commands:

```sh
sudo docker logs --tail 100 rpgenius
curl --fail http://127.0.0.1:3000/healthz
sudo systemctl status docker caddy
sudo docker image ls rpgenius
```

For maintenance, create `/var/lib/rpgenius/maintenance`; remove it only after the app is healthy. Do not run a second production process against the same in-memory user cache. For a manual rollback, enable maintenance, stop the current container with a 30-second timeout, start the preceding image with the same environment/volume/port arguments in `deploy.sh`, verify `/healthz`, and disable maintenance.

## Free-tier boundary

At migration time, the existing VM uses 1 OCPU / 2 GB / 47 GB. Combined with this VM, usage is 2 OCPU / 8 GB / 97 GB. This fits the conservative current Oracle allowance of 1,500 OCPU-hours, 9,000 GB-hours and 200 GB block storage. Outbound transfer is limited to 10 TB/month. No paid load balancer, NAT gateway, extra disk, or backup policy is added. Existing external database/API costs are unchanged. Free-tier limits and actual billing should be checked when adding resources.

Public repositories use standard GitHub-hosted runners. The workflow does not use a paid larger runner or a self-hosted runner.
