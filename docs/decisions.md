# Design decisions

The reasoning behind PulseCraft's main technical choices, the problems that shaped them, and the trade-offs
that were accepted. For setup and usage see the [README](../README.md).

## Architecture

- **Two Go modules** (`agent/`, `server/`) in one repository, each with the standard `cmd/` + `internal/`
  layout. The agent has no dependency on the server code; the only contract between them is the HTTP API.
- **Same-origin deployment**: nginx serves the React build and reverse-proxies `/api/` and `/ws` to the
  server. The browser therefore sees a single origin: no CORS, the session cookie can be `SameSite=Strict`,
  and the WebSocket `Origin` check can be strict. The Vite dev server plays the same role in development
  (its proxy must *not* use `changeOrigin`, or the `Origin`/`Host` comparison fails).
- **Only nginx is published to the host**, on `127.0.0.1`. The server, PostgreSQL and Redis stay on the
  internal Docker network; a separate development override publishes the databases on loopback for local
  tools and integration tests.
- **Redis requires a password.** It is handed to `redis-server` on stdin rather than as an argument, so it
  never shows up in the process list, and connection URLs are stripped from logged errors.
- Router: `chi` (close to `net/http`, middleware-friendly). Database: `pgx` with a connection pool.
  WebSocket: `coder/websocket`.

## Storage

- **PostgreSQL 16 + TimescaleDB.** `metrics` is a hypertable in a *wide* layout — one row per sample with
  a column per metric (`cpu_percent`, `mem_percent`, `mem_used_bytes`, `disk_percent`, `net_rx_bps`,
  `net_tx_bps`, `load1`) — because all metrics of a sample are always written and read together.
- Retention: chunks are compressed after 7 days, raw data is kept for 30 days, and a 1-minute continuous
  aggregate (`metrics_1m`) is kept for 180 days. Queries up to 3 hours read raw data, longer ranges read
  the aggregate.
- `load1` is nullable (not every platform provides it).
- The schema is loaded from `deploy/init/01_schema.sql` on the first start of an empty volume; there is
  no migration tool yet, so a schema change means recreating the volume or writing a migration by hand.

## Ingest

- The agent authenticates with a per-server **API key** (256 random bits). Only its SHA-256 hash is
  stored; the plain key is returned exactly once, when the server is created.
- **Idempotent writes**: `UNIQUE (node_id, time)` plus a single
  `INSERT … SELECT FROM unnest($arrays…) ON CONFLICT DO NOTHING` per batch. The agent retries a batch
  after a timeout, and without the constraint a slow response could duplicate rows. `COPY` was replaced
  because it cannot skip conflicts. The same unique index also serves the "latest sample per server"
  lookup. Duplicate samples aimed at already-compressed chunks are skipped without errors.
- `last_seen_at` is set to the **server's** receive time, not the sample time, so online status is immune
  to wrong agent clocks.
- The optional `hostname` field is validated (trimmed, ≤ 253 bytes, valid UTF-8, no control characters).
  An invalid hostname is ignored with a warning; the samples are still accepted.

## Agent

- Metrics come from `gopsutil`. Network throughput is computed from the difference of two counter
  readings (bytes per second).
- **Resilience**: a bounded in-memory buffer (1000 samples, oldest dropped first) with exponential backoff
  (1 s → 60 s) and batched sends, so a server restart does not lose data.
- **The API key never appears on the command line.** Order of sources: flag/env (kept for compatibility,
  prints a warning) → key file (`-api-key-file`, handles UTF-8 BOM and the UTF-16 files that Windows
  PowerShell 5.1 writes by default) → a hidden interactive prompt when stdin is a terminal. The key is
  validated locally (64 hex characters) with an error message that never echoes the key. This design came
  from a real failure: copying a command overwrote the clipboard that was supposed to hold the key.
