# ---- Build stage: the Go toolchain stays here ----
FROM golang:1.27-alpine AS build
WORKDIR /src

# Dependency files first, so this layer stays cached when only code changes.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
# CGO off: a fully static binary that needs no libraries in the runtime image.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ---- Runtime stage: the binary only, as a non-root user ----
FROM alpine:3.24
RUN adduser -D -u 10001 app
USER app
COPY --from=build /out/server /usr/local/bin/server

EXPOSE 8080
ENTRYPOINT ["server"]
