# Build context: monorepo root (docker build -f apps/server/Dockerfile .)
# -----------------------------------------------------------
# Stage 1: base — node + pnpm
# -----------------------------------------------------------
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# -----------------------------------------------------------
# Stage 2: deps — install all monorepo dependencies
# -----------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/utils/package.json packages/utils/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --prod=false

# -----------------------------------------------------------
# Stage 3: build — compile utils + db + server
# -----------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/utils packages/utils
COPY packages/db packages/db
COPY apps/server apps/server
RUN pnpm --filter @anyterm/utils build && \
    pnpm --filter @anyterm/db build && \
    pnpm --filter @anyterm/server build

# -----------------------------------------------------------
# Stage 4: runner — minimal production image
# -----------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy built artifacts and production node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/packages/utils/dist packages/utils/dist
COPY --from=build /app/packages/utils/package.json packages/utils/package.json
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/package.json packages/db/package.json
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/pnpm-workspace.yaml pnpm-workspace.yaml

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 hono

USER hono

EXPOSE ${PORT:-3001}
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-${WS_PORT:-3001}}/health || exit 1

CMD ["node", "apps/server/dist/index.js"]
