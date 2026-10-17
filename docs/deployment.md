# Public HTTPS deployment

This guide targets a small VPS (for example Huawei Cloud Flexus, 2 vCPU / 2 GB) running one
Collectab server image + PostgreSQL behind an HTTPS reverse proxy, serving the extension from the
Chrome Web Store. Example domain: `api.example.com`.

```
Extension (chrome-extension://<id>)
   │  HTTPS, Authorization: Bearer <session token>
   ▼
Caddy / nginx :443  ──►  collectab server 127.0.0.1:3001  ──►  PostgreSQL 127.0.0.1:5432
```

## 1. Required configuration

Copy the template to the repo root (that is where `docker compose` reads `.env` from):

```bash
cp server/.env.example .env
```

These must be set; the server **refuses to start** with `NODE_ENV=production` if the first two are wrong:

| Variable | Value |
|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`. Rotating it signs everyone out. |
| `BETTER_AUTH_URL` | `https://api.example.com`, the public origin with no `/api` suffix. |
| `NODE_ENV` | `production` |
| `POSTGRES_PASSWORD` | A strong random password. |
| `TRUST_PROXY` | `true` when behind Caddy/nginx. Otherwise every user shares one rate-limit bucket. |

Recommended for a public server:

| Variable | Value |
|---|---|
| `EXTENSION_IDS` | Your Chrome Web Store item ID (32 letters, shown in the developer dashboard). Add `moz-extension://` to also allow Firefox. Empty = any extension may sign in. |
| `INVITE_MODE` / `DEFAULT_ROLE` / `ROLE_QUOTAS` | Public trial: `open` / `guest` / `guest=10,user=500,admin=unlimited`. Closed beta: `invite-only`. |
| `ADMIN_USER_IDS` | Your own user ID (sign up first, then read it from `GET /api/auth/me`). After a restart the extension shows **Settings → Account → Admin panel**, where you manage users and invites. |
| `PRIVACY_OPERATOR_NAME`, `PRIVACY_CONTACT_EMAIL` | Shown on `https://api.example.com/privacy`. Use that URL as the store listing's privacy policy. |
| `EXTENSION_INSTALL_URL` | Your Chrome Web Store listing URL, shown on invite pages (`https://api.example.com/invite/<code>`). |

Optional:

- **Resend** (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`): invitation and password-reset emails. Without it
  invites are shareable links, and in production password-reset links are not delivered (they are only
  logged in development).
- **Google sign-in** (`OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`): see
  [Google OAuth](#4-optional-google-sign-in).

`CORS_ORIGIN` and `TRUSTED_ORIGINS` normally stay empty: the server's own origin and the extension
origins are allowed automatically.

## 2. Run the containers

Docker and Podman both work (`podman compose` / `podman-compose` read the same file):

```bash
docker compose up -d            # or: podman compose up -d
docker compose logs -f server   # migrations run on start; look for "Server running"
curl -s http://127.0.0.1:3001/health
```

Both ports are bound to `127.0.0.1` only, so nothing is exposed until the proxy is up.

To run the single image without compose (bring your own PostgreSQL):

```bash
podman run -d --name collectab --restart=always -p 127.0.0.1:3001:3001 \
  --env-file .env \
  -e DATABASE_URL=postgresql://postgres:<password>@<db-host>:5432/collectab \
  ghcr.io/tiamed/collectab/server:latest
```

On 2 GB of memory the server idles around 100 MB and PostgreSQL around 50 to 100 MB. Adding swap is
still worthwhile if you build images on the box.

## 3. HTTPS reverse proxy

WebSocket sync (`/ws/space/:id`) must be proxied too.

**Caddy** (automatic Let's Encrypt certificates). It sets `X-Forwarded-For` for you:

```caddyfile
api.example.com {
	encode gzip
	reverse_proxy 127.0.0.1:3001 {
		header_up X-Real-IP {remote_host}
	}
}
```

**nginx**:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;
    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    client_max_body_size 10m;   # bookmark imports

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
    }
}
```

The WebSocket handshake carries the session token in its query string. Leave `$request_uri` out of
access logs for `/ws/`, or turn off `access_log` for that location.

Smoke test from your laptop:

```bash
curl -s https://api.example.com/health
curl -s https://api.example.com/api/auth-config     # {"inviteMode":"open","google":false}
```

## 4. Optional: Google sign-in

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** → type
   **Web application**.
2. **Authorized redirect URI**: `https://api.example.com/api/auth/callback/google`.
   That is the only redirect Google sees. The extension's `https://<id>.chromiumapp.org/` URL is
   handled by the server, not Google, so it is **not** added here.
3. Set `OAUTH_GOOGLE_CLIENT_ID` / `OAUTH_GOOGLE_CLIENT_SECRET` and restart. The extension's sign-in
   dialog then shows "Continue with Google".

How the flow works: the extension calls `identity.launchWebAuthFlow` on
`/api/oauth/google/start?redirect_uri=https://<id>.chromiumapp.org/oauth`. The whole OAuth exchange
runs first-party on your domain inside that auth window. `/api/oauth/complete` then redirects to the
`chromiumapp.org` URL with the session token in the URL fragment, which the browser hands to the
extension without sending it over the network. Redirect targets are restricted to extension redirect
hosts (pinned by `EXTENSION_IDS` when set).

## 5. Point the extension at the server

- **Store build**: bake the default in at build time:
  `cd extension && WXT_API_BASE_URL=https://api.example.com pnpm zip`
- **Any build**: Settings → Server URL → `https://api.example.com` (the `/api` suffix is added
  automatically) → **Save & Test**.

## Sessions, refresh and 401s

Better Auth sessions are opaque server-side tokens with sliding expiry. Each authenticated request
made more than `SESSION_UPDATE_AGE_HOURS` after the last extension pushes the expiry out by
`SESSION_EXPIRES_DAYS`. There is no access/refresh token pair and no refresh endpoint. A session
expires only after `SESSION_EXPIRES_DAYS` without use, on sign-out, or when an admin revokes it.

The extension treats the first 401 as final: it drops the token, shows the sign-in dialog in every open
tab, and stops further API and WebSocket calls. Old pre-Better-Auth builds that still call
`POST /api/auth/refresh` get a definitive 401 and sign themselves out.

## Rate limits

Better Auth rate-limits `/api/auth/*` per client IP and path: `RATE_LIMIT_MAX` per
`RATE_LIMIT_WINDOW_SECONDS`, plus built-in stricter rules (sign-in/sign-up: 3 per 10 s; password
reset: 3 per 60 s). Counters are in memory, which is fine for one instance. Other API routes are not
rate-limited by the app; add proxy-level limits if you need them.

## Backups

```bash
docker compose exec -T postgres pg_dump -U postgres collectab | gzip > collectab-$(date +%F).sql.gz
```
