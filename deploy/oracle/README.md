# Oracle production

RPGenius runs as one Docker container on Ubuntu ARM (`VM.Standard.A1.Flex`, 1 OCPU, 6 GB RAM, 50 GB boot volume) in Chuncheon. Caddy provides HTTPS for `rpgenius.kro.kr` and forwards requests to `127.0.0.1:3000`.

The existing DynamoDB tables, S3 assets and Supabase connections remain authoritative. Do not import local JSON defaults or run content initialization scripts during deployment. Kakao automatic login remains disabled in `new_engine.js`.

## Deployment

Push to `main`, or run the **Deploy Oracle** GitHub Actions workflow. The repository variable `ORACLE_HOST` and secrets `ORACLE_SSH_KEY` / `ORACLE_SSH_KNOWN_HOSTS` configure SSH. The key is restricted to a forced deployment command on the VM. It cannot open a shell or forward ports.

The root-owned `/usr/local/sbin/rpgenius-deploy` is installed from `deploy.sh`. It accepts only the current `origin/main` commit, serializes deployments, builds before stopping the old process, temporarily blocks requests, sends SIGTERM to flush delayed saves, and waits for `/healthz` to confirm data, user cache and assets are loaded. A startup failure restores the preceding image. Builds retain only the current and preceding image. Changes to the root-owned deploy script require explicit installation by the administrator.

Runtime variables are in `/etc/rpgenius/app.env` (root-only, never committed). Assets use Docker volumes `rpgenius-cardImage`, `rpgenius-itemImage`, and `rpgenius-ui`. Container logs rotate at 3 × 10 MB. Docker and Caddy start on VM reboot.

Caddy uses free ZeroSSL ACME certificates because the shared `kro.kr` domain hit Let's Encrypt's issuance limit during cutover. `/etc/caddy/acme.env` supplies `ACME_EMAIL` through a systemd `EnvironmentFile` override. Caddy stores its account/certificates under `/var/lib/caddy` and renews automatically. Keep this directory when updating Caddy.

Useful administrator commands:

```sh
sudo docker logs --tail 100 rpgenius
curl --fail http://127.0.0.1:3000/healthz
sudo systemctl status docker caddy
sudo docker image ls rpgenius
```

For maintenance, create `/var/lib/rpgenius/maintenance`; remove it only after the app is healthy. Do not run a second production process against the same in-memory user cache. For a manual rollback, enable maintenance, stop the current container with a 30-second timeout, start the preceding image with the same environment/volume/port arguments in `deploy.sh`, verify `/healthz`, and disable maintenance.

## Paradise latency diagnosis

`/api/paradise` and its exploration actions return `X-Paradise-Trace` and `Server-Timing`. Requests taking at least one second, and server errors, emit `[paradise timing]`. `advance_compute` measures synchronous combat advancement; `advance_save` measures its persistence. `save` is the subsequent player action's persistence. The historical 48.194-second request predates these subdivisions, so its original `advance=48125` alone cannot identify the cause.

`operations` separates `protected_flush`, existing `flush_wait`, `usage_delivery`/`usage_publish`, and DynamoDB calls. An operation's `waitingFor` links a request to work started by an earlier request or a background timer. Slow persistence jobs also emit `[persistence timing]`. `omitted` reports operations beyond the per-request limit of 32. `[paradise pending]` reports active work and its dependencies every ten seconds, up to six times; a client disconnect does not cancel a durable save or stop this diagnosis.

DynamoDB `tries` includes attempt duration, HTTP status, sanitized error name/code and network milestones. `dispatchMs` measures attempt start to HTTP dispatch and includes SDK preparation and socket-pool waiting. DNS, TCP, TLS, sent, headers and body times are cumulative from HTTP dispatch; absent connection phases are normal for a reused socket. `attempts` and `retryDelayMs` distinguish SDK retries. A long wait for headers alone does not distinguish the network from service processing: compare AWS metrics and the recorded AWS request ID. CPU and event-loop measurements cover the whole process during the interval, not exclusive CPU use by that request.

`[paradise transport]` distinguishes response finish from client disconnect. A server status of 200 after a disconnect does not prove the client received the result. The new timing records contain action/stage names, opaque IDs, error codes and timings, not accounts, request bodies, game state or credentials. Healthy requests are not sampled into server logs, so these logs do not provide a latency percentile or failure-rate denominator.

User-cache scans use strongly consistent reads to avoid replacing a saved value with an older read. This doubles read-capacity consumption for those scans, not for all application traffic. Operational content remains in its existing DB/configuration; deployment does not import local content defaults. Run tests only after checking their external-service isolation; `hfield_flow.test.js` now uses an in-memory DB and blocks outbound network connections.

## Free-tier boundary

At migration time, the existing VM uses 1 OCPU / 2 GB / 47 GB. Combined with this VM, usage is 2 OCPU / 8 GB / 97 GB. This fits the conservative current Oracle allowance of 1,500 OCPU-hours, 9,000 GB-hours and 200 GB block storage. Outbound transfer is limited to 10 TB/month. No paid load balancer, NAT gateway, extra disk, or backup policy is added. Existing external database/API costs are unchanged. Free-tier limits and actual billing should be checked when adding resources.

Public repositories use standard GitHub-hosted runners. The workflow does not use a paid larger runner or a self-hosted runner.
