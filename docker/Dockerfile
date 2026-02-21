FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile || pnpm install

COPY . .
RUN pnpm run build

EXPOSE 8080
CMD ["node", "dist/src/index.js"]
