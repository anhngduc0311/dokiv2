# VPS MangaDex relay

Production runs on `instance-20261102-011600`, project `project-5478c3b3-05cd-4d6a-bce`, zone `asia-southeast1-c`.

Public health endpoint: https://source.dokitruyen.com/health

The cPanel app and cron worker use `MANGADEX_PROXY_URL=https://source.dokitruyen.com/<private-token>` in `release-pg/.env`. The token is a random private path segment, not a browser-facing URL. Never commit it or share the full endpoint. Local `.env` has the same setting. No application rebuild was required because the relay URL is read at runtime.

## Runtime

- Ubuntu 26.10; Python standard library relay binds only `127.0.0.1:8787`.
- Service: `/etc/systemd/system/dokitruyen-relay.service`, enabled on boot with automatic restart and a 192 MiB memory limit.
- Source: `/opt/dokitruyen-relay/relay.py`.
- Private token: `/etc/dokitruyen-relay.env`, root-only mode 0600.
- Nginx: `/etc/nginx/conf.d/dokitruyen-relay.conf`; HTTPS certificate installed by Certbot. The checked-in template is the pre-Certbot configuration; preserve the generated HTTPS blocks when changing production.
- Certbot renewal timer enabled. Certificate was issued without an email; renewals run automatically.
- DNS A `source.dokitruyen.com` points directly to `34.126.172.57` (DNS only). This instance address is ephemeral: update DNS if it changes after stopping/starting the VM.

## Boundaries and cache

Only GET/HEAD requests to allowlisted MangaDex API routes and HTTPS images on MangaDex-owned hosts are accepted. Upstream redirects are rejected. Visitor authentication and cookies are never forwarded. The relay requires its private path prefix. Access logging is disabled. Do not add request URL logging, because URLs contain that prefix.

Nginx caches successful image responses for 24 hours and API responses for 30 seconds, with concurrent cache fills collapsed. It never serves expired API responses. Disk cache target maximum is 512 MiB, with at least 1 GiB free space reserved by the cache manager. The manager may briefly exceed its size target during concurrent writes. Python permits 12 concurrent upstream fetches and caps individual responses. PostgreSQL metadata caching in the website remains in place.

This replaces Cloudflare Worker invocations for this website's configured relay calls. It does not bypass MangaDex source limits. Google Cloud VM and network usage remain subject to the project's billing plan. Other account Workers are unchanged.

## Operations

```sh
systemctl is-active dokitruyen-relay nginx
systemctl is-enabled dokitruyen-relay nginx certbot.timer
systemctl show dokitruyen-relay -p MemoryCurrent -p MemoryMax
sudo nginx -t
sudo systemctl restart dokitruyen-relay
sudo certbot renew --dry-run
```

Run `py tests/vps-relay.py` from the repository root to verify authorization, source restrictions, credential isolation and redirect rejection.

Private deployment backups and verification reports are under ignored `state/vps-relay/`. A backup of the previous cPanel env is retained there. Rollback consists of restoring that env and restarting the cPanel Node application, but the old Cloudflare relay remains subject to its daily request quota.

## PostgreSQL migration preparation (2026-11-03)

The boot disk is now 20 GB and the guest ext4 partition has been expanded. PostgreSQL 18 is installed with a dedicated `dokitruyen_app` role and database, 64 MiB shared buffers, 40 server connections and SCRAM authentication. The database role is not a superuser and cannot create databases or roles. Its connection limit is 30.

`setup-database.py` provisions the empty target, TLS and a certificate renewal hook. `transfer-database.py` reads credentials from a root-private JSON file, dumps Neon consistently, restores only into an empty target, and verifies the row count and a content checksum of every public table. Source writers must be stopped for the final snapshot and verification. Private snapshots are under `/var/backups/dokitruyen`; do not remove the Neon source before checking the live site.

Two transports are available: `DATABASE_DRIVER=postgres` uses a four-connection native pool; `DATABASE_DRIVER=postgres-http` uses a private HTTPS gateway when shared hosting blocks outbound TCP 5432. The HTTPS gateway configuration is prepared but must not be exposed until its access path is explicitly approved. Its exact Nginx location permits only the hosting IP `160.30.20.248`, requires POST, disables cache and retries, and the loopback-only Node service separately requires a random bearer token. The gateway connects to PostgreSQL as the application role, verifies the TLS certificate, keeps parameters separate from SQL, and executes each transaction on one connection. Never log authorization headers, SQL parameters or query results.

The standalone application includes the pure JavaScript PostgreSQL driver. Environment values and credentials are excluded from deployment archives. Preserve the OAuth and MangaDex relay settings when replacing database variables. Restart the cPanel application and restore its worker cron after the cutover. Confirm `/api/health`, catalogue and chapter endpoints, then check PostgreSQL sessions before considering the migration complete. Keep the old environment and archives for rollback; once writes reach the new database, a rollback must account for those writes rather than simply switching back to stale Neon data.
