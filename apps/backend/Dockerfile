# Build from the repo root: `docker build -f apps/backend/Dockerfile .`
# (adapted from D:\website\cron-server\Dockerfile for a pnpm workspace monorepo
# where this backend is one package among the workspace's `apps/*`)
FROM node:22-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
# Workspace root files + the one member package.json needed to resolve the
# lockfile; no root package.json exists in this repo (pnpm treats the
# pnpm-workspace.yaml directory as the workspace root regardless).
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json
# Hoist deps so Prisma generates into node_modules/.prisma (pnpm's isolated layout hides it).
RUN echo "node-linker=hoisted" > .npmrc
# postinstall runs `prisma generate`; schema is not copied until the builder stage
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.npmrc ./.npmrc
COPY . .
# Next.js expects public/; this API-only app has no static assets yet.
RUN mkdir -p apps/backend/public
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
# Build does not need a real DB; a placeholder satisfies Prisma config parsing.
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
RUN pnpm --filter backend build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Cap V8's heap below the container's memory limit so it GCs aggressively
# instead of the kernel OOM-killing the container. Leaves headroom for
# off-heap buffers (Prisma engine, etc).
ENV NODE_OPTIONS=--max-old-space-size=384
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

# Next's standalone output mirrors the monorepo layout down to the detected
# workspace root: this unpacks a root-level node_modules plus
# apps/backend/{server.js,.next/*,...} directly into /app.
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/.next/static ./apps/backend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/public ./apps/backend/public
# Prisma CLI + schema for `docker compose run --rm app npx prisma migrate deploy`.
# pnpm scatters Prisma's engine packages (@prisma/engines, @prisma/get-platform, …)
# across node_modules/.pnpm, so cherry-picking @prisma + prisma misses them and the
# CLI can't resolve its engines. Copy the whole tree the builder already resolved —
# it also carries the client generated during `pnpm build`, so no regenerate is needed.
COPY --from=builder /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=builder /app/node_modules ./node_modules

USER nextjs
# Run from the package directory so Prisma's CLI finds ./prisma/schema.prisma
# by default; Node still resolves node_modules by walking up to /app/node_modules.
WORKDIR /app/apps/backend
EXPOSE 3000
CMD ["node", "server.js"]