- **Privacy**: the agent sends a hostname only when explicitly configured; it never reads the machine name.
- Distinct exit codes (`2` configuration, `3` key rejected) so that supervisors such as Docker's
  `restart: on-failure:3` stop instead of looping forever on a permanent error.
- The example container mounts a *directory* of secrets rather than a single file: when a bind-mounted
  file is missing, Docker Desktop silently creates an empty directory in its place.

## Alerting

- Rules (metric, operator, threshold, optional duration, severity, all servers or one) are cached in memory
  and refreshed every 30 s and after every change.
- The engine evaluates **every** sample, and durations use **sample timestamps**, so a backlog delivered
  late is still evaluated as it happened. Engine state (`breachStart`, active alerts) is protected by a
  mutex; events are published after the lock is released.
- At most one active alert per rule and server is enforced by a **partial unique index**; the insert uses
  `ON CONFLICT DO NOTHING` as a safety net. Open alerts are reloaded from the database on restart.
- Disabling a rule, or narrowing its scope, **resolves** its open alerts immediately (with events) instead
  of leaving them orphaned. Deleting a rule resolves them first, then deletes the rule (its alert history
  goes with it via cascade) and announces the deletion. Deleting a server works the same way. Disabling
  keeps history; deleting does not, and the UI says so.
- Acknowledge is a single atomic `UPDATE … WHERE status = 'open'`: a second click, or a second user,
  gets `409`. The acknowledging user is recorded and shown to everybody.
- Only CPU, RAM and disk are offered as rule metrics in the UI.

## Real-time delivery

- The server publishes to Redis (`pulsecraft:metrics`, `pulsecraft:alerts`); each server instance
  subscribes and fans out to its WebSocket clients through a hub with a **bounded queue per client**. A
  client that cannot keep up is disconnected instead of slowing down the others.
- Only the **newest sample per request** is broadcast. Broadcasting a whole 1000-sample backlog overflowed
  healthy clients' queues during testing; history is read over REST anyway. The alert engine still sees
  every sample.
- Publishing is **asynchronous** (a bounded queue and a single worker). When it was synchronous, a Redis
  outage slowed ingest by 2–4 s, close to the agent's timeout, which then re-sent batches.
- Consequence: **WebSocket events can be missing, late or duplicated.** The frontend therefore treats them
  as hints:
  - events are applied **idempotently** (for metrics, older-or-equal samples are ignored; alert states
    only move forward along `open → acknowledged → resolved`);
  - state is **re-synchronised from REST after every reconnect**, and alerts additionally every 60 s as a
    safety net (a Redis outage can lose events while the WebSocket itself stays open);
  - a sequence counter makes sure a REST snapshot never erases events that arrived while it was loading.
- Close codes: `4401` means the session ended (logout or expiry) — the client does *not* reconnect and
  shows the login page. Anything else (`1006`, `1008`, network loss) reconnects with exponential backoff
  and jitter (1 s → 30 s).

## Authentication and sessions

- Scope is deliberately minimal: demo users seeded from `.env` (upserted on every start), bcrypt hashes,
  no registration, password reset or roles.
- **JWT (HS256) in an `HttpOnly`, `SameSite=Strict` cookie**, 8-hour lifetime; the accepted algorithm list
  is fixed (no algorithm confusion, no `none`) and `exp` is required. `Secure` is enabled with
  `COOKIE_SECURE=true` behind HTTPS.
- `JWT_SECRET` must be at least 32 characters or the server refuses to start. The example `.env` leaves it
  empty on purpose, so that no publicly known secret exists.
- **Logout is real**: the token's `jti` goes into an in-memory denylist (trade-off: it resets on restart;
  no schema change or Redis dependency). Open WebSockets of that session are closed with `4401` — also at
  token expiry.
- **Login rate limit**: 10 attempts per minute per IP (IPv6 grouped by /64). Unknown user and wrong
  password return the same message and take the same time (a dummy bcrypt comparison).
