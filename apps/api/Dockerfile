# syntax=docker/dockerfile:1
#
# Production image for the NestJS API (HTTP + BullMQ workers in one process).
# Build from the repo root:
#     docker build -f apps/api/Dockerfile -t omero-api .
#
# Stages:
#   base   Node 22 (Debian bookworm, glibc) with pnpm via corepack
#   deps   pnpm store filled from the lockfile only (cached until pnpm-lock.yaml changes)
#   build  offline install, build @omero/api and its workspace deps, `pnpm deploy` a prod-only tree
#   run    minimal runtime: tini, non-root `node` user, dist + migrations + prod node_modules

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
WORKDIR /repo
# Install the exact pnpm version pinned in `packageManager`.
COPY package.json ./
RUN corepack enable && corepack install && pnpm config set store-dir /pnpm/store

FROM base AS deps
# Toolchain only as a fallback: argon2 and sharp ship prebuilt glibc binaries, but if a
# prebuild is ever missing for the target platform node-gyp can still compile it here.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# `pnpm fetch` needs only the lockfile, so this layer (the whole store) stays cached
# across source changes. It lives in the layer rather than a cache mount so the GitHub
# Actions layer cache (type=gha) can reuse it.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile
# Builds @omero/api plus every workspace package it depends on (e.g. @omero/shared), in order.
RUN pnpm --filter "@omero/api..." run build
# Production-only node_modules with workspace deps copied in (not symlinked).
# pnpm 10 only deploys injected workspaces by default; --legacy keeps the classic behaviour
# without switching the whole repo to inject-workspace-packages.
RUN pnpm --filter @omero/api deploy --prod --legacy --offline /out

FROM ${NODE_IMAGE} AS run
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    MEDIA_DIR=/data/media \
    NODE_OPTIONS=--max-old-space-size=512

WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
# Migrations run at boot (main.ts) and are resolved from dist/src/db up to /app/drizzle.
COPY --from=build --chown=node:node /out/drizzle ./drizzle

# Media directory owned by `node`. A named volume mounted here on first use inherits this
# ownership. No VOLUME instruction: compose declares the named volume, and an anonymous
# volume per `docker run` would only pile up.
RUN mkdir -p /data/media && chown node:node /data/media

USER node
EXPOSE 4000

# The slim image has no curl/wget; Node 22 has fetch built in. 503 (a dependency down) fails the check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# tini reaps zombies and forwards SIGTERM so Nest shuts down workers gracefully.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/main.js"]
