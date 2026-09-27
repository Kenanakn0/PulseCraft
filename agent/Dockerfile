# PulseCraft agent — örnek/demo container'ı (deploy/docker-compose.yml → `demo` profili).
# Container içinde çalışan agent, container'ın gördüğü CPU/RAM/disk/ağ değerlerini ölçer (Docker Desktop'ta
# CPU/RAM çoğunlukla Docker VM'inin değerleridir); gerçek bir sunucuyu izlemek için agent o sunucuda çalıştırılır.

# ---- 1. Derleme aşaması: Go toolchain'i burada, son imaja girmez ----
FROM golang:1.27-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/agent ./cmd/agent

# ---- 2. Çalışma aşaması: sadece binary, root olmayan kullanıcı ----
FROM alpine:3.24
RUN adduser -D -u 10001 app
USER app
COPY --from=build /out/agent /usr/local/bin/agent

# Anahtar ASLA imaja ya da komut satırına girmez: compose `secrets` ile dosya olarak bağlanır ve
# -api-key-file ile okunur (bkz. docker-compose.yml). Terminal olmadığı için anahtar yoksa agent
# açık bir hatayla (çıkış kodu 2) durur.
ENTRYPOINT ["agent"]
