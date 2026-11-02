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
