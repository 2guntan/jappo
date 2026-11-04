# Jappo — block farm finance

Jappo (Wolof: "join forces") turns block farms into financeable, monitored credit transactions. See `SPEC.md` (what) and `AGENTS.md` (how). Progress and decisions: `docs/PROGRESS.md`, `docs/DECISIONS.md`.

## Quick start (dev)

```bash
pnpm install
cp .env.example .env
pnpm infra:up            # postgis/postgis:16-3.4, MinIO, Mailpit
pnpm seed                # migrations + reference data + platform admin
pnpm dev                 # API :4000 (OpenAPI /v1/docs), web :3000, worker
```

Admin: `admin@jappo.local` / `SEED_ADMIN_PASSWORD`, TOTP secret `SEED_ADMIN_TOTP_SECRET` (add it to an authenticator app).

## Checks

```bash
pnpm verify              # typecheck, lint, OpenAPI lint (Spectral), unit, integration (Testcontainers PostGIS), Playwright phase specs
pnpm e2e:full            # SPEC §17.1 full lifecycle acceptance scenario (golden WF-1 figures end to end)
pnpm --filter @jappo/api coverage   # API integration coverage (≥ 70 % lines; domain ≥ 90 % enforced in its tests)
pnpm sdk:gen             # regenerate packages/sdk from the API's OpenAPI document
pnpm docs:api            # regenerate docs/API.md from the OpenAPI document
pnpm db:generate         # new SQL migration from Drizzle schema changes
```

## Production

`infra/docker-compose.prod.yml` (Caddy, web, api ×2, worker, PostGIS, MinIO, nightly backups) — see `docs/RUNBOOK.md` for install, upgrade, backup/restore, key rotation and incidents; `docs/API.md` lists every endpoint with its permission.

## Layout

`apps/api` Fastify modular monolith · `apps/worker` outbox/jobs · `apps/web` Next.js (public site, workspaces, `/field` PWA) · `packages/domain` pure engines · `packages/contracts` Zod schemas · `packages/sdk` generated client · `packages/templates` fr/en templates · `infra/` compose, Docker, backup.
