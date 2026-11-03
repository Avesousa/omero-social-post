# syntax=docker/dockerfile:1
#
# Production image for the Next.js web app (standalone output).
# Build from the repo root:
#     docker build -f apps/web/Dockerfile -t omero-web .
#
# The `/api/*` rewrite to the API is resolved when `next build` runs, so the API's internal
# URL is a build argument, not a runtime variable. The default matches the compose service
# name; rebuild the image if the API lives elsewhere.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
# Install the exact pnpm version pinned in `packageManager`.
COPY package.json ./
RUN corepack enable && corepack install && pnpm config set store-dir /pnpm/store

FROM base AS deps
# The store depends only on the lockfile, so this layer survives source changes
# (and is reusable from the GitHub Actions layer cache).
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --frozen-lockfile

FROM deps AS build
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
COPY . .
RUN pnpm install --offline --frozen-lockfile
# Builds @omero/web plus its workspace deps (@omero/api-client, ...), in dependency order.
RUN NODE_ENV=production pnpm --filter "@omero/web..." run build
# `public/` is optional in Next.js; make sure the COPY below has something to copy.
RUN mkdir -p apps/web/public

FROM ${NODE_IMAGE} AS run
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NODE_OPTIONS=--max-old-space-size=384

WORKDIR /app
# Standalone output mirrors the monorepo layout: server.js lives in apps/web/ and the traced
# node_modules sit at the root. Static assets and public/ are not part of it and are added here.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public

USER node
EXPOSE 3000

# Any non-5xx answer on / means the server is up (the page may redirect to login/setup).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"]

# tini as PID 1: forwards SIGTERM to Node and reaps zombies (e.g. finished healthcheck processes).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
