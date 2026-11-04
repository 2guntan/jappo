# Progress

Source of truth for the next session. Phases from SPEC §17. Update after every phase.

## Phases

- [x] P0 Scaffold
- [x] P1 Identity & core
- [ ] P2 Land & farmers
- [ ] P3 Catalogue, planning, offtake
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

## In progress

Nothing half-built. **Next concrete step:** P2 — migrations for `farmers`, `farmer_group_members`, `farmer_flags`, `blocks`, `land_documents`, `plots`, `plot_allocations`, `block_assets`, `community_grievances`; then services/routes (SPEC §10.3, §10.4, §10.13), admin land-document verification queue, field PWA.

## How to run

```bash
pnpm install && cp .env.example .env
dockerd &                                  # only in sandboxes without a running Docker daemon
docker compose -f infra/docker-compose.yml up -d postgres   # or: docker run -d --name jappo-pg -e POSTGRES_USER=jappo -e POSTGRES_PASSWORD=jappo -e POSTGRES_DB=jappo -p 5432:5432 postgis/postgis:16-3.4
pnpm seed && pnpm dev
pnpm verify                                # all gates; integration tests start their own PostGIS container (or set TEST_DATABASE_URL)
```
E2E uses database `jappo_e2e` on `E2E_PG_URL` (default `postgres://jappo:jappo@localhost:5432`), API on :4100, web on :3100; `pnpm e2e` rebuilds the web app with `API_INTERNAL_URL=http://localhost:4100`.