- **Client IP**: `X-Forwarded-For` is honoured only when the direct peer is a trusted proxy, and the chain
  is read right to left. nginx has a fixed address in a fixed subnet, it *overwrites* the header, and that
  address is the only trusted proxy.
- **Every route requires a session** except health, login/logout and the agent's ingest endpoint. A test
  walks all registered routes and fails if a new one is left unprotected.
- **Cross-origin protection**: `SameSite=Strict` stops *cross-site* requests but not other origins on the
  same site (another localhost port, a sibling subdomain), which still receive the cookie. State-changing
  requests are therefore checked with Go's `http.CrossOriginProtection` (`Sec-Fetch-Site`, falling back to
  `Origin` vs. `Host`). The agent sends neither header and is unaffected.
- **Fail-fast configuration**: missing secrets, a placeholder database password or placeholder/common demo
  passwords stop the server (or compose) at startup instead of running with values published in the
  repository.
- **Request limits**: 2 MiB per body (enforced in the server too, not only nginx) and 5000 samples per
  ingest request — well above the agent's 1000-sample buffer.

## Web delivery

- nginx sets a strict **Content-Security-Policy** (no inline scripts or styles), `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy` and `Permissions-Policy`. Headers are set at server level only, because an
  `add_header` inside a `location` would silently drop the inherited ones.
- Hashed assets are cached for a year; `index.html` is never cached; unknown assets return 404 instead of
  the SPA fallback.
- nginx resolves the server through Docker's DNS at request time, so recreating the server container
  (new IP) does not break the proxy.
- The runtime image contains only nginx and the static build (no Node.js); it is the unprivileged nginx
  image, so the master process does not run as root.
- Base images are pinned (TimescaleDB to an exact version, because a database volume must never be
  opened by an older extension than the one that created it) and kept current by Dependabot.

## Frontend

- React + TypeScript + Vite, React Router, hand-written data hooks (no data-fetching library), Chart.js,
  plain CSS with custom properties for the light and dark themes. The UI language is Turkish.
- **Online status never depends on the browser clock**: the server returns `online` and
  `last_seen_seconds_ago`; live events mark a server online, and a *timer* (not a clock difference) marks
  it offline after 15 s of silence. Times are shown as absolute timestamps; alert durations are computed
  from server timestamps.
- **Charts**: animation off, pre-parsed `{x, y}` data, LTTB decimation, a sliding window with a fixed
  width, gaps are not bridged. Live points are appended only to raw ranges (15 min / 1 h), never mixed into
  the 1-minute aggregate. Both detail charts use a fixed y-axis width so that their plot areas line up.
- Polling (10 s servers, 30 s rules, 60 s alerts) stays on as a safety net next to the live stream;
  requests never overlap (recursive timeouts with abort on cleanup).

## Testing

- Go: unit tests plus integration tests against a real PostgreSQL/TimescaleDB and Redis (alert SQL and
  published events cannot be meaningfully faked). They are skipped without their environment variables;
  CI fails if they are skipped.
- Frontend: Vitest + Testing Library for logic and components; Playwright against the real stack for
  end-to-end flows — including two separate users, WebSocket-only updates (REST responses frozen), a
  server restart, and logout from another tab.
- Test changes were checked with **mutation testing by hand**: deliberately breaking a guarded behaviour
  must make a test fail; when it did not, a test was added.
- Lessons that shaped the suite:
  - wait until the live connection is established before triggering events, and wait for a request to
    finish before navigating away (otherwise the browser cancels it);
  - log in **once per user** in a setup project and share the session, so the suite stays below the login
    rate limit;
  - an automatic cleanup fixture removes test data even when a test fails; leftovers from aborted runs
    had produced confusing counts in later runs;
  - run everything against a **throw-away stack** with fake credentials, never against real data. CI does
    this with random one-time credentials on every run.
- README screenshots are generated by a Playwright script from fictional data on an empty stack.
