# MangaDex relay

The cPanel host resets connections to MangaDex. The `dokitruyen-source` Cloudflare Worker forwards the site's public MangaDex API and image requests.

Production URL: `https://dokitruyen-source.akzan0311.workers.dev`

Set the following in the local `.env` and `/home/hplmxsdt/dokitruyen/release-pg/.env`:

```dotenv
MANGADEX_PROXY_URL=https://dokitruyen-source.akzan0311.workers.dev
```

Deploy `mangadex-proxy.mjs` as the Worker's module. It permits read-only API routes and HTTPS images on MangaDex-owned domains, rejects redirects, and does not forward visitor cookies or authorization headers. No database or OAuth credentials belong in this Worker.

The cPanel application and cron worker keep their existing Node runtime. An official Node binary tested under `dokitruyen/runtime` did not resolve the hosting connection failure and is not used by production.

Reader metadata is cached in PostgreSQL for five minutes with a one-day outage fallback. Image server addresses expire after one minute and are never served stale. Source images are cached at the Worker for one day. The account's current Worker allowance is 100,000 requests per day; each Worker invocation counts toward that allowance.

From the repository root, run `node tests/mangadex-proxy.mjs` and `node tests/reader-source-outage.mjs` before updating the relay or reader cache.
