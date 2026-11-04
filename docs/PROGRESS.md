# Progress

Source of truth for the next session. Phases from SPEC §17. Update after every phase.

## Phases

- [x] P0 Scaffold
- [x] P1 Identity & core
- [x] P2 Land & farmers
- [x] P3 Catalogue, planning, offtake
- [x] P4 Model, readiness, dossier
- [x] P5 Marketplace
- [x] P6 Agreements & facilities
- [x] P7 Operations & harvest
- [x] P8 Settlement
- [x] P9 Monitoring
- [x] P10 Commercial
- [x] P11 Hardening & acceptance

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

## P4 Model, readiness, dossier — done

Domain (golden tests written first, unchanged numbers): FM-1, FM-2, RS-1 pass (`packages/domain/test/golden-fm-rs.test.ts`); engines `buildSchedule` (bullet, seasonal, annuity, equal principal; flat/declining; interest-only/capitalised grace), `computeBlockModel` (5 scenarios, farmer P&L, HCR, breakevens, operator monthly cash flow, DSCR, NPV, IRR, payback, warnings, inputs hash), `computeReadiness` (G1–G10 with reason codes + entity ids, 7 score components, grade), `irrMonthly` (Newton + bisection), pure `sha256Hex`. Domain coverage 99 % lines.
API: `financing_assumptions`, `model_runs`, `dossiers`, `risk_covers`; `GET/PUT /seasons/{id}/model-assumptions`, `POST /seasons/{id}/model-runs` (+ `/preview` what-if, `/current` with staleness), `GET /model-runs/{id}`, `GET /seasons/{id}/readiness`, `POST /blocks/{id}/actions/check-readiness`, `POST /seasons/{id}/dossiers` (freeze: gates + current model, snapshot without PII, data-room manifest, content SHA-256, supersede previous, block → ready), `GET /dossiers/{id}`, `/pdf` (signed URL / 409 pending), `/data-room`, risk covers CRUD. PDF: Handlebars template fr/en with inline SVG map & charts → Playwright Chromium (`core/adapters/pdf`), rendered by the `dossier.frozen` event handler.
Web: season tabs *Model* (assumptions form, run, scenario table, Recharts revenue/debt + cash flow, what-if sliders, farmer P&L), *Readiness* (score ring, breakdown bars, gate checklist with fix links, block status update), *Dossier* (freeze, versions, PDF download, data room); block tab *Risk covers* (add, commit, activate).
Tests: domain 29 tests; integration `dossier.test.ts` (model debts 1 308 000 / 1 090 000 / 872 000, gates, freeze, PDF bytes, supersede, stale model, preview, risk-cover scoring, authz + dossier grant) — 58 integration tests total; Playwright `p4-dossier.spec.ts` (model → gates → freeze → PDF). Reusable fixtures: `apps/api/test/helpers.readyScenario`, `apps/web/e2e/helpers.readyScenarioViaApi`.
Known limitations: data-room PDF watermarking for lenders arrives with lender downloads in P5; farmer arrears (`inArrears`) and field visits feed readiness once P7/P8 tables exist (currently false / season-not-started).

## P5 Marketplace — done

Domain: BE-1 golden test (2122 bps) written first; `matchLenders` (§9.3 with reasons/failed criteria, share-based ticket rule), `bidEar`, `evaluateBids` (cost/share/speed/conditions scores, configurable weights, rank with submission tie-break, greedy suggested allocation, weighted EAR).
API: tables `lender_profiles`, `financing_requests`, `tranches`, `rfps`, `rfp_invitations`, `rfp_questions`, `bids`, `bid_evaluations`, `awards`; lender profiles (+ preview count), financing requests (from frozen dossier, tranches default from assumptions, submit → block `in_financing`, season `financing`, cancel), matches (verified lenders only), RFP create/open (15 working days with holidays, grants to invitees, notifications)/extend (max 2)/close-early/cancel, deadline cron job, opportunities, view/decline, Q&A (publish, asker anonymised), sealed bids (draft/update/submit by credit_committee/withdraw; operator sees bids only after close), bid preview (EAR + schedule), evaluation, award (Σ ≤ tranche, partial rules), accept/decline (grants), lender awards; watermarked data-room PDFs for lenders.
Web: season tab *Financing* (create/submit request, tranches, matched lenders with deselection, launch tender), operator RFP page (deadline/extend/close/cancel, invitations, evaluation table with editable award amounts, awards, Q&A answers), financing list; lender workspace: appetite profiles (+ preview), opportunities (deadline countdown), RFP page (structured dossier viewer with map, scenarios, offtake, data room downloads, Q&A, bid form per tranche with live EAR + schedule preview, submit/withdraw, decline), awards (accept/decline).
Tests: domain 33 tests (99 % lines); integration `marketplace.test.ts` (full tender incl. sealed-bid authz, MFA-gated submission, min share, deadline job, evaluation 2122/2100, override award, acceptance grants; extensions/cancel; watermark) — 61 integration tests; Playwright `p5-marketplace.spec.ts`.
Known limitations: seasonal-profile bids use the schedule's default harvest month (tenor) for EAR; the structuring-fee invoice on `award.accepted` arrives with billing (P10).

