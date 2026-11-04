# Progress

Source of truth for the next session. Phases from SPEC §17. Update after every phase.

## Phases

- [x] P0 Scaffold
- [x] P1 Identity & core
- [x] P2 Land & farmers
- [x] P3 Catalogue, planning, offtake
- [ ] P4 Model, readiness, dossier
- [ ] P5 Marketplace
- [ ] P6 Agreements & facilities
- [ ] P7 Operations & harvest
- [ ] P8 Settlement
- [ ] P9 Monitoring
- [ ] P10 Commercial
- [ ] P11 Hardening & acceptance

## P0 Scaffold — done

Built: pnpm/turbo monorepo; `infra/docker-compose.yml` (PostGIS 16-3.4, MinIO, Mailpit); Fastify 5 app with problem+json errors, cursor pagination helpers, Idempotency-Key plugin, ETag/If-Match helpers, request ids, Helmet, CORS, rate limit, `/health`, `/ready`, `/metrics`, OpenAPI 3.1 at `/v1/openapi.json` + UI at `/v1/docs`; every `/v1` route must declare `operationId` + `x-permission` (enforced at boot). SDK generation (`pnpm sdk:gen`). Next.js 15 shell with next-intl (fr default, en), Tailwind 4, TanStack Query. Dockerfiles (`infra/docker/*`), CI (`.github/workflows/ci.yml`). Worker app (`apps/worker`) bundling the API job runners.

## P1 Identity & core — done

API: signup (org + admin), email verification, login (password + TOTP), lockout (10 failures / 15 min), phone OTP login (3 req / 10 min / phone, 5 attempts), refresh rotation with reuse detection (family revocation), CSRF double-submit on cookie routes, logout, password reset, TOTP enrolment (forced for platform_admin / credit_committee), `/me`, org profile (ETag), KYC documents (multipart, MIME sniffing) + submit, admin KYC queue verify/reject, suspend/reactivate, members (roles per org type, last-admin guard), invitations (email/SMS, accept new/existing user), API keys (hashed, shown once), org directory, files (S3/fs, signed URLs, grant-aware visibility), notifications (in-app/email/SMS, worker delivery), audit hash chain + verify endpoint + nightly job, transactional outbox + dispatcher, access grants + visibility helpers, ref sequences, module registry + `/v1/modules`, legal texts endpoint.
Web: landing, signup, login (TOTP + SMS), forgot/reset password, verify email, invitation accept, app shell (sidebar from `/v1/modules`, org switcher, locale switcher, notifications bell), home with KYC/next-steps, organisation settings + KYC upload/submit, members & invitations, API keys, security (MFA), notifications, admin KYC queue + review, audit log with chain verification.
Tests: domain unit (100 % lines), API unit (permissions, crypto, sniffing, module graph), 30 integration tests (auth, MFA, OTP, KYC, members, API keys, files, idempotency, ETag, audit tampering, outbox, refs, OpenAPI) incl. `authz.spec.test.ts` negative suite, Playwright `p1-identity.spec.ts` (signup → KYC → admin verify → invite → accept → login). `pnpm verify` green.
Known limitations: farmer OTP routes arrive with the farmer portal (D-017); rate-limit counters are per API replica (D-014).

## P2 Land & farmers — done

API: farmers CRUD with AES-GCM encrypted national id / wallet (+ HMAC hash, last-4 for masking), per-operator uniqueness (phone, national id), cross-operator duplicate flags, KYC verification, wallet verification by OTP, audited PII reveal, CSV import (template, `,`/`;`, row errors, idempotent upsert), history; blocks (ref BLK-YYYY-NNNN, auto `draft→documenting`), boundary from GeoJSON or uploaded GeoJSON/KML (ST_MakeValid, area on geography, point-on-surface centroid), map FeatureCollection, land documents + admin verification queue, plots (within 1 m buffer, overlap ≤ 1 %), equal-area auto-grid, allocations (Σ share ≤ 100 %, end), assets, grievances (+ resolution), archive guard; field PWA bootstrap + idempotent sync (`farmer.create|update`, `plot.create|updateGeometry`, `allocation.create`, `photo.attach`).
Web: blocks list + map view, new block, block page tabs (overview with next actions, land: boundary draw/import + documents, plots: map, auto-grid, draw plot, allocations, CSV export; farmers; assets; community), farmers list (search, KYC filter, CSV import/template/export), new/edit farmer, farmer page (KYC, wallet OTP, PII reveal with reason, history), admin land-document queue, `/field` offline PWA (Dexie store, service worker, block download, enrol, GPS/coordinate plot mapping, allocate, queue, sync).
Tests: integration `farmers.test.ts`, `land.test.ts`, `field-sync.test.ts`, P2 cases in `authz.spec.test.ts` (stranger 404 on 10 GET routes + 5 writes; block grant read propagation with masked PII) — 47 integration tests total; Playwright `p2-land-farmers.spec.ts` (20 plots, 20 farmers via UI, PWA offline enrol + allocate, sync).
Known limitations: plot split/merge editing is not provided beyond auto-grid + draw (SPEC lists "split" in the plots editor — next candidate); photo capture uses file upload + `photo.attach` op.

