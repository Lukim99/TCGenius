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

`[paradise transport]` distinguishes response finish from client disconnect. A server status of 200 after a disconnect does not prove the client received the result. `advance` records whether a combat clock was missing, overdue enemy time before calculation, and the resulting combat-event count. Ordinary enemy time and mirror AI time are separate; mirror AI time excludes independent summon/DOT timers. Mirror events are capped by the existing event buffer, so the event count is not a mirror simulation-step count. The new timing records contain these operational counters, action/stage names, opaque IDs, error codes and timings, not accounts, request bodies, inventory or credentials. Healthy requests are not sampled into server logs, so these logs do not provide a latency percentile or failure-rate denominator.

User-cache scans use strongly consistent reads to avoid replacing a saved value with an older read. This doubles read-capacity consumption for those scans, not for all application traffic. Operational content remains in its existing DB/configuration; deployment does not import local content defaults. Run tests only after checking their external-service isolation; `hfield_flow.test.js` now uses an in-memory DB and blocks outbound network connections.

`[http timing]` also records other HTTP handlers taking at least one second, using the registered route template rather than URL parameters or query strings. Long-lived event streams are excluded. It starts before authentication and its outer account queue; Paradise's inner `queue` alone excludes that wait. Both records share an opaque trace, even if a client disconnects before the queued handler starts (`disconnected_before_handler`). Compare overlapping slow routes when a DynamoDB attempt has high process CPU/event-loop activity: an unrelated handler may have delayed its completion callback. This is a correlation signal, not exclusive CPU attribution.

`responseType` is a fixed media category and `responseBytes` is the declared Content-Length when present. The latter is not a count of bytes received by the client. Use these fields to separate long media transfers from busy request handlers; no filenames or raw response headers are recorded.

Card PNG composition runs in one reusable worker thread. Cold images still consume CPU and queue behind other images, but decoding, blending and synchronous PNG compression no longer run on the HTTP event loop. Process CPU includes this worker: high `cpuMs` with substantial `loopIdleMs` is different from a blocked main thread. PNG compression uses level 4 with the same decoded pixels. Matching metadata ETags bypass the worker queue; renderer source and asset metadata changes invalidate them. A legacy byte ETag requires one refresh. If assets change while composition waits, that response uses a byte ETag instead. Include `card_composite_worker.js` in the deployment. Inventory versions and card display context are reused within each synchronous list build, and fishing summaries avoid building unused combat descriptions.

## Free-tier boundary

At migration time, the existing VM uses 1 OCPU / 2 GB / 47 GB. Combined with this VM, usage is 2 OCPU / 8 GB / 97 GB. This fits the conservative current Oracle allowance of 1,500 OCPU-hours, 9,000 GB-hours and 200 GB block storage. Outbound transfer is limited to 10 TB/month. No paid load balancer, NAT gateway, extra disk, or backup policy is added. Existing external database/API costs are unchanged. Free-tier limits and actual billing should be checked when adding resources.

Public repositories use standard GitHub-hosted runners. The workflow does not use a paid larger runner or a self-hosted runner.
