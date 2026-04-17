# Multi-stage Dockerfile for Llamenos (Bun self-hosted mode)
#
# Builds:
#   Stage 1: Dependencies (bun install)
#   Stage 2: Build frontend SPA
#   Stage 3: Production image (runs TypeScript source directly via Bun)
#
# Bun runs TypeScript natively — no bundling step required.

ARG BUILD_VERSION=dev
ARG BUILD_COMMIT=local
ARG BUILD_TIME=

# Stage 1: Install dependencies
FROM oven/bun:1@sha256:8956c7667fa17beb6e3c664115e66bdacfe502da5d99603626e74c197bdef160 AS deps
WORKDIR /app
COPY package.json bun.lock ./
# The @wireapp/core-crypto dependency is vendored as a `file:` dep; bun must
# be able to resolve it at install time or the whole install fails.
COPY vendor/ vendor/
RUN bun install --frozen-lockfile --ignore-scripts

# Stage 2: Build frontend SPA
FROM oven/bun:1@sha256:8956c7667fa17beb6e3c664115e66bdacfe502da5d99603626e74c197bdef160 AS frontend
WORKDIR /app
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules/ node_modules/
COPY src/ src/
COPY public/ public/
COPY crypto-sandbox/ crypto-sandbox/
COPY scripts/verify-no-console.sh scripts/verify-no-console.sh
COPY index.html vite.config.ts tsconfig.json ./
COPY tailwind.config.ts* ./
ARG BUILD_VERSION
ARG BUILD_COMMIT
ARG BUILD_TIME
ENV BUILD_VERSION=${BUILD_VERSION}
ENV BUILD_COMMIT=${BUILD_COMMIT}
ENV BUILD_TIME=${BUILD_TIME}
RUN bun run build

# Stage 3: Production
# Pin SHA — update via Dependabot or on new minor release.
FROM oven/bun:1-slim@sha256:d3c7094c144dd3975d183a4dbc4ec0a764223995bff73290d983edb47043a75f

# Upgrade Debian packages to pick up security patches released after the
# base image was built (e.g. libssl3t64 CVE-2026-28390 fix in deb13u2),
# then install curl for the healthcheck.
USER root
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r llamenos && useradd -r -g llamenos -d /app -s /sbin/nologin llamenos

WORKDIR /app

# Copy dependencies and TypeScript source (Bun runs TS natively)
COPY package.json ./
COPY --from=deps /app/node_modules/ node_modules/
COPY src/ src/
COPY drizzle/ drizzle/
COPY tsconfig.json ./

# Tier 4 PR-A: the API image NO LONGER serves the SPA. dist/client and
# dist/crypto-sandbox are baked into a separate Caddy stage below.

# Set build-time constants
ARG BUILD_VERSION=dev
ARG BUILD_COMMIT=local
ARG BUILD_TIME=
ENV BUILD_VERSION=${BUILD_VERSION}
ENV BUILD_COMMIT=${BUILD_COMMIT}
ENV BUILD_TIME=${BUILD_TIME}

# Set ownership
RUN chown -R llamenos:llamenos /app

# Switch to non-root user
USER llamenos

# Environment defaults
ENV PLATFORM=node \
    PORT=3000 \
    NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/api/health/live || exit 1

CMD ["bun", "src/server/server.ts"]

# Stage 4: Static asset Caddy — Tier 4 PR-A split origins.
#
# Bakes the built SPA (`dist/client/`) and the crypto sandbox
# (`dist/crypto-sandbox/`) into a caddy:2-alpine image so a single Caddy
# process can serve app.* + api.* + crypto.* as three distinct origins.
# The Caddyfile.production from deploy/docker/ is mounted at runtime so
# operators can tune site blocks without rebuilding the image.
FROM caddy:2-alpine@sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d AS static
COPY --from=frontend /app/dist/client/ /srv/app/
COPY --from=frontend /app/dist/crypto-sandbox/ /srv/crypto/
# Baseline Caddyfile — overridden by docker-compose volume mount.
RUN mkdir -p /etc/caddy && printf ':80 { respond 404 }\n' > /etc/caddy/Caddyfile
