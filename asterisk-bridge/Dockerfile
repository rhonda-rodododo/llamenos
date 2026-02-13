FROM oven/bun:latest AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source code
COPY src/ src/
COPY tsconfig.json ./

# Type check
RUN bun run typecheck

# Build
RUN bun build src/index.ts --outdir dist --target bun

# Production stage
FROM oven/bun:latest
WORKDIR /app

COPY --from=base /app/dist/ dist/
COPY --from=base /app/package.json ./

# Environment variables (set at runtime)
ENV ARI_URL=ws://asterisk:8088/ari/events
ENV ARI_REST_URL=http://asterisk:8088/ari
ENV ARI_USERNAME=llamenos
ENV ARI_PASSWORD=changeme
ENV WORKER_WEBHOOK_URL=https://your-worker.example.com
ENV BRIDGE_SECRET=changeme
ENV BRIDGE_PORT=3000
ENV STASIS_APP=llamenos

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "dist/index.js"]
