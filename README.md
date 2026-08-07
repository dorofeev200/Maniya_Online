# Maniya Online Lampa Plugin

Production-ready Lampa plugin and Node.js API shell for Maniya Online. The plugin adds a **Maniya Online** button to movie and series cards, checks the user's subscription through your API, and requests provider-backed playback sources.

> The repository does not ship built-in test access or sample playback streams. Configure real subscription data and provider credentials before exposing the service to users.

## Files

- `public/maniya-online.js` — client-side Lampa plugin.
- `server/src` — Node.js API server.
- `docs/maniya-online-api.md` — API contract.
- `docs/operations.md` — production operations notes.

## Plugin setup

Host `public/maniya-online.js` on your HTTPS domain and set `PUBLIC_BASE_URL` for the API origin used by the server.

A user token can be passed in the plugin URL:

```text
https://your-domain.com/maniya-online.js?token=USER_TOKEN
```

Or saved in Lampa Storage by your own account module:

```js
Lampa.Storage.set('maniya_token', 'USER_TOKEN')
```

## Server setup

Create production subscription storage and point the server to it explicitly:

```bash
USERS_FILE=/secure/maniya/users.json \
VIDEOS_FILE=/secure/maniya/videos.json \
PUBLIC_BASE_URL=https://plugin.maniya-kvn.online \
PORT=3000 \
npm --prefix server start
```

`USERS_FILE` is required for subscription-based endpoints to authorize real users. `VIDEOS_FILE` is optional legacy/static source storage; provider results are returned first, and an empty provider result returns an empty list unless you explicitly configure a real `VIDEOS_FILE`.

## Checks

Run automated tests:

```bash
npm --prefix server test
```

Run local smoke checks with an explicit production/test token:

```bash
TOKEN=YOUR_REAL_TOKEN ./scripts/smoke-local.sh
```

Run remote checks with an explicit token:

```bash
TOKEN=YOUR_REAL_TOKEN ./scripts/verify-remote.sh
```

## Backup & restore (disaster recovery)

Reproducible deploy / backup / restore (no `rsync` on the Windows side — uses tar-over-SSH):

```bash
export SSH_ASKPASS=/tmp/askpass.sh SSH_ASKPASS_REQUIRE=force DISPLAY=dummy:0
printf '#!/bin/sh\necho "root_password"\n' > /tmp/askpass.sh   # recreate before each deploy

# Deploy code + infra (systemd/nginx/tls). Does NOT overwrite remote server/.env or server/data.
bash scripts/deploy.sh

# Snapshot the irreplaceable VPS state (.env with tokens, data/*.json with real users)
# into backup/snapshots/<timestamp>/ (gitignored — secrets never enter git).
bash scripts/backup-remote.sh

# Full from-scratch rebuild of a (lost) VPS: deploys code, then restores state from a snapshot.
bash scripts/restore-vps.sh            # or: -s backup/snapshots/<timestamp>

TOKEN=REAL_TOKEN bash scripts/verify-remote.sh
```

Source of truth for recovery: the local git repo (all code) + `backup/*` (live secrets/state) +
`restore-vps.sh` (assembles both onto a fresh server). The repo also pushes to a GitHub `origin`.

## Production notes

Before publishing:

1. configure real `USERS_FILE` data or replace JSON storage with your subscription backend;
2. configure real provider credentials;
3. do not rely on repository `server/data` files for production access;
4. keep CORS, rate limits, health checks, and reverse proxy settings aligned with `docs/operations.md`.
