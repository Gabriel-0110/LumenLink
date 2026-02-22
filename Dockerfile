FROM node:22-slim AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# Copy source
COPY tsconfig.json ./
COPY src/ src/

# Build
RUN pnpm run build

# ── Production stage ─────────────────────────────────────────────
FROM node:22-slim AS production

RUN corepack enable && corepack prepare pnpm@9 --activate
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Run as non-root user
RUN groupadd -r lumenlink && useradd -r -g lumenlink -m lumenlink

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=base /app/dist ./dist

# Data directory for SQLite
RUN mkdir -p /data && chown lumenlink:lumenlink /data
VOLUME /data

USER lumenlink

ENV NODE_ENV=production
ENV DB_PATH=/data/runtime.sqlite

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/src/index.js"]
