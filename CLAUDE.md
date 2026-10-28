# omero-social-post

## What this project does
Open-source, self-hosted, single-user social media publisher: a personal alternative to Typefully/Metricool, built from scratch and in public.
It connects social networks through their official OAuth, lets the owner compose posts (text, images, X threads) with per-network adjustments, and schedules them on a calendar.
Later stages add a daily AI news digest that turns chosen sources into draft posts, a mobile app, and Instagram/Facebook.

Postiz (AGPL-3.0) is a product and architecture reference only. Do not copy its code unless the project's license is compatible and attribution is kept.

## Stack
- pnpm monorepo
- Next.js (web), NestJS (API + scheduler), PostgreSQL
- React Native / Expo for the mobile app (later stage)
- Docker Compose deployment on a small VPS (1 vCPU / 4 GB), private behind Tailscale

Details are confirmed in each cycle's technical spec under `AiBuild/`.

## Project structure
- `AiBuild/` — Spec Driven Development cycles (functional spec, technical spec, plan, meta.json)
- `apps/web/` — Next.js app (TBD)
- `apps/api/` — NestJS API and scheduler (TBD)
- `apps/mobile/` — Expo app (later stage)
- `packages/` — shared code (TBD)
- `infra/` — Docker Compose and server bootstrap (TBD)

## Conventions
- **Specs and code comments:** English. Conversation with the owner: Spanish.
- **Secrets:** all configuration comes from environment variables. Never commit secrets; gitleaks runs in pre-commit and CI.
- **Official APIs only:** no scraping or unofficial endpoints.
- **Resource budget:** keep the footprint small enough for 1 vCPU / 4 GB.

## SDD Features
- `mvp/core-publishing` — in progress: X + LinkedIn publishing, composer, calendar, scheduler.