## P6 Agreements & facilities — done

Domain: `addMonthsIso`, `datedSchedule`, `allocateFacility` (pro rata, exact column sums), `upfrontFeeXof`, `daysOverdue`, `harvestMonthsFor` (+ unit tests).
Templates: six contract templates fr + en (`packages/templates/src/contract-seeds.ts`, structured drafts with all variables wired, counsel notice in the admin API summary), `renderContractBody` / `renderContractHtml` (signature page + content hash footer).
API: tables `contract_templates`, `contracts`, `contract_parties`, `signatures`, `escrow_accounts`, `facilities`, `facility_farmer_allocations`, `schedule_lines`, `disbursements`, `repayments` (migration 0006); templates list + admin revision; contracts create (data assembled from block/season/award/offtake), edit editable clauses (draft), send (render, SHA-256 content hash, PDF via Chromium, notify signatories), void, PDF (signed version once complete), OTP request + sign (org parties by SMS/email code; farmers by SMS code or in person with witness, photo evidence and GPS), `generate-pack` (framework, plot contracts for allocated farmers, offtake drafts, loan contracts per facility, escrow mandate; optional send); signed plot contracts link allocations, signed offtake contracts become `signed`. Facilities created on award acceptance (schedule + farmer allocations), list/detail with CP checklist and totals, PATCH (loan ref, escrow), confirm-CP (re-dated schedule, block `financed`, financing request `contracted`), mark-default, restructure, escrow accounts, disbursement request/approve/reject/execute (four-eyes)/confirm, pending disbursements, repayments list, nightly arrears job; season start guard wired.
Web: contracts list + detail (signatories, OTP signing, in-person signing, clauses, void, PDF), facilities portfolio + facility page (terms, schedule, disbursements with lender actions and operator request form, farmer allocations, repayments, CP checklist, escrow account setup/link, loan ref, restructure/default), season Financing tab *Contracts and facilities* (generate & send pack, progress), lender awards → facility link, field PWA *Farmer signatures* (photo + GPS, or SMS code).
Tests: domain +5; integration `agreements-facilities.test.ts` (full pack signing incl. sign order, wrong code, in-person and SMS farmer signatures, CPs, four-eyes, season guard, arrears/restructure; template revision, clause rules, void; authz negatives for an unrelated lender) — 63 integration tests; Playwright `p6-agreements.spec.ts`.
Known limitations: OTP codes remain readable in the `notifications.data` of queued messages (as for login OTPs) — redact after delivery in P11; repayments are only listed (posting comes with settlement in P8).

## P7 Operations & harvest — done

Domain: `computeInvoice` (grade-adjusted, rejection apportionment), `evaluateAlertRules` (all ten §9.8 rules, configurable params, dedupe keys), `expectedKgByFarmer`; fixture tests (`operations.test.ts`).
API: tables `service_deliveries`, `field_visits`, `alert_rules` (seeded), `alerts`, `harvest_deliveries` (generated `net_kg`), `dispatches`, `buyer_invoices`, `escrow_receipts` (migration 0007, OTP purpose `delivery_ack`); service deliveries (photo / SMS-code farmer acknowledgement, idempotent by offline id), visits (alerts re-evaluated), block alerts (list, manual, evaluate now, acknowledge, resolve), alert rules (admin), harvest tickets (grade checked against offtake quality spec, season → harvest, void), dispatches + buyer acceptance, buyer invoices (grade-adjusted, PDF with OHADA mentions, dispute), escrow receipts (buyer declares → lender confirms; lender records → confirmed; invoices paid), nightly alert job (also flags overdue invoices); field sync ops `visit.create`, `serviceDelivery.create`, `harvestDelivery.create` and bootstrap of seasons, plantings, budget lines, grades, last visits.
Web: season tabs *Operations* (service deliveries with acknowledgement, visits) and *Harvest* (weighing with net preview, tickets, dispatch, invoicing, receipts), block tab *Alerts*, buyer *Receipts* (accept/reject kg) and *Invoices and payments* (PDF, declare transfer into escrow, dispute), lender facility page escrow receipts (confirm/reject), admin *Alert rules*, PWA *Plot visit* and *Harvest weighing* (offline queue).
Tests: domain +5; integration `operations-harvest.test.ts` (acknowledgements, idempotency, HEALTH_LOW/YIELD_FORECAST_DROP/VISIT_GAP/DELIVERY_SHORTFALL raised, no duplicates, auto-resolve, rule admin, grades, tickets, dispatch rules, invoice 2 780 000 XOF, receipts and invoice payment, authz negatives for stranger lender/buyer; PWA ops) — 65 integration tests; Playwright `p7-operations-harvest.spec.ts`. Fixed a flaky P1 test (signature tamper could be a no-op).
Known limitations: invoice amounts exclude VAT by default (setting); visits' crop-stage timeline is listed, not charted.

