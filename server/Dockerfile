# ---- 1. Derleme aşaması: Go toolchain'i burada, son imaja girmez ----
FROM golang:1.27-alpine AS build
WORKDIR /src

# Önce sadece bağımlılık dosyaları: kod değişse de bu katman cache'ten gelir.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
# CGO kapalı -> tamamen statik binary, alpine'de ekstra kütüphane gerekmez.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ---- 2. Çalışma aşaması: sadece binary ----
FROM alpine:3.21
RUN adduser -D -u 10001 app
USER app
COPY --from=build /out/server /usr/local/bin/server

EXPOSE 8080
ENTRYPOINT ["server"]
