# Collectab

<img width="2288" height="1260" alt="newtab preview" src="https://github.com/user-attachments/assets/1f83a103-fba6-45d4-8147-8f4a3a511535" />


A Toby-like browser extension bookmark manager with organizations, spaces, collections, drag-drop reorder, and CRDT-based real-time sync.

## Features

- **Organizations** — isolate work/hobby/personal bookmarks; invite collaborators
- **Spaces & Collections** — hierarchical organization (Org → Space → Collection → Bookmarks)
- **Drag & Drop** — reorder bookmarks within/across collections and reorder spaces
- **Real-time Sync** — Loro CRDT + WebSocket keeps bookmark order in sync across tabs
- **Import / Export** — import from NiceTab, Toby, or a previous export; export all data as JSON
- **Light & Dark Mode** — system-aware theme toggle
- **Self-hostable** — configurable API server URL

## Structure

```
├── extension/          # WXT browser extension (React + Tailwind)
│   ├── entrypoints/
│   │   └── newtab/     # Main UI — new tab override
│   ├── components/
│   ├── hooks/
│   └── lib/
├── server/             # Hono API server
│   └── src/
│       ├── api/        # REST routes (auth, orgs, spaces, collections, bookmarks, search, import)
│       └── database/   # PostgreSQL schema (Drizzle ORM)
└── .github/workflows/  # CI + tag-based release
```

## Self-Deployment

PostgreSQL is **required**.

> **Public HTTPS server for the Chrome Web Store build?** Follow [docs/deployment.md](docs/deployment.md)
> (env vars, Caddy/nginx, Google OAuth, sessions) and [docs/chrome-web-store.md](docs/chrome-web-store.md)
> (permission justifications, privacy policy, reviewer account). The quick start below is for local use.

### Option A — Docker Compose (recommended)

```bash
git clone https://github.com/tiamed/Collectab.git && cd Collectab
docker compose up -d
```

This starts **PostgreSQL** and the API server. The server applies SQL migrations automatically on startup.

API: `http://localhost:3001/api`  
Postgres (host): `localhost:5432` — database `collectab`, user/password `postgres` / `postgres` (override with `POSTGRES_PASSWORD`).

> **Port conflict?** If port 5432 on the host is already taken (e.g. another PostgreSQL instance), edit `docker-compose.yml` and change the Postgres `ports` mapping to a free host port, e.g. `15433:5432`. The server connects to Postgres over the internal Docker network (`postgres:5432`), so its `DATABASE_URL` stays unchanged — only host-side access to the database moves to `localhost:15433`.

> Existing installs using the old database name `toby_bookmark` can keep their `DATABASE_URL` as-is, or rename the DB (`ALTER DATABASE toby_bookmark RENAME TO collectab`) and update the connection string.

> `docker compose up` pulls `ghcr.io/tiamed/collectab/server:latest`. To build locally: `docker compose up --build`.

### Option B — PostgreSQL + server separately

**1. Start PostgreSQL** (pick one):

```bash
# From this repo (Postgres only)
docker compose up postgres -d

# Or a one-off container (no compose)
docker run -d --name collectab-pg \
  -e POSTGRES_DB=collectab \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -v collectab-pgdata:/var/lib/postgresql/data \
  postgres:17-alpine
```

> If port 5432 is taken on the host, change `-p 5432:5432` to a free port (e.g. `-p 15433:5432`) and use that port in the server's `DATABASE_URL` below (e.g. `host.docker.internal:15433`).

Wait until ready:

```bash
docker compose exec postgres pg_isready -U postgres
# or: docker exec collectab-pg pg_isready -U postgres
```

**2. Run the API server** (image or local Node):

```bash
docker pull ghcr.io/tiamed/collectab/server:latest
docker run --rm -p 3001:3001 \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/collectab \
  -e BETTER_AUTH_SECRET=your-secret-at-least-32-chars-long \
  ghcr.io/tiamed/collectab/server:latest
```

On Linux, if `host.docker.internal` is unavailable, use the host gateway IP or run with `--network host` and `DATABASE_URL=...@127.0.0.1:5432/collectab`.

Migrations run on server start. To apply SQL manually instead:

```bash
# Compose Postgres
for f in server/src/database/migrations/*.sql; do
  docker compose exec -T postgres psql -U postgres -d collectab < "$f"
done

# One-off container
for f in server/src/database/migrations/*.sql; do
  docker exec -i collectab-pg psql -U postgres -d collectab < "$f"
done
```

### Configure the Extension

1. Install the extension (load unpacked from `extension/.output/chrome-mv3/` or install the `.zip` from Releases).
2. Open a new tab → **Settings** (gear icon), or expand **Server URL** in the sign-in dialog.
3. Enter your server, e.g. `https://api.example.com` (the `/api` suffix is added automatically) or `http://localhost:3001/api`.
4. Click **Save & Test**, then sign up / sign in.

Builds can ship with a default server: `WXT_API_BASE_URL=https://api.example.com pnpm build`.

### Environment Variables

Copy `server/.env.example` to `.env` (repo root, for docker compose) or `server/.env` (for `npm run dev`) and customize.
With `NODE_ENV=production` the server refuses to start if `BETTER_AUTH_SECRET` is the example value or `BETTER_AUTH_URL` is not `https://`.

**Required in production**

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | `production` enables secure cookies and startup config checks | `development` (image: `production`) |
| `DATABASE_URL` | PostgreSQL connection string (compose builds it from `POSTGRES_PASSWORD`) | `postgresql://postgres:postgres@localhost:5432/collectab` |
| `BETTER_AUTH_SECRET` | Session signing secret, ≥32 chars: `openssl rand -base64 32` | dev placeholder |
| `BETTER_AUTH_URL` | Public origin of the server, **no `/api`**: `https://api.example.com` | `http://localhost:3001` |
| `TRUST_PROXY` | `true` behind Caddy/nginx so rate limits use the real client IP | `false` |

