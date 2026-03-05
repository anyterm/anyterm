# Build context: monorepo root (docker build -f apps/web/Dockerfile .)
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
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/utils/package.json packages/utils/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --prod=false

# -----------------------------------------------------------
# Stage 3: build — compile utils + db + next build (standalone)
# -----------------------------------------------------------
FROM deps AS build
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:3001
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_PREVIEW_ORIGIN=
ENV NEXT_PUBLIC_PREVIEW_ORIGIN=$NEXT_PUBLIC_PREVIEW_ORIGIN

COPY tsconfig.base.json ./
COPY packages/utils packages/utils
COPY packages/db packages/db
COPY apps/web apps/web
RUN pnpm --filter @anyterm/utils build && \
    pnpm --filter @anyterm/db build && \
    pnpm --filter @anyterm/web build

# -----------------------------------------------------------
# Stage 4: runner — minimal production image
# -----------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy Next.js standalone output
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static

# Copy drizzle migrations + deps for auto-migrate on startup
COPY --from=build /app/packages/db/drizzle packages/db/drizzle
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/package.json packages/db/package.json
COPY --from=build /app/node_modules/drizzle-orm node_modules/drizzle-orm
COPY --from=build /app/node_modules/postgres node_modules/postgres

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=10s --timeout=3s --start-period=120s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

CMD ["sh", "-c", "if [ \"$SKIP_MIGRATIONS\" != \"1\" ]; then node -e \"import('./packages/db/dist/migrate.js').then(m => m.runMigrations(process.env.DATABASE_URL))\"; fi && exec node apps/web/server.js"]
