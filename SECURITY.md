# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub:
**Security → Report a vulnerability** on this repository. Include the affected component (agent, server,
web, deployment), steps to reproduce and the impact you expect.

You can expect an acknowledgement within a week. Once a fix is available it will be released and the
report credited unless you prefer otherwise.

## Supported versions

Fixes go into `main` and the next release; only the latest release is supported (see
[CHANGELOG.md](CHANGELOG.md)).

## Scope and assumptions

PulseCraft is a portfolio project designed to run on a trusted host or private network:

- The compose stack publishes only nginx, on `127.0.0.1`, and has no TLS termination. Exposing it beyond
  localhost requires an HTTPS reverse proxy in front of nginx and `COOKIE_SECURE=true`.
- Revoked sessions and the login rate limiter are kept in memory and assume a single server instance.
- PostgreSQL and Redis are password protected and reachable only on the internal Docker network (the
  development override also publishes them on host loopback).

Reports about these documented limitations are still welcome if you see a concrete attack path.