**Extension, origins & sessions**

| Variable | Description | Default |
|----------|-------------|---------|
| `EXTENSION_IDS` | Chrome extension IDs (or `chrome-extension://…` / `moz-extension://` origins) allowed to sign in | empty = any extension |
| `CORS_ORIGIN` | Extra web origins allowed by CORS (`*` = any) | own origin + extension origins |
| `TRUSTED_ORIGINS` | Extra Better Auth trusted origins | — |
| `SESSION_EXPIRES_DAYS` | Sliding session lifetime (expires after this long unused) | `30` |
| `SESSION_UPDATE_AGE_HOURS` | How often an active session's expiry is extended | `24` |
| `PORT` / `HOST` | Listen address | `3001` / `0.0.0.0` |

**Sign-up, roles & quotas**

| Variable | Description | Default |
|----------|-------------|---------|
| `INVITE_MODE` | `open` (anyone can sign up) or `invite-only` | `open` |
| `DEFAULT_ROLE` | Role assigned on sign-up (`guest` / `user` / `admin`) | `guest` |
| `ADMIN_USER_IDS` | Comma-separated user IDs with admin privileges | — |
| `ROLE_QUOTAS` | Per-role bookmark quotas (`guest=10,user=500,admin=unlimited`) | default quotas |
| `DISABLE_QUOTAS` | `true` to disable all bookmark quotas | `false` |

**Optional integrations**

| Variable | Description | Default |
|----------|-------------|---------|
| `RESEND_API_KEY` | Enables password-reset and invitation emails | — |
| `RESEND_FROM_EMAIL` | From address for auth emails | `Collectab <noreply@collectab.app>` |
| `OAUTH_GOOGLE_CLIENT_ID` / `OAUTH_GOOGLE_CLIENT_SECRET` | Enables "Continue with Google" | — |
| `RATE_LIMIT_WINDOW_SECONDS` / `RATE_LIMIT_MAX` | `/api/auth/*` limit per IP and path (sign-in/up additionally 3 per 10 s) | `60` / `100` |
| `PRIVACY_OPERATOR_NAME` / `PRIVACY_CONTACT_EMAIL` | Shown on the `/privacy` page | — |

> **Production**: always set strong random `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD`, and serve over HTTPS.

### Authentication & Roles

- **Sessions**: Better Auth issues an opaque session token that the extension sends as `Authorization: Bearer …`. Sessions are sliding: they stay valid while used and expire after `SESSION_EXPIRES_DAYS` of inactivity. There is no refresh token. A 401 means the session is gone, and the extension signs out immediately instead of retrying.
- **Self-hosted control**: set `INVITE_MODE=invite-only` to require an invitation before anyone can register. In `open` mode (default), anyone can register and gets `DEFAULT_ROLE` (default `guest`).
- **Roles** control the bookmark quota: `guest` = 10 bookmarks, `user` = 500, `admin` = unlimited (adjust with `ROLE_QUOTAS`, or set `DISABLE_QUOTAS=true` to remove all limits). To create invites or change roles, set `ADMIN_USER_IDS` to your account's user ID (see `GET /api/auth/me`).
- **Create an invite** (from an admin account): `POST /api/admin/invite` with `{ "role": "user" }`. The response contains a shareable link. Invitees sign up themselves and set their own password; no email service required.
- **Email is optional**: without `RESEND_API_KEY`, private invites fall back to manual link sharing, and password-reset links are printed to the console in development only.
- **Google sign-in**: configure the `OAUTH_GOOGLE_*` variables and add the redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google` to a *Web application* OAuth client. The extension's `chromiumapp.org` redirect is handled by the server and does not need to be registered with Google. See [docs/deployment.md](docs/deployment.md#4-optional-google-sign-in).
- **Privacy policy**: every server serves one at `/privacy` (template in [docs/privacy-policy.md](docs/privacy-policy.md)).

---

## Development

### Extension

```bash
cd extension
pnpm install
pnpm dev          # Chrome dev mode with HMR
pnpm dev:firefox  # Firefox dev mode
pnpm build        # Production build
pnpm test         # Run vitest unit tests (CRDT order, transfer flow, drag-back)
pnpm zip          # Package as .zip for distribution
```

### Server

```bash
cd server
npm install
cp .env.example .env            # then set NODE_ENV=development
docker compose up postgres -d   # Start PostgreSQL (required)
# or: docker run -d --name collectab-pg -e POSTGRES_DB=collectab \
#      -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
#      -p 5432:5432 -v collectab-pgdata:/var/lib/postgresql/data postgres:17-alpine
npm run dev                     # migrations run automatically on startup
```

To apply migrations manually:

```bash
for f in src/database/migrations/*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
# or: npm run db:migrate
```

## CI / Release

- **CI** (`.github/workflows/ci.yml`) — builds extension and server on every push to `main` and on PRs.
- **Release** (`.github/workflows/release.yml`) — when a `v*` tag is pushed, builds and zips the extension, then creates a GitHub Release with the `.zip` attached.

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Tech Stack

- **Extension**: WXT + React 19 + Tailwind CSS v4 + Lucide icons
- **Server**: Hono + PostgreSQL + Drizzle ORM + Better Auth
- **Drag & Drop**: @dnd-kit/core + @dnd-kit/sortable
- **Real-time Sync**: Loro CRDT (loro-crdt) + WebSocket
