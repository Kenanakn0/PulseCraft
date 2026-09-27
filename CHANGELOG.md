# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). The Go modules are tagged alongside the repository
(`agent/vX.Y.Z`, `server/vX.Y.Z`).

## [Unreleased]

## [1.0.0] - 2026-09-27

First public release.

### Agent
- Collects CPU %, memory % and used bytes, disk %, network throughput (bytes/s) and load average.
- Bounded in-memory buffer (1000 samples) with exponential backoff and batched sends.
- API key from a file (`-api-key-file`) or a hidden interactive prompt; never required on the command line.
- Sends a hostname only when configured; distinct exit codes for configuration errors (2) and rejected keys (3).
- Example container in the `demo` compose profile.

### Server
- REST API for servers, metrics, alert rules and alerts; WebSocket live stream via Redis pub/sub.
- Idempotent ingest (`UNIQUE (node_id, time)`, one `INSERT … ON CONFLICT DO NOTHING` per batch).
- Alert engine with durations based on sample time, one active alert per rule and server, and atomic
  acknowledgement; disabling, narrowing or deleting a rule (or deleting a server) resolves its open alerts.
- TimescaleDB hypertable with compression, retention and a 1-minute continuous aggregate.
- Sessions: bcrypt, HS256 JWT in an `HttpOnly` + `SameSite=Strict` cookie, server-side logout that also
  closes the session's WebSocket, login rate limit, cross-origin request protection, request size limits.

### Web
- React + TypeScript dashboard (Turkish UI): live server list, detail page with gauges and charts
  (15 min / 1 h raw and live, 6 h / 24 h aggregated), shared alert board, alert rule management,
  adding and deleting servers.
- Idempotent handling of live events with REST resynchronisation after reconnects.

### Deployment and operations
- Single `docker compose up`; only nginx is published (on `127.0.0.1`), with a strict CSP and security
  headers, running as an unprivileged user. PostgreSQL and Redis are password protected and internal.
- Fail-fast configuration: missing secrets and placeholder or weak demo passwords stop the stack at startup.
- CI: Go (with the race detector), web checks and an end-to-end run against the real compose stack.
- Dependabot with grouped minor/patch updates that merge automatically once CI passes.

[Unreleased]: https://github.com/Kenanakn0/PulseCraft/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Kenanakn0/PulseCraft/releases/tag/v1.0.0
