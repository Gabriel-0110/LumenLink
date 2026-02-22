FROM node:22-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# Copy source
COPY tsconfig.json ./
COPY src/ src/

# Build
RUN pnpm run build

# Keep only production dependencies for runtime image
RUN pnpm prune --prod

# ── Production stage ─────────────────────────────────────────────
FROM node:22-alpine AS production

# Run as non-root user
RUN addgroup -S lumenlink && adduser -S lumenlink -G lumenlink

WORKDIR /app

COPY --from=base /app/package.json ./package.json
COPY --from=base /app/node_modules ./node_modules
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