## P8 Settlement — done

Domain: golden WF-1 and WF-2 written first (`golden-wf.test.ts`, numbers unchanged), then `computeSettlement` (§9.6.2: scaling to receipts, per-farmer waterfall, capped group solidarity, block distribution, invariant) + edge-case tests (`settlement.test.ts`).
API: tables `settlement_runs`, `settlement_lender_approvals`, `settlement_lines`, `payout_instructions`, `farmer_arrears`, `farmer_statements` (migration 0008); compute from confirmed receipts and accepted deliveries (season → settlement), recompute (voids approvals), operator then every-lender approval, instruct (instructions, arrears, statement PDFs + SMS text), CSV exports (bank generic, Wave, Orange Money), single confirm/fail and CSV confirmation import, repayment posting to schedule lines (facility repaid / cured), mark executed, reconcile (Σ confirmed = receipts → season closed, block financed), statements list/PDF/send, farmer arrears; farmer portal API (phone OTP login, profile, plots, statements, PDF). Fix: farmer-borne upfront fee only when assumptions say so (D-082).
Web: settlements list + run page (distribution cards, lines, approvals, actions, instructions with exports, confirm/fail, CSV import, statements + send), season Harvest tab *Settlement* card (compute), farmer portal `/me` (SMS login, plots, statements with PDF).
Tests: domain 53; integration `settlement.test.ts` reproduces WF-1 end to end (lines, distribution, instructions Σ = 5 750 000, exports, approvals incl. recompute, authz negatives, arrears, statements, lender confirmation posting 270 000 interest + 2 878 000 principal, CSV import with failure, reconciliation blocked then passing, season closed, block financed, farmer portal own-data only) and WF-2 (solidarity 81 722 / 40 278) — 67 integration tests; Playwright `p8-settlement.spec.ts`.
Known limitations: payout providers are manual/CSV (no live Wave/Orange API calls); without an operator investment facility the investment fees go to the operator (WF-1's 200 000 "investment" line needs the investment tranche of P11's scenario).

## P9 Monitoring — done

Domain: `computeKpis` (§9.9) with fixture + expected-values file (`test/fixtures/kpi-fixture.json`, `kpi-expected.json`) and zero-division test.
API: tables `kpi_snapshots`, `reports` (migration 0009); nightly snapshot job (blocks, lender portfolios, platform; idempotent per date), `GET /kpis`, dashboards operator / lender / block / guarantor, reports (lender monthly, season close, guarantor portfolio PDFs); guarantor read grants from committed risk covers.
Web: home dashboards (operator KPIs, blocks by status, tasks, alerts; lender portfolio KPIs and pending approvals), block tab *Monitoring*, reports page, guarantor portfolio page (exposure, claim candidates, links to read-only block monitoring).
Tests: domain 55; integration `monitoring.test.ts` (snapshots on a settled WF-1 season: farmers 3, women 100 %, disbursed 3 000 000, outstanding 122 000, delivered 23 000 kg, net income avg 767 333 / median 760 000; dashboards; guarantor exposure 61 000; reports; authz negatives) — 68 integration tests; Playwright `p9-monitoring.spec.ts`.
Known limitations: dashboards are tables and tiles (no time-series charts yet; the KPI series endpoint is ready for them).

## P10 Commercial — done

Domain: `invoiceTotals`, `structuringFeeXof`, `billingStatusFor`, `nextWebhookAttempt` (+ tests).
API: tables `plans` (seeded), `subscriptions`, `platform_invoices`, `webhook_endpoints`, `webhook_deliveries`, column `organizations.billing_status` (migration 0010); public plans, subscription (change plan; annual seats invoiced), invoices + PDF (VAT 18 %), event handlers `season.started` (per-ha fee) and `award.accepted` (structuring fee), daily billing job (renewals, overdue → banner / read-only enforced in the auth hook), admin plans and invoices (mark paid / void); webhooks CRUD, signed deliveries with retry/backoff, test action, delivery log, `GET /events`; admin console API (settings, holidays, template preview, webhook monitor).
Web: public pricing page, billing settings (plans, subscribe, invoices with PDF), overdue/read-only banner in the app shell, webhooks settings (secret once, log, test, disable), admin billing (prices, invoices), admin console (settings, holidays, template editor with preview, webhook deliveries); navigation still generated from `/v1/modules`.
Tests: domain 58; integration `billing-webhooks.test.ts` (self-signup → subscribe → 14 160 XOF invoice at season start, idempotent; restricted mode and recovery; structuring fee 35 400; lender licence 1 416 000; signed webhook verified with HMAC, retries to failed, test delivery, isolation, event feed) and `admin-console.test.ts`; Playwright `p10-commercial.spec.ts`.
Known limitations: invoices are paid manually (admin marks paid); the platform issuer identity on invoices is generic "Jappo" until legal details are entered.

