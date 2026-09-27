# PulseCraft web: React build (Node) -> static files served by nginx.
#
# The build context is the REPOSITORY ROOT (to include the deploy/nginx config):
#   docker build -f web/Dockerfile .          (compose does this itself)
# web/Dockerfile.dockerignore limits the context to web/ and the nginx config.

# ---- Build stage: Node stays here and never reaches the runtime image ----
FROM node:26-alpine AS build
WORKDIR /app/web

# Dependency files first, so `npm ci` stays cached when only source files change.
COPY web/package.json web/package-lock.json ./
# Install scripts are disabled: no dependency install hooks, and no Playwright browser download.
RUN npm ci --ignore-scripts

COPY web/ ./
# Type check + vite build. Lint and tests run in CI, not in the image build.
RUN npm run build

# ---- Runtime stage: nginx and the static files only ----
FROM nginxinc/nginx-unprivileged:stable-alpine
COPY deploy/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
# Runs as the unprivileged nginx user and listens on 8080 (see default.conf and the compose healthcheck).
