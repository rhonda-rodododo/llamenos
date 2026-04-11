# Pin SHA — update via Dependabot or on new minor release.
FROM oven/bun:1@sha256:8956c7667fa17beb6e3c664115e66bdacfe502da5d99603626e74c197bdef160 AS base
WORKDIR /app

# Install dependencies. --ignore-scripts so the root package.json's prepare
# script (lefthook install) doesn't fire — the sip-bridge subproject has an
# empty scripts set but bun still runs root-package lifecycle hooks on some
# bun versions.
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile --ignore-scripts 2>/dev/null || bun install --ignore-scripts

# Copy source code
COPY src/ src/
COPY tsconfig.json ./

# Type check
RUN bun run typecheck

# Build
RUN bun build src/index.ts --outdir dist --target bun

# Production stage
FROM oven/bun:1@sha256:8956c7667fa17beb6e3c664115e66bdacfe502da5d99603626e74c197bdef160

# Upgrade Debian packages to pick up security patches released after the
# base image was built (e.g. libssl3t64 CVE-2026-28390 fix in deb13u2).
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=base /app/dist/ dist/
COPY --from=base /app/package.json ./

# Default environment variables
# PBX_TYPE: 'asterisk' (ARI) or 'freeswitch' (ESL)
ENV PBX_TYPE=asterisk

# Asterisk ARI (used when PBX_TYPE=asterisk)
ENV ARI_URL=ws://asterisk:8088/ari/events
ENV ARI_REST_URL=http://asterisk:8088/ari
ENV ARI_USERNAME=llamenos
# ARI_PASSWORD must be set at runtime — no default (CWE-798)

# FreeSWITCH ESL (used when PBX_TYPE=freeswitch)
ENV ESL_HOST=freeswitch
ENV ESL_PORT=8021
# ESL_PASSWORD must be set at runtime — no default (CWE-798)

# Shared
ENV WORKER_WEBHOOK_URL=https://your-worker.example.com
# BRIDGE_SECRET must be set at runtime — no default
ENV BRIDGE_PORT=3000
ENV BRIDGE_BIND=0.0.0.0
ENV STASIS_APP=llamenos

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "dist/index.js"]
