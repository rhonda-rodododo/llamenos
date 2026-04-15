FROM oven/bun:1-slim@sha256:d3c7094c144dd3975d183a4dbc4ec0a764223995bff73290d983edb47043a75f
WORKDIR /app
COPY package.json ./
RUN bun install
COPY tsconfig.json ./
COPY src/ ./src/
RUN mkdir -p /app/data
ENV NOTIFIER_DB_PATH=/app/data/notifier.db
EXPOSE 3100
CMD ["bun", "run", "src/server.ts"]