## P11 Hardening & acceptance — done

Security: integration `security.test.ts` — auth rate limit 10/min/IP (11th → 429, other IPs unaffected), 300/min per token, OTP requests 3/10 min per phone, code locked after 5 wrong attempts, delivered codes redacted from `notifications` (D-092); IDOR sweep of 24 GET routes plus writes for an unrelated operator, lender and buyer (found and fixed `GET /seasons/{id}/settlement-runs` answering 200 to strangers).
Behaviour: seasonal facility goes `in_arrears` at settlement reconciliation when unpaid (D-093); repayment-rate KPI counts matured lines (D-094).
Operations: `infra/docker-compose.prod.yml` (Caddy, web, api ×2, worker, PostGIS tuned, MinIO, nightly backup service), `infra/caddy/Caddyfile`, `infra/backup/backup.sh` / `restore.sh` — **tested**: dump of the e2e database (25 orgs, 923 audit rows, 151 files) restored into `jappo_restore_test` with identical counts and an intact audit hash chain (923 checked); API image now ships Chromium for PDFs; `docs/RUNBOOK.md`; `docs/API.md` generated (294 operations, `pnpm docs:api`).
Quality gates: OpenAPI lint with Spectral — 0 errors (component `$id`s stripped, global tags declared; 74 warnings = unused input variants); domain coverage ≥ 90 % enforced; API integration coverage 93.5 % lines; performance tests: model run for 500 farmers/plots and settlement for 2 000 farmers both well under budget (< 0.4 s together).
Acceptance: `pnpm e2e:full` (`apps/web/e2e/full-lifecycle.spec.ts`) passes all 14 steps of SPEC §17.1: signup + KYC, block with GeoJSON boundary and verified land documents, auto-grid 1 ha plots, farmers enrolled through the PWA sync protocol with verified wallets, budget 1 200 000 / 1 000 000 / 800 000, fees, signed escrow offtake, 80 % guarantee, model + all gates + frozen dossier PDF, request 3 000 000, RFP to Alpha and Gamma, bids, deadline job close, EAR 2122 / 2100, award Alpha in the UI, acceptance, escrow, 6 contracts signed (OTP + in person), CPs, four-eyes disbursement by two Alpha users, service deliveries and 2 visits per plot, season start, harvest 12 000 / 8 000 / 3 000 kg, invoice 5 750 000, buyer receipt confirmed by Alpha, settlement = WF-1 (1 542 000 / 760 000 / 0; seasonal 3 148 000; farmers 2 302 000) approved in the UI by operator and Alpha, Wave CSV, confirmations imported, reconciled, facility `in_arrears` with repaid 3 148 000 and F3 arrears 122 000, 3 statement SMS, F1 portal login and statement PDF, lender KPI repayment rate 96,27 %, platform invoices 15 000 (3 ha × 5 000) and 30 000 (1 % structuring).
Known limitations (V1): payouts via CSV/manual confirmation (no live Wave/Orange API); invoices paid manually; `PII_ENCRYPTION_KEY` rotation needs an offline re-encryption script; dashboards without time-series charts.

## In progress

**V1 is complete**: every phase P0–P11 is checked and `pnpm e2e:full` passes. Nothing half-built. Suggested next steps (post-V1): live mobile-money payout adapters behind the existing adapter interface, time-series charts on the KPI series endpoint, key-rotation tooling, data processing register page (SPEC §18.2) review with counsel.

## How to run

```bash
pnpm install && cp .env.example .env
dockerd &                                  # only in sandboxes without a running Docker daemon
docker compose -f infra/docker-compose.yml up -d postgres   # or: docker run -d --name jappo-pg -e POSTGRES_USER=jappo -e POSTGRES_PASSWORD=jappo -e POSTGRES_DB=jappo -p 5432:5432 postgis/postgis:16-3.4
pnpm seed && pnpm dev
pnpm verify                                # all gates; integration tests start their own PostGIS container (or set TEST_DATABASE_URL)
```
E2E uses database `jappo_e2e` on `E2E_PG_URL` (default `postgres://jappo:jappo@localhost:5432`), API on :4100, web on :3100; `pnpm e2e` rebuilds the web app with `API_INTERNAL_URL=http://localhost:4100` and runs the phase specs P1–P10; `pnpm e2e:full` runs the SPEC §17.1 lifecycle (≈ 1.5 min). Production: `docs/RUNBOOK.md`.