## P3 Catalogue, planning, offtake — done

Domain: `allocateBudget` (§9.1.3 scopes, per-farmer half-even rounding with residual to the largest allocation, tie by farmer code, unallocated + warnings) with a hand-computed fixture test.
API: catalogue (crops, zones, effective crop templates with operator overrides, services platform/own, market prices, admin create), seasons (create/update/start self-financed/cancel, plan version), plantings (create, bulk-assign, update, delete; area ≤ plot; effective yields/prices with `priceSource`), budget lines (CRUD, generate from templates with cheapest valid quote), budget summary (totals by payer, per ha, quoted share, per farmer), supplier quotes, capex, operator opex, fee policy (versioned), offtake contracts (ref OFT-…, lifecycle, buyer grant) and `/buyer/contracts`. Seed: 4 zones, 10 crops, 32 services, irrigated/rainfed templates per zone, market prices.
Web: block tabs *Seasons*, *Offtake*, *Investment* (capex, opex, fee policy); season page with *Plan* (bulk assign, inline yield/price overrides, price source) and *Budget* (generate/regenerate, add/remove lines, totals by payer, per ha, quoted share, per-farmer credit, CSV); catalogue (templates per zone/irrigation with customise, services + create); supplier quotes (with file); offtake contracts (all blocks) with LOI/sign/terminate; buyer portal *Mes contrats*.
Tests: domain 14 tests (100 % lines); 54 integration tests (adds `planning.test.ts`: overrides, plantings defaults & offtake price, budget generation + per-farmer manual totals, season start guard/lock, capex/opex/fees, offtake lifecycle & buyer access; P3 authz negatives); Playwright `p3-planning.spec.ts`.
Known limitations: `/buyer/dispatches` arrives with dispatches in P7; contract expiry (`expired`) is set by a job added with alert rules in P7.

## In progress

Nothing half-built. **Next concrete step:** P4 — write golden tests FM-1, FM-2, RS-1 first in `packages/domain/test/` (exact SPEC §9 numbers), then `buildSchedule` (§9.5), `computeBlockModel` (§9.1), `computeReadiness` (§9.2); API: `model_runs`, `dossiers`, `risk_covers` tables; `POST /seasons/{id}/model-runs`, `/preview`, `GET …/current`, `GET /seasons/{id}/readiness`, `POST /seasons/{id}/dossiers` (freeze + PDF via Playwright in worker), data room; UI Model / Readiness / Dossier tabs.

## How to run

```bash
pnpm install && cp .env.example .env
dockerd &                                  # only in sandboxes without a running Docker daemon
docker compose -f infra/docker-compose.yml up -d postgres   # or: docker run -d --name jappo-pg -e POSTGRES_USER=jappo -e POSTGRES_PASSWORD=jappo -e POSTGRES_DB=jappo -p 5432:5432 postgis/postgis:16-3.4
pnpm seed && pnpm dev
pnpm verify                                # all gates; integration tests start their own PostGIS container (or set TEST_DATABASE_URL)
```
E2E uses database `jappo_e2e` on `E2E_PG_URL` (default `postgres://jappo:jappo@localhost:5432`), API on :4100, web on :3100; `pnpm e2e` rebuilds the web app with `API_INTERNAL_URL=http://localhost:4100`.
