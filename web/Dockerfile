# PulseCraft web: React derlemesi (Node) -> statik dosyaları sunan nginx.
#
# ÖNEMLİ: build context REPO KÖKÜDÜR (deploy/nginx yapılandırmasını da imaja almak için):
#   docker build -f web/Dockerfile .          (compose bunu kendisi yapar)
# Context'e neyin gireceği web/Dockerfile.dockerignore'da (yalnızca web/ ve nginx yapılandırması).

# --- 1) Derleme aşaması: yalnızca derleme için gereken Node burada kalır, çalışma imajına girmez ---
# (C#'ta multi-stage: SDK imajında `dotnet publish`, sonra yalnızca çıktıyı runtime imajına kopyalamak.)
FROM node:24-alpine AS build
WORKDIR /app/web

# Önce yalnızca bağımlılık dosyaları: kaynak kodu değişince `npm ci` katmanı önbellekten gelir.
COPY web/package.json web/package-lock.json ./
# ci: package-lock.json'a birebir uyar (install gibi kilit dosyasını değiştirmez); betikler kapalı
# (bağımlılıkların kurulum betikleri çalışmasın; Playwright tarayıcı indirmesi de burada gereksiz).
RUN npm ci --ignore-scripts

COPY web/ ./
# tsc (tip denetimi) + vite build. Lint ve testler CI'da/yerelde çalışır; imaj derlemesini yavaşlatmaz.
RUN npm run build

# --- 2) Çalışma aşaması: yalnızca nginx + statik dosyalar (Node YOK) ---
FROM nginxinc/nginx-unprivileged:stable-alpine
COPY deploy/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
# Runs as the unprivileged nginx user and listens on 8080 (see default.conf and the compose healthcheck).
