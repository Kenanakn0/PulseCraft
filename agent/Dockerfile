# PulseCraft agent as an example container (the `demo` profile in deploy/docker-compose.yml).
# Inside a container the agent measures what the container sees (on Docker Desktop CPU/RAM mostly belong to
# Docker's VM); to monitor a real server, run the agent on that server.

# ---- Build stage: the Go toolchain stays here ----
FROM golang:1.27-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/agent ./cmd/agent

# ---- Runtime stage: the binary only, as a non-root user ----
FROM alpine:3.24
RUN adduser -D -u 10001 app
USER app
COPY --from=build /out/agent /usr/local/bin/agent

# The key never enters the image or the command line: compose mounts deploy/secrets read-only and the agent
# reads it with -api-key-file. There is no terminal to ask on, so without a key the agent exits with code 2.
ENTRYPOINT ["agent"]
