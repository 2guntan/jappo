# Jappo — Functional & Technical Specification (V1)

> Jappo (Wolof: "join forces, help each other") — block farm finance. Product name: **Jappo**. Package scope: `@jappo/*`. Repository: `jappo`.

Version 1.0 · 2026-11-05 · Owner: IBRIZ GROUP
Audience: an autonomous AI coding agent (read `AGENTS.md` first) and the IBRIZ product team.

---

## 0. Table of contents

1. Product summary and V1 scope
2. Technology stack (fixed)
3. Architecture and repository layout
4. Cross-cutting conventions (API, data, money, IDs, i18n, errors)
5. Organisations, users, roles
6. Authorisation model and data sharing
7. Domain model (all tables)
8. Lifecycles (state machines)
9. Domain engines (financial model, readiness score, matching, bid evaluation, schedules, waterfall) with golden tests
10. API surface (`/v1`)
11. Events, webhooks and the extension framework
12. Frontend: workspaces and screens
13. External adapters (SMS, email, payments, storage, PDF, maps)
14. Documents and contract generation
15. Billing and commercial model in-product
16. Seed and demo data
17. Build phases, Definition of Done, end-to-end acceptance scenario
18. Non-functional requirements (security, privacy, performance, ops)
19. Glossary

---

## 1. Product summary and V1 scope

**Jappo** is a platform that turns *block farms* into financeable, monitored credit transactions.

A **block farm** is a contiguous area of land, divided into **plots** allocated to smallholder **farmers**, run by an **operator** (company, cooperative or GIE) that provides inputs, mechanisation, irrigation, training and a contracted **buyer** (offtaker). The operator controls harvest and sale, so service costs and loans are repaid **at source** from the buyer's payment.

Jappo lets the parties:

1. **Build** a block: boundary on a map, land documents, plots, farmers, crop plan, budget from supplier quotes, offtake contracts.
2. **Model** it: deterministic financial model (farmer income per plot, block cash flow, debt service, stress tests).
3. **Package** it: a standard **Block Dossier** with a **Readiness Score** and hard gates, exported as PDF and a data room.
4. **Finance** it: a closed **tender** to lenders whose **appetite profile** matches; sealed **bids** (term sheets); evaluation; **award**; syndication across two **tranches** (investment and seasonal).
5. **Contract** it: generated contracts, OTP e-signature.
6. **Operate** it: disbursements to suppliers, service deliveries, field visits, alerts.
7. **Harvest and settle** it: weighing per plot, buyer invoices, receipts into **escrow** (held at the lender), **settlement waterfall** (seasonal debt → investment instalment → operator fees → farmer net), payout instructions, farmer statements by SMS.
8. **Monitor** it: live dashboards for operator, lenders, guarantor; KPIs; portfolio view.

**The platform never holds funds.** It computes, instructs, records and reconciles. Money moves between buyer, escrow account (at the lender), suppliers, and farmer mobile wallets.

### 1.1 Users and who pays

| Customer | What they buy | V1 pricing model (configurable in §15) |
|---|---|---|
| Operator (block promoter, cooperative, agribusiness) | Block building, dossier, tender, operations, settlement | Subscription per hectare per season + structuring fee on awarded amount |
| Lender (bank, MFI, DFI) | Qualified pipeline, data room, monitoring, settlement control | Annual seat licence (monitoring) — success fees disabled by default (regulatory, see §18.5) |
| Buyer, guarantor, insurer | Portal access | Free in V1 |
| Farmer | Statements, plot info | Free |

### 1.2 In scope for V1

Everything in sections 5–17. V1 must be **fully functional and sellable**: self-serve operator signup, KYC review by platform admin, complete lifecycle, PDF outputs, billing invoices, French and English UI.

### 1.3 Out of scope for V1 (designed for, not built)

Satellite/NDVI imagery, IoT telemetry ingestion, carbon credits, credit scoring ML, USSD channel, WhatsApp channel, native mobile apps, real-time mobile money disbursement APIs beyond the adapter stubs, multi-currency other than XOF, secondary loan market. The extension framework (§11) is how these are added later.

---

## 2. Technology stack (fixed — do not substitute)

| Concern | Choice |
|---|---|
| Language | TypeScript 5.x, `strict: true`, Node.js 22 LTS |
| Monorepo | pnpm workspaces + Turborepo |
| API server | Fastify 5, `fastify-type-provider-zod`, `@fastify/swagger` (OpenAPI 3.1), `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/multipart` |
| Validation / contracts | Zod (single source of truth for request/response schemas) |
| Database | PostgreSQL 16 + PostGIS 3.4, **self-hosted** (Docker image `postgis/postgis:16-3.4`) |
| ORM / migrations | Drizzle ORM + drizzle-kit (SQL migrations committed) |
| Jobs / queue | `pg-boss` (Postgres-backed; no Redis) |
| Decimal maths | `decimal.js` |
| IDs | UUIDv7 (`uuid` package `v7`) |
| Auth | Argon2id password hashes (`@node-rs/argon2`), JWT access tokens (15 min, `jose`), rotating refresh tokens (httpOnly cookie, 30 days, stored hashed), phone OTP, API keys (hashed) |
| Object storage | S3-compatible: MinIO self-hosted (`@aws-sdk/client-s3`) |
| PDF | HTML templates rendered with Playwright Chromium in the worker |
| Templates | Handlebars (contracts, PDFs, SMS, email) |
| Email | SMTP via Nodemailer (Mailpit in dev) |
| Web app | Next.js 15 (App Router), React 19, Tailwind CSS 4, shadcn/ui, TanStack Query, react-hook-form + Zod, next-intl (fr default, en), Recharts |
| Maps | MapLibre GL JS + `@mapbox/mapbox-gl-draw`-compatible draw (use `terra-draw`), OSM raster tiles default, tile URL configurable |
| Field app | PWA inside `apps/web` under `/field`, offline-first with Dexie (IndexedDB) and a sync queue |
| API client | `openapi-typescript` + `openapi-fetch` generated into `packages/sdk` |
| Testing | Vitest (unit, integration with Testcontainers Postgres), Playwright (e2e) |
| Logging / metrics | pino (JSON), `/metrics` Prometheus via `prom-client` |
| Reverse proxy | Caddy 2 (automatic TLS) |
| Deployment | Docker Compose (single VM) — production-ready compose file + backup scripts |
| CI | GitHub Actions: install, typecheck, lint, test, build images |

---

## 3. Architecture and repository layout

### 3.1 Principles

- **API first:** the OpenAPI document is the product contract. Web, field PWA, partners and future services consume the same API.
- **Modular monolith:** one API process organised in **modules** (bounded contexts) with explicit public interfaces. Modules communicate synchronously through service interfaces and asynchronously through **domain events** (transactional outbox). A module never reads another module's tables directly; it calls that module's service.
- **Thick domain, thin routes:** routes validate and authorise, services orchestrate, `packages/domain` computes.
- **Extensible:** new services plug in as modules (§11.3) with their own migrations, routes, permissions, event handlers and UI navigation entries.

### 3.2 Layout

```
jappo/
  AGENTS.md
  SPEC.md
  docs/                 DECISIONS.md, PROGRESS.md, API.md (generated), RUNBOOK.md
  apps/
    api/                Fastify app
      src/
        main.ts
        app.ts                 build app, register core plugins and modules
        core/                  auth, authz, db, files, audit, events(outbox), errors, pagination, idempotency, i18n
        modules/
          identity/            orgs, users, memberships, api keys, KYC of orgs
          farmers/
          land/                blocks, plots, land documents, allocations
          catalogue/           crops, crop templates, service catalogue, units
          planning/            seasons, plantings, budget lines, capex, supplier quotes
          offtake/             buyers' contracts, market prices
          finance/             financial model runs (calls packages/domain)
          dossier/             readiness, dossier versions, data room
          marketplace/         lender profiles, financing requests, tranches, RFPs, bids, Q&A, awards
          agreements/          templates, contracts, signatures
          facilities/          loan facilities, schedules, disbursements
          operations/          service deliveries, field visits, alerts
          harvest/             deliveries (weighing), dispatches, buyer invoices, escrow receipts
          settlement/          settlement runs, allocations, payout instructions, statements
          monitoring/          KPI snapshots, dashboards, reports
          billing/             plans, subscriptions, platform invoices
          notifications/
          webhooks/
          admin/
        jobs/                  pg-boss job definitions (shared with worker)
      drizzle/                 SQL migrations
      test/
    worker/             pg-boss consumers: outbox dispatch, PDFs, notifications, KPI snapshots, deadlines
    web/                Next.js (public site, app workspaces, /field PWA)
  packages/
    domain/             pure engines + golden tests
    contracts/          shared Zod schemas & enums (imported by api; exported to OpenAPI)
    sdk/                generated OpenAPI client
    templates/          Handlebars templates (pdf, contracts, sms, email) fr + en
    config/             eslint, tsconfig, tailwind presets
  infra/
    docker-compose.yml          dev
    docker-compose.prod.yml     prod (caddy, api, worker, web, postgres, minio)
    Caddyfile
    backup/                     pg_dump + WAL scripts, restore script
  .github/workflows/ci.yml
```

### 3.3 Runtime processes

| Process | Role |
|---|---|
| `api` | HTTP API `/v1`, OpenAPI at `/v1/openapi.json`, docs UI at `/v1/docs` |
| `worker` | outbox → event handlers and webhooks; PDF rendering; SMS/email; scheduled jobs (RFP deadlines, overdue alerts, KPI snapshots nightly, subscription invoicing monthly) |
| `web` | Next.js server (SSR for public pages, client app for workspaces, PWA for field) |
| `postgres`, `minio`, `caddy` | infrastructure |

---

## 4. Cross-cutting conventions

### 4.1 API

- Base path `/v1`. JSON only (`application/json; charset=utf-8`), except file upload (`multipart/form-data`) and downloads.
- Resource naming: plural kebab-case (`/v1/blocks/{blockId}/plots`).
- **Errors:** RFC 9457 `application/problem+json` with `type`, `title`, `status`, `detail`, `code` (stable machine code, e.g. `GATE_LAND_NOT_VERIFIED`), `errors[]` for field errors.
- **Pagination:** cursor-based: `?limit=50&cursor=...` → `{ data: [], nextCursor: string|null }`. Max limit 200.
- **Filtering / sorting:** `?filter[status]=active&sort=-createdAt`.
- **Idempotency:** every `POST` that creates or triggers accepts `Idempotency-Key` header; stored 24 h in `idempotency_keys`; replay returns the original response.
- **Concurrency:** mutable resources return `ETag` (row `version` integer); `PATCH`/`PUT`/state transitions require `If-Match`; mismatch → 412.
- **State transitions** are explicit action endpoints: `POST /v1/rfps/{id}/actions/close`, never a raw `status` PATCH.
- **Timestamps:** ISO 8601 UTC in API; UI displays `Africa/Dakar`.
- **Versioning:** breaking changes go to `/v2`; additive changes allowed in `/v1`.
- Every route declares: `operationId`, tags, summary, request/response Zod schemas, `x-permission` (see §6).

### 4.2 Data

- Every table: `id uuid primary key` (UUIDv7, generated in app), `created_at timestamptz not null default now()`, `updated_at timestamptz not null`, `version int not null default 1` (optimistic lock) for mutable tables, `created_by uuid null`.
- Tenancy columns: every business row carries `owner_org_id` (the organisation that owns it). Sharing is handled by `access_grants` (§6).
- Soft delete only where stated (`archived_at`); financial records are never deleted.
- Human references: `ref text unique` with prefix and yearly sequence, e.g. `BLK-2026-0001`, `RFP-2026-0001`, `CTR-2026-0001`, `STL-2026-0001`, `INV-2026-0001` (sequence table `ref_sequences(prefix, year, last)` updated with `SELECT ... FOR UPDATE`).
- Geometry: `geometry(MultiPolygon, 4326)` for blocks, `geometry(Polygon, 4326)` for plots, `geometry(Point, 4326)` for points. Areas computed with `ST_Area(geom::geography)/10000` (hectares) and stored in `area_ha numeric(12,4)`.
- Enumerations that users may extend → lookup tables. Fixed lifecycle states → Postgres enums.
- PII encryption: `national_id_number`, `mobile_wallet_number` encrypted at application level (AES-256-GCM, key `PII_ENCRYPTION_KEY`), plus a `*_hash` column (HMAC-SHA256) for uniqueness and lookup.

### 4.3 Money, rates, quantities

| Kind | Storage | API |
|---|---|---|
| Money | `bigint` XOF | integer, field suffix `Xof` (e.g. `amountXof`) |
| Rates | `integer` basis points (1 % = 100 bps) | integer, suffix `Bps` |
| Percent shares | `numeric(7,4)` (0–100) | number |
| Mass | `numeric(14,3)` kg | number, suffix `Kg` |
| Area | `numeric(12,4)` ha | number, suffix `Ha` |
| Yield | `numeric(10,3)` t/ha | number |

Default rounding for money outputs: **round half to even to integer XOF**, unless the engine states otherwise (waterfall uses floor + residual, §9.6).

### 4.4 Internationalisation

- UI: French (default) and English via next-intl message files `apps/web/messages/{fr,en}.json`. No hard-coded user-facing strings.
- Templates (PDF, contracts, SMS, email) exist in both locales in `packages/templates/{fr,en}/`.
- Organisation and user each have `locale`; farmer SMS uses farmer `locale` (fr default; `wo` reserved for future).
- Number format: `fr-SN` (spaces as thousands separators, "FCFA" suffix).

---

## 5. Organisations, users, roles

### 5.1 Organisation types

`platform` (IBRIZ, single), `operator`, `lender`, `buyer`, `guarantor`, `insurer`, `supplier`, `farmer_group`.

An organisation has: legal name, trade name, legal form (`SA`, `SARL`, `SAS`, `GIE`, `cooperative`, `association`, `mutuelle`, `etablissement_credit`, `sfd`, `other`), NINEA, RCCM, country (default `SN`), region, address, phone, email, logo file, locale, `kyc_status` (`pending`, `submitted`, `verified`, `rejected`), `status` (`active`, `suspended`), plan (billing).

Lender orgs additionally: `lender_kind` (`bank`, `sfd`, `dfi`, `fund`, `leasing`), BCEAO approval number (text).

### 5.2 Users and memberships

A user can belong to several organisations (`memberships`) with one or more roles per organisation. The active organisation is chosen in the UI (org switcher) and sent as header `X-Org-Id`; the token lists memberships.

### 5.3 Roles (fixed in V1, stored in `roles` table for extension)

| Role | Org types | Purpose |
|---|---|---|
| `platform_admin` | platform | Everything; KYC review; catalogues; templates; plans; support |
| `platform_support` | platform | Read-only across tenants, impersonation-free |
| `org_admin` | any | Manage org profile, members, API keys, webhooks, billing |
| `operator_manager` | operator | Build blocks, plans, dossiers, tenders, award, contracts, settlements |
| `agronomist` | operator | Crop plans, templates overrides, visits, yield estimates |
| `field_agent` | operator | Field PWA: enrol farmers, map plots, visits, deliveries, weighing |
| `finance_officer` | operator, buyer | Budgets, quotes, invoices, settlement preparation and approval (operator side), buyer payments |
| `credit_officer` | lender, guarantor, insurer | Appetite profile, review dossiers, Q&A, draft bids, monitoring, settlement approval (lender side) |
| `credit_committee` | lender | Submit/withdraw bids, accept award, sign contracts |
| `buyer_rep` | buyer | Offtake contracts, dispatch acceptance, invoices, escrow payments |
| `viewer` | any | Read-only within org scope |

Farmers are **not** users by default. A farmer gets limited access via phone OTP to `/me` (own plots, statements) — principal type `farmer` (§6.1).

---

## 6. Authorisation model and data sharing

### 6.1 Principals

`user` (JWT, with active org), `api_key` (bound to one org, with a subset of roles), `farmer` (OTP session, scope = own records), `system` (worker).

### 6.2 Permissions

Permissions are strings `resource:action` (e.g. `block:create`, `block:read`, `bid:submit`, `settlement:approve_lender`). A static map `ROLE_PERMISSIONS` in `apps/api/src/core/authz/permissions.ts` gives each role its permissions. Each route declares `x-permission`. The authz layer checks:

1. The principal has the permission through a role in the **active org**.
2. The target resource is **visible** to the active org (§6.3).
3. Resource-specific rules (e.g. a lender sees bids only for its own org; operator sees bids only after RFP close).

### 6.3 Visibility (data sharing)

A resource is visible to org X if:

- `owner_org_id = X`, or
- an `access_grants` row exists: `(resource_type, resource_id, grantee_org_id, scope, expires_at)` with scope `read` | `comment` | `act`.

Grants are created automatically by business events:

| Event | Grant |
|---|---|
| Lender invited to an RFP | `read` on the dossier version, block (read-only views), data room files, until RFP closes + 30 days (extended to `facility end + 1 year` if awarded) |
| Award accepted | lender `read` on block, seasons, operations, harvest, settlement for the facility's life; `act` on settlement approvals and disbursement approvals |
| Guarantor/insurer attached to a tranche | `read` on block, facility, settlement |
| Buyer attached to offtake contract | `read` on its contract, its dispatches; `act` on dispatch acceptance and escrow receipts |
| Farmer group org linked to block | `read` on its members' allocations and statements |

Grant-propagation rule: a grant on a **block** implies read on its child resources (plots, allocations, seasons, plantings, deliveries, visits, harvest) unless the child type is listed as `private_operator` (budget internal notes, supplier quote files marked private, Q&A drafts).

**Sealed bids:** bids are readable by the bidding lender's org always; by the operator org only when `rfp.status ∈ {closed, evaluation, awarded}`; never by other lenders. Enforced in the marketplace service and covered by tests.

### 6.4 Defence in depth

All queries go through repository functions that take an `ActorContext` and apply scoping. An integration test suite `authz.spec.ts` must, for every list and get route, assert that a user from an unrelated org gets 404 (not 403) and empty lists.

---

## 7. Domain model

Notation: `col type [constraints]`. Standard columns (§4.2) omitted. `FK→table`.

### 7.1 Identity (`identity`)

- `organizations`: `type org_type`, `legal_name`, `trade_name`, `legal_form`, `ninea`, `rccm`, `country char(2)`, `region`, `address`, `phone`, `email`, `logo_file_id FK→files`, `locale`, `kyc_status`, `status`, `lender_kind null`, `bceao_approval_no null`, `plan_id FK→plans null`.
- `org_kyc_documents`: `org_id`, `doc_type` (`ninea`, `rccm`, `statuts`, `id_representative`, `approval_bceao`, `other`), `file_id`, `status` (`submitted`, `verified`, `rejected`), `reviewed_by`, `reviewed_at`, `comment`.
- `users`: `email unique null`, `phone unique null`, `full_name`, `password_hash null`, `locale`, `status` (`invited`, `active`, `disabled`), `last_login_at`, `mfa_totp_secret null` (optional TOTP for lender roles).
- `memberships`: `user_id`, `org_id`, `roles text[]`, `status`. Unique `(user_id, org_id)`.
- `invitations`: `org_id`, `email|phone`, `roles`, `token_hash`, `expires_at`, `accepted_at`.
- `refresh_tokens`: `user_id`, `token_hash`, `family_id`, `expires_at`, `revoked_at`, `user_agent`, `ip`.
- `otp_codes`: `phone`, `purpose` (`login`, `farmer_login`, `signature`), `code_hash`, `expires_at` (5 min), `attempts` (max 5), `consumed_at`.
- `api_keys`: `org_id`, `name`, `prefix`, `key_hash`, `roles text[]`, `last_used_at`, `revoked_at`.

### 7.2 Platform core (`core`)

- `files`: `owner_org_id`, `bucket`, `object_key`, `filename`, `mime`, `size_bytes`, `sha256`, `visibility` (`private`, `shared_via_grant`), `linked_type`, `linked_id`, `uploaded_by`. Download through signed URL (5 min) after authz.
- `access_grants`: `resource_type`, `resource_id`, `grantee_org_id`, `scope`, `granted_by_event`, `expires_at null`. Index on `(grantee_org_id, resource_type)`.
- `audit_log` (append-only): `at`, `actor_type`, `actor_id`, `org_id`, `action`, `resource_type`, `resource_id`, `before jsonb`, `after jsonb`, `ip`, `request_id`, `prev_hash`, `hash` (SHA-256 of prev_hash + canonical JSON of row). A nightly job verifies the chain.
- `events_outbox`: `type`, `version`, `aggregate_type`, `aggregate_id`, `org_id`, `payload jsonb`, `occurred_at`, `dispatched_at null`, `attempts`.
- `idempotency_keys`: `key`, `principal_id`, `route`, `request_hash`, `response_status`, `response_body jsonb`, `expires_at`.
- `ref_sequences`: `prefix`, `year`, `last`.
- `feature_flags`: `org_id null`, `key`, `enabled`.
- `settings`: key/value platform settings (e.g. default RFP deadline days).

### 7.3 Farmers (`farmers`)

- `farmers`: `owner_org_id` (operator), `code` (per operator, e.g. `F-000123`), `first_name`, `last_name`, `sex` (`F`,`M`), `birth_year`, `phone`, `locale`, `national_id_type` (`cni`, `passport`, `other`, `none`), `national_id_number_enc`, `national_id_hash`, `photo_file_id`, `village`, `commune`, `home_location geometry(Point)`, `household_size`, `baseline_income_xof bigint null` (declared net farm income last season, for value-creation KPI), `mobile_wallet_provider` (`wave`, `orange_money`, `free_money`, `other`, `none`), `mobile_wallet_number_enc`, `mobile_wallet_hash`, `wallet_verified_at`, `consent_data_at`, `consent_credit_bureau_at`, `kyc_status` (`pending`, `verified`, `rejected`), `kyc_verified_by`, `status` (`active`, `inactive`).
  - Uniqueness per operator: `national_id_hash` (when present), `phone`.
  - Duplicate detection across operators by `national_id_hash` → flag (not block) in `farmer_flags`.
- `farmer_group_members`: `group_org_id`, `farmer_id`, `role` (`member`, `president`, `treasurer`, `secretary`), `joined_at`.
- `farmer_flags`: `farmer_id`, `type` (`duplicate_suspected`, `arrears`, `fraud_suspected`), `detail`, `resolved_at`.

### 7.4 Land and blocks (`land`)

- `blocks`: `ref`, `owner_org_id`, `name`, `region`, `department`, `commune`, `village`, `boundary geometry(MultiPolygon,4326)`, `area_ha`, `centroid geometry(Point)`, `water_source` (`borehole`, `river`, `canal`, `rainfed`, `other`), `irrigation_type` (`none`, `drip`, `sprinkler`, `furrow`, `pivot`), `tenure_type` (`title_foncier`, `bail`, `deliberation`, `customary_agreement`), `farmer_group_org_id null`, `solidarity_mode` (`none`, `group`), `solidarity_cap_pct numeric default 20`, `status block_status` (§8.1), `description`.
- `land_documents`: `block_id`, `doc_type` (`title_foncier`, `bail`, `deliberation`, `approval_prefect`, `community_agreement`, `cahier_des_charges`, `survey_plan`, `other`), `number`, `issued_by`, `issue_date`, `expiry_date null`, `file_id`, `status` (`submitted`, `verified`, `rejected`, `expired`), `verified_by`, `verified_at`, `comment`. Verification by `platform_admin` or a user with `land_document:verify` (platform legal reviewer role later).
- `plots`: `block_id`, `code` (unique within block, e.g. `P-001`), `geometry geometry(Polygon,4326)`, `area_ha`, `soil_type null`, `irrigated boolean`, `status` (`available`, `allocated`, `fallow`, `excluded`). Constraint (checked in service): plot geometry within block boundary (`ST_Within` with 1 m tolerance buffer) and no overlap > 1 % area with another active plot.
- `plot_allocations`: `plot_id`, `farmer_id`, `start_date`, `end_date null`, `share_pct numeric default 100`, `contract_id null`, `status` (`active`, `ended`). Sum of `share_pct` for active allocations of a plot ≤ 100.
- `block_assets`: `block_id`, `type` (`borehole`, `solar_pump`, `irrigation_network`, `fence`, `storage`, `equipment`, `building`, `other`), `description`, `capex_item_id null`, `location geometry(Point) null`, `commissioned_at null`.
- `community_grievances`: `block_id`, `reported_at`, `reporter`, `category`, `description`, `status`, `resolution`.

### 7.5 Catalogue (`catalogue`)

- `crops`: `code`, `name_fr`, `name_en`, `category` (`cereal`, `vegetable`, `legume`, `root`, `fruit`, `oilseed`, `other`), `perishable boolean`.
- `crop_varieties`: `crop_id`, `name`, `cycle_days`.
- `crop_templates`: `owner_org_id null` (null = platform default), `crop_id`, `variety_id null`, `zone` (agro-ecological zone code), `irrigated boolean`, `cycle_days`, `yield_base_t_ha`, `yield_stress_t_ha`, `post_harvest_loss_pct`, `delivery_rate_pct` (share delivered to block gate, default 95), `water_m3_ha`, `labour_days_ha`, `inputs jsonb` (list `{serviceId, qtyPerHa, unit}`), `notes`. Operator templates override platform templates.
- `service_catalog`: `owner_org_id null`, `code`, `name_fr`, `name_en`, `kind` (`seed`, `fertiliser`, `crop_protection`, `mechanisation`, `irrigation_opex`, `labour`, `training`, `transport`, `storage`, `insurance_premium`, `land_fee`, `operator_service_fee`, `investment_recovery_fee`, `platform_fee`, `other`), `unit` (`kg`, `l`, `ha`, `hour`, `day`, `unit`, `season`, `bag`), `default_unit_price_xof`.
- `zones`: `code`, `name`, `region_list text[]`.
- `market_prices`: `crop_id`, `market`, `date`, `price_xof_per_kg`, `source`.

### 7.6 Planning (`planning`)

- `seasons`: `block_id`, `name` (e.g. `Contre-saison froide 2026-27`), `kind` (`rainy`, `cold_dry`, `hot_dry`), `start_date`, `end_date`, `status season_status` (§8.2), `plan_version int`.
- `plantings`: `season_id`, `plot_id`, `crop_id`, `variety_id`, `template_id`, `area_ha` (≤ plot area), `planned_sowing_date`, `planned_harvest_date`, `yield_base_t_ha` (default from template, overridable), `yield_stress_t_ha`, `price_xof_per_kg_base`, `price_xof_per_kg_stress` (default: from offtake contract; stress default = base × 0.85).
- `supplier_quotes`: `owner_org_id`, `supplier_org_id null`, `supplier_name`, `service_id`, `unit`, `unit_price_xof`, `min_qty`, `valid_until`, `file_id`, `private boolean`.
- `budget_lines`: `season_id`, `scope` (`block`, `plot`, `per_ha_all`, `per_ha_crop`), `plot_id null`, `crop_id null`, `service_id`, `qty`, `unit`, `unit_price_xof`, `quote_id null`, `payer` (`farmer_credit`, `farmer_cash`, `operator`, `grant`), `tranche` (`seasonal`, `none`), `planned_date`, `notes`.
  - `farmer_credit` lines are financed by the seasonal tranche and allocated to farmers (§9.1.3).
- `capex_items`: `block_id`, `description`, `asset_type`, `amount_xof`, `useful_life_years`, `quote_id null`, `tranche` (`investment`, `equity`, `grant`), `planned_date`.
- `operator_opex`: `block_id`, `description`, `kind` (`staff`, `fuel`, `maintenance`, `security`, `insurance`, `admin`, `other`), `amount_xof_per_month`, `start_date`, `end_date null`.
- `fee_policies`: `block_id`, `operator_service_fee_xof_per_farmer_season`, `land_fee_xof_per_ha_season`, `investment_recovery_fee_xof_per_ha_season`, `effective_from`. (One active row per block.)

### 7.7 Offtake (`offtake`)

- `offtake_contracts`: `ref`, `block_id`, `season_id null` (null = multi-season), `buyer_org_id`, `crop_id`, `min_volume_kg`, `max_volume_kg`, `price_type` (`fixed`, `floor_plus_market`, `formula`), `price_xof_per_kg`, `floor_xof_per_kg null`, `formula_text null`, `quality_spec jsonb` (grades with price adjustments `[{grade, adjustmentPct}]`), `payment_terms_days`, `pays_into_escrow boolean`, `escrow_account_id null`, `status` (`draft`, `loi`, `signed`, `terminated`, `expired`), `file_id`, `signed_at`.
- Buyer due diligence fields on buyer organisations: `annual_volume_kg_estimate`, `years_in_business`, `bank_reference_file_id`.

### 7.8 Finance model runs (`finance`)

- `model_runs`: `block_id`, `season_id`, `financing_request_id null`, `engine_version`, `inputs_hash`, `inputs jsonb` (full snapshot), `outputs jsonb` (§9.1 output schema), `computed_at`, `computed_by`. Latest run per block/season is "current" iff its `inputs_hash` equals the hash of current inputs.

### 7.9 Dossier (`dossier`)

- `dossiers`: `ref`, `block_id`, `season_id`, `version int`, `status` (`draft`, `frozen`, `superseded`), `readiness_score int`, `grade` (`A`,`B`,`C`,`D`), `gates jsonb` (per gate pass/fail + reason codes), `score_breakdown jsonb`, `model_run_id`, `snapshot jsonb` (denormalised dossier content at freeze), `pdf_file_id`, `data_room_manifest jsonb` (list of file ids + labels), `frozen_at`.
- `risk_covers`: `tranche_id null`, `block_id`, `type` (`guarantee`, `index_insurance`, `indemnity_insurance`, `first_loss`), `provider_org_id null`, `provider_name`, `coverage_pct`, `cap_xof null`, `premium_xof null`, `status` (`proposed`, `committed`, `active`, `expired`), `file_id`.

### 7.10 Marketplace (`marketplace`)

- `lender_profiles`: `lender_org_id`, `name`, `active`, `crop_ids uuid[]` (empty = all), `regions text[]` (empty = all), `tranche_types text[]` (`seasonal`, `investment`), `min_ticket_xof`, `max_ticket_xof`, `min_readiness_score`, `max_tenor_months`, `requires_guarantee boolean`, `min_guarantee_pct`, `requires_insurance boolean`, `max_rate_bps null` (informational), `notes`.
- `financing_requests`: `ref`, `block_id`, `season_id`, `dossier_id`, `status` (`draft`, `submitted`, `in_tender`, `awarded`, `contracted`, `cancelled`), `submitted_at`.
- `tranches`: `financing_request_id`, `type` (`seasonal`, `investment`), `amount_xof`, `requested_tenor_months`, `requested_grace_months`, `repayment_profile` (`bullet`, `seasonal`, `annuity`, `equal_principal`), `borrower_type` (`operator`, `farmers`, `farmer_group`), `borrower_org_id null`, `purpose`, `status` (`open`, `fully_awarded`, `partially_awarded`, `unawarded`).
- `rfps`: `ref`, `financing_request_id`, `status rfp_status` (§8.3), `opened_at`, `deadline_at` (default open + 15 working days, Mon–Fri, Senegal public holidays table `holidays`), `closed_at`, `instructions`, `min_bid_share_pct` (default 20).
- `rfp_invitations`: `rfp_id`, `lender_org_id`, `lender_profile_id`, `match_reasons jsonb`, `status` (`invited`, `viewed`, `declined`, `bid_submitted`), `declined_reason null`, `invited_at`, `viewed_at`.
- `rfp_questions`: `rfp_id`, `asked_by_org_id`, `question`, `answer`, `answered_at`, `published boolean` (published answers visible to all invitees, asker anonymised).
- `bids`: `rfp_id`, `tranche_id`, `lender_org_id`, `status bid_status` (§8.4), `amount_xof`, `share_pct` (computed), `rate_bps` (annual nominal), `rate_method` (`flat`, `declining`), `upfront_fee_bps`, `tenor_months`, `grace_months`, `grace_type` (`interest_only`, `capitalised`), `repayment_profile`, `security_requirements text[]` (codes: `escrow_domiciliation`, `guarantee_fongip`, `insurance`, `equipment_pledge`, `group_guarantee`, `personal_guarantee`, `cash_collateral`, `other`), `cash_collateral_pct`, `conditions_precedent text[]`, `days_to_disbursement int`, `valid_until`, `submitted_at`, `submitted_by`, `comments`. Unique: one non-withdrawn bid per (rfp, tranche, lender).
- `bid_evaluations`: `bid_id`, `effective_annual_rate_bps`, `score_cost`, `score_share`, `score_speed`, `score_conditions`, `total_score`, `rank`, `computed_at`.
- `awards`: `rfp_id`, `bid_id`, `tranche_id`, `amount_xof`, `status` (`proposed`, `accepted_by_lender`, `declined_by_lender`, `cancelled`), `decided_by`, `decided_at`, `lender_response_at`.

### 7.11 Agreements (`agreements`)

- `contract_templates`: `code` (`block_framework`, `plot_production`, `offtake`, `loan_seasonal`, `loan_investment`, `escrow_mandate`), `locale`, `version`, `body_hbs text`, `variables_schema jsonb`, `active`.
- `contracts`: `ref`, `template_id`, `type`, `block_id`, `related_type`, `related_id`, `data jsonb`, `status contract_status` (§8.5), `pdf_file_id`, `signed_pdf_file_id`, `content_sha256`.
- `contract_parties`: `contract_id`, `party_type` (`org`, `farmer`), `org_id null`, `farmer_id null`, `role_label`, `signer_user_id null`, `signer_phone null`, `sign_order int`, `signed_at null`, `signature_id null`.
- `signatures`: `contract_id`, `party_id`, `method` (`otp_sms`, `otp_email`, `in_person_witnessed`), `signer_name`, `signer_identifier`, `ip`, `user_agent`, `geo null`, `content_sha256`, `signed_at`, `witness_user_id null`, `evidence_file_id null` (photo for in-person).

### 7.12 Facilities (`facilities`)

The lender's core banking system remains the system of record; Jappo mirrors the facility for monitoring and settlement.

- `escrow_accounts`: `lender_org_id`, `block_id`, `bank_name`, `account_label`, `account_number_masked`, `iban_enc null`, `status`.
- `facilities`: `ref`, `award_id`, `tranche_id`, `lender_org_id`, `borrower_type`, `borrower_org_id null`, `principal_xof`, `rate_bps`, `rate_method`, `upfront_fee_bps`, `tenor_months`, `grace_months`, `grace_type`, `repayment_profile`, `start_date`, `maturity_date`, `escrow_account_id`, `status facility_status` (§8.6), `lender_loan_ref null`.
- `facility_farmer_allocations` (seasonal facilities lent to or for farmers): `facility_id`, `farmer_id`, `principal_xof` (from §9.1.3 allocation), `interest_xof` (computed), `due_xof`.
- `schedule_lines`: `facility_id`, `seq`, `due_date`, `principal_xof`, `interest_xof`, `fees_xof`, `total_xof`, `paid_xof`, `status` (`due`, `paid`, `partial`, `overdue`).
- `disbursements`: `facility_id`, `ref`, `amount_xof`, `purpose`, `beneficiary_type` (`supplier`, `operator`, `farmer`), `beneficiary_org_id null`, `beneficiary_farmer_id null`, `budget_line_ids uuid[]`, `capex_item_ids uuid[]`, `status disbursement_status` (§8.7), `requested_by`, `approved_by`, `executed_at`, `bank_reference`, `proof_file_id`.
- `repayments`: `facility_id`, `settlement_run_id null`, `amount_xof`, `principal_xof`, `interest_xof`, `fees_xof`, `value_date`, `source` (`settlement`, `direct`, `guarantee_call`, `insurance`), `reference`.

### 7.13 Operations (`operations`)

- `service_deliveries`: `season_id`, `budget_line_id`, `plot_id null`, `farmer_id null`, `qty`, `unit`, `delivered_at`, `supplier_name`, `delivered_by_user_id`, `photo_file_id null`, `farmer_ack_method` (`otp`, `signature_photo`, `none`), `farmer_ack_at`, `geo geometry(Point) null`, `offline_client_id` (idempotent sync key).
- `field_visits`: `plot_id`, `planting_id null`, `agent_user_id`, `visited_at`, `geo`, `crop_stage` (`land_prep`, `sowing`, `emergence`, `vegetative`, `flowering`, `fruiting`, `maturity`, `harvested`, `failed`), `health_score int 1-5`, `estimated_yield_t_ha null`, `issues text[]` (`pest`, `disease`, `water_stress`, `flood`, `weeds`, `theft`, `livestock_damage`, `labour_shortage`, `input_missing`, `other`), `notes`, `photo_file_ids uuid[]`, `offline_client_id`.
- `alerts`: `block_id`, `season_id null`, `type`, `severity` (`info`, `warning`, `critical`), `source` (`rule`, `manual`), `rule_code null`, `message`, `data jsonb`, `status` (`open`, `acknowledged`, `resolved`), `acknowledged_by`, `resolved_at`.
- `alert_rules` (seeded, editable by platform admin): see §9.8.

### 7.14 Harvest and receipts (`harvest`)

- `harvest_deliveries`: `ticket_no` (unique per block), `season_id`, `plot_id`, `farmer_id`, `planting_id`, `crop_id`, `delivered_at`, `gross_kg`, `tare_kg`, `net_kg` (generated: gross − tare), `moisture_pct null`, `grade` (matches offtake `quality_spec`), `weighed_by_user_id`, `photo_file_id null`, `farmer_ack_method`, `farmer_ack_at`, `offline_client_id`, `status` (`recorded`, `dispatched`, `rejected`, `void`), `void_reason`.
- `dispatches`: `ref`, `season_id`, `offtake_contract_id`, `dispatched_at`, `vehicle`, `delivery_ids uuid[]`, `net_kg_total`, `buyer_accepted_kg null`, `buyer_rejected_kg null`, `buyer_accepted_at`, `buyer_comment`, `status` (`in_transit`, `accepted`, `partially_accepted`, `rejected`).
- `buyer_invoices`: `ref`, `offtake_contract_id`, `dispatch_ids uuid[]`, `accepted_kg`, `amount_xof` (Σ accepted kg × price adjusted by grade), `issued_at`, `due_date`, `status` (`issued`, `partially_paid`, `paid`, `overdue`, `disputed`), `pdf_file_id`.
- `escrow_receipts`: `escrow_account_id`, `amount_xof`, `value_date`, `payer_org_id`, `bank_reference`, `buyer_invoice_id null`, `recorded_by` (lender `credit_officer` or buyer `buyer_rep` with lender confirmation), `confirmed_by_lender_at`, `proof_file_id`, `status` (`recorded`, `confirmed`, `rejected`).
  - A receipt counts in settlement only when `confirmed` by the lender holding the escrow.

### 7.15 Settlement (`settlement`)

- `settlement_runs`: `ref`, `block_id`, `season_id`, `status settlement_status` (§8.8), `receipts_total_xof`, `inputs jsonb` (snapshot), `outputs jsonb` (§9.6 schema), `engine_version`, `computed_at`, `approved_operator_by/at`, `approved_lender_by/at` (one approval per lender with a facility on the block), `instructed_at`, `reconciled_at`.
- `settlement_lines`: `run_id`, `farmer_id`, `gross_credit_xof`, `seasonal_debt_paid_xof`, `investment_fee_paid_xof`, `operator_fees_paid_xof`, `other_deductions_xof`, `solidarity_contribution_xof`, `payout_xof`, `arrears_created_xof jsonb` (by bucket).
- `payout_instructions`: `run_id`, `beneficiary_type` (`lender`, `operator`, `farmer`, `supplier`), `beneficiary_id`, `channel` (`bank_transfer`, `mobile_money`), `destination_masked`, `amount_xof`, `status` (`pending`, `exported`, `sent`, `confirmed`, `failed`), `provider` (adapter code), `provider_ref`, `confirmed_at`, `failure_reason`.
- `farmer_arrears`: `farmer_id`, `block_id`, `origin_run_id`, `bucket` (`seasonal_debt`, `investment_fee`, `operator_fees`), `amount_xof`, `facility_id null`, `remaining_xof`, `status` (`open`, `settled`, `written_off`, `claimed_guarantee`).
- `farmer_statements`: `run_id`, `farmer_id`, `pdf_file_id`, `sms_text`, `sent_at`.

### 7.16 Monitoring (`monitoring`)

- `kpi_snapshots`: `scope_type` (`block`, `season`, `lender_portfolio`, `platform`), `scope_id`, `date`, `metrics jsonb` (§9.9 list).
- `reports`: `type` (`lender_monthly`, `season_close`, `guarantor_portfolio`), `scope`, `period`, `pdf_file_id`, `generated_at`.

### 7.17 Billing (`billing`)

- `plans`: `code`, `name`, `org_type`, `price_model` (`per_ha_season`, `annual_seat`, `free`), `unit_price_xof`, `structuring_fee_bps` (operator plans), `included_seats`, `features text[]`, `active`.
- `subscriptions`: `org_id`, `plan_id`, `start_date`, `end_date null`, `status`.
- `platform_invoices`: `ref`, `org_id`, `period_start`, `period_end`, `lines jsonb`, `amount_xof`, `tax_xof` (VAT 18 % configurable), `total_xof`, `status` (`draft`, `issued`, `paid`, `void`), `pdf_file_id`, `paid_at`, `payment_reference`.

### 7.18 Notifications and webhooks

- `notifications`: `recipient_type` (`user`, `farmer`), `recipient_id`, `channel` (`in_app`, `email`, `sms`), `template_code`, `data jsonb`, `status`, `sent_at`, `provider_ref`, `error`.
- `notification_preferences`: `user_id`, `event_type`, `channels text[]`.
- `webhook_endpoints`: `org_id`, `url`, `secret_enc`, `event_types text[]`, `active`.
- `webhook_deliveries`: `endpoint_id`, `event_id`, `status`, `attempts`, `last_status_code`, `next_attempt_at`.

---

## 8. Lifecycles (state machines)

Implement each as a table of allowed transitions in `packages/domain/src/lifecycles/*.ts` (`{from, action, to, guard?}`), used by services. Every transition writes audit + emits an event `<aggregate>.<action>` (e.g. `rfp.closed`).

### 8.1 Block

`draft → documenting` (first land doc or plot added, automatic)
`documenting → ready` (action `check_readiness`, guard: all gates pass)
`ready → documenting` (automatic when a gate fails after edits)
`ready → in_financing` (financing request submitted)
`in_financing → financed` (first facility active)
`in_financing → ready` (RFP cancelled/unawarded)
`financed → active` (season status `in_progress`)
`active → financed` (season settled, awaiting next season)
any → `archived` (action `archive`, guard: no active facility).

### 8.2 Season

`planning → financing → in_progress → harvest → settlement → closed`; `planning → cancelled`. `in_progress` is set by action `start` (guard: at least one disbursement confirmed or operator declares self-financed). `harvest` by first harvest delivery. `settlement` by action `start_settlement`. `closed` when settlement run is `reconciled`.

### 8.3 RFP

`draft → open` (action `open`; guard: dossier frozen, ≥ 1 invited lender; sets `opened_at`, `deadline_at`)
`open → closed` (job at `deadline_at`, or action `close_early` if all invited lenders bid or declined)
`closed → evaluation` (automatic: evaluations computed)
`evaluation → awarded` (action `award` with selection; guard: Σ awarded per tranche ≤ tranche amount)
`open|closed|evaluation → cancelled` (action `cancel`, reason required)
Deadline extension: action `extend` (only while `open`, max 2 times, notifies invitees).

### 8.4 Bid

`draft → submitted` (action `submit`, by `credit_committee`; guard: rfp `open`, before deadline, share ≥ `min_bid_share_pct` unless amount = remaining tranche)
`submitted → withdrawn` (while rfp `open`)
`submitted → opened` (when rfp closes)
`opened → awarded | not_awarded` (on rfp award)
`submitted|opened → expired` (when `valid_until` passes before award).

### 8.5 Contract

`draft → out_for_signature → partially_signed → signed`; `draft|out_for_signature|partially_signed → voided`. Editing data is only allowed in `draft`; content hash fixed at `out_for_signature`.

### 8.6 Facility

`pending_cp` (conditions precedent) `→ active` (action `confirm_cp` by lender) `→ repaid | in_arrears → repaid | defaulted | restructured`. `in_arrears` automatic when a schedule line is overdue > 0 days; `defaulted` by lender action when overdue > configurable days (default 90).

### 8.7 Disbursement

`requested → approved → executed → confirmed`; `requested|approved → rejected`. Request by operator `finance_officer`, approval and execution confirmation by lender `credit_officer` (two different users if the lender org has ≥ 2 users with the role — four-eyes).

### 8.8 Settlement run

`draft → computed → approved_operator → approved_lenders → instructed → executed → reconciled`; `computed|approved_* → draft` (action `recompute` voids approvals). `approved_lenders` requires approval from **every** lender with an active facility on the block. `executed` when all payout instructions are `confirmed` or `failed` with a recorded manual resolution. `reconciled` when Σ confirmed payouts = receipts total (± 0 XOF; any rounding residual is already allocated to the operator by §9.6).

---

## 9. Domain engines (`packages/domain`)

All engines: pure functions, inputs and outputs typed with Zod schemas in `packages/contracts`, `ENGINE_VERSION` constant, deterministic. Each has a golden test file with the exact example below.

### 9.1 Financial model engine — `computeBlockModel(input): ModelOutput`

#### 9.1.1 Inputs (summary)

Block, plots with allocations, plantings (area, yields base/stress, prices base/stress, template loss and delivery rates), budget lines, fee policy, capex items, operator opex, tranches (amount, rate, method, fees, tenor, grace, profile), seasons per year (from plan; default 1 if only one season planned), horizon months = max(investment tenor, 60), scenario definitions.

#### 9.1.2 Production and revenue per planting

```
yield = scenario.yield (base | stress | base × (1 − yieldShockPct))
production_t    = area_ha × yield
deliverable_kg  = production_t × 1000 × (1 − post_harvest_loss_pct/100) × (delivery_rate_pct/100)
revenue_xof     = deliverable_kg × price_xof_per_kg(scenario)
```

#### 9.1.3 Seasonal credit allocation to farmers

For each `budget_line` with `payer = farmer_credit`:
- `scope = plot` → cost to that plot.
- `scope = per_ha_all` → cost per ha × planting area for every planting.
- `scope = per_ha_crop` → same, restricted to plantings of that crop.
- `scope = block` → spread across all plantings pro rata to area.

Plot cost → farmers pro rata to `share_pct` of active allocations. Farmer seasonal principal = Σ allocated costs. Rounding: each farmer amount rounded half-even to XOF; the difference to the line total is added to the farmer with the largest allocation (deterministic tie-break by farmer code).

Interest per farmer on the seasonal tranche:
- `flat`: `principal × rate_bps/10000 × tenor_months/12`
- `declining` with bullet/seasonal profile: same as flat (single repayment).
- `declining` with instalments: from schedule (§9.5).

Farmer seasonal debt due = principal + interest + upfront fee (`principal × upfront_fee_bps/10000`, if charged to farmers per tranche config `fees_charged_to = farmers|operator`; default operator).

#### 9.1.4 Farmer P&L per season (per scenario)

```
gross_revenue        = Σ revenue of farmer's share of plantings
seasonal_debt_due    = §9.1.3
investment_fee       = fee_policy.investment_recovery_fee_xof_per_ha_season × farmer_ha
land_fee             = fee_policy.land_fee_xof_per_ha_season × farmer_ha
operator_service_fee = fee_policy.operator_service_fee_xof_per_farmer_season
farmer_cash_costs    = Σ budget lines payer=farmer_cash allocated to farmer
net_income           = gross_revenue − seasonal_debt_due − investment_fee − land_fee − operator_service_fee − farmer_cash_costs
value_created        = net_income − baseline_income_xof (null if no baseline)
HCR_farmer           = gross_revenue / seasonal_debt_due   (Harvest Coverage Ratio; null if debt 0)
```

#### 9.1.5 Block-level metrics

- `HCR_block` = Σ gross_revenue / Σ seasonal_debt_due (per scenario).
- `breakeven_yield_t_ha` per crop: the yield at which `HCR_block` = 1 holding prices constant, solved analytically: `Σdebt / (Σ area × 1000 × (1−loss) × delivery × price)` for a single-crop block; for multi-crop, apply a uniform yield multiplier `m` and report `m_breakeven = Σdebt / Σrevenue_base` and per-crop `yield_base × m_breakeven`.
- `breakeven_price_multiplier` = Σdebt / Σrevenue_base.
- Operator monthly cash flow over the horizon (months 0..H−1):
  - inflows: investment tranche disbursement (month 0), equity (capex with tranche `equity`), grants, operator fees collected (service, land, investment recovery fees) in each harvest month (planned harvest date month of each season, repeated each year for `seasons_per_year`), other operator revenue (none in V1).
  - outflows: capex (planned month), operator opex, investment debt service (schedule §9.5).
  - `CFADS_year` = Σ fees collected − opex in the year; `DSCR_year` = CFADS_year / debt_service_year; report `min_DSCR`, `avg_DSCR` (years with debt service > 0).
  - `operator_npv` at `discount_rate_bps` (input, default 1200), `operator_irr` (monthly IRR × annualised `(1+r)^12−1`, null if no sign change), `payback_month`.
- Stress scenarios (always computed): `base`, `yield_minus_20`, `price_minus_15`, `combined` (both), `delay_2m` (harvest receipts 2 months later; seasonal interest computed for tenor + 2 months).

#### 9.1.6 Output schema (abridged)

```ts
ModelOutput {
  engineVersion: string; inputsHash: string;
  scenarios: Record<ScenarioCode, {
    farmers: { farmerId; ha; grossRevenueXof; seasonalDebtDueXof; investmentFeeXof; landFeeXof;
               operatorServiceFeeXof; farmerCashCostsXof; netIncomeXof; valueCreatedXof|null; hcr|null }[];
    block: { grossRevenueXof; seasonalDebtDueXof; hcr; breakevenYieldMultiplier; breakevenPriceMultiplier;
             minDscr|null; avgDscr|null; operatorNpvXof; operatorIrr|null; paybackMonth|null };
    monthlyCashflow: { month; inflowXof; outflowXof; netXof; cumulativeXof }[];
  }>;
  warnings: { code; message }[];   // e.g. HCR_STRESS_BELOW_1, NEGATIVE_FARMER_NET_INCOME, PLOT_WITHOUT_ALLOCATION
}
```

Ratios: `numeric` rounded to 2 decimals (half-even) in outputs.

#### 9.1.7 Golden test FM-1 (single farmer, one planting)

Inputs: 1 plot 1.0000 ha, 1 farmer share 100 %, maize, yield base 4.0 t/ha, stress 3.2 t/ha, post-harvest loss 5 %, delivery rate 95 %, price base 250 XOF/kg; seasonal budget (farmer_credit) 450 000 XOF; seasonal tranche 18 % flat, 6 months, upfront fee charged to operator; fee policy: operator service 50 000 / farmer / season, investment recovery 100 000 / ha / season, land fee 0; no farmer cash costs; baseline income 150 000.

Expected (`base`):
- deliverable_kg = 3 610.000; gross revenue = **902 500**
- interest = 450 000 × 0.18 × 0.5 = **40 500**; seasonal debt due = **490 500**
- net income = 902 500 − 490 500 − 100 000 − 50 000 = **262 000**; value created = **112 000**
- HCR = 902 500 / 490 500 = **1.84**
- breakeven yield multiplier = 490 500 / 902 500 = **0.54** (→ breakeven yield 2.17 t/ha reported as `yield_base × 0.5435 = 2.17`, compute with full precision then round)

Expected (`yield_minus_20` using stress yield 3.2): deliverable 2 888 kg; gross revenue **722 000**; HCR **1.47**; net income **81 500**.

#### 9.1.8 Golden test FM-2 (annuity)

Investment tranche 10 000 000 XOF, 12 % declining, 36 monthly annuity instalments, no grace → instalment **332 143** (rounded half-even; last instalment absorbs rounding so Σ principal = 10 000 000 exactly). Total interest = Σ interest lines (assert Σ principal = 10 000 000 and every line total = 332 143 except last).

### 9.2 Readiness score — `computeReadiness(input): Readiness`

#### 9.2.1 Hard gates (all must pass to freeze a dossier)

| Code | Rule |
|---|---|
| G1_BOUNDARY | Block boundary exists; Σ active plot areas ≤ block area × 1.02 and ≥ 1 plot |
| G2_LAND_TITLE | ≥ 1 verified, non-expired doc of type `title_foncier` or `bail`; **or** a verified `deliberation` **and** a verified `approval_prefect` |
| G3_COMMUNITY | Verified `community_agreement` (waived if G2 satisfied by `title_foncier`) |
| G4_FARMERS | Every plot with a planting has ≥ 1 active allocation; every allocated farmer `kyc_status = verified` and `consent_data_at` set; if seasonal tranche borrower is farmers → `consent_credit_bureau_at` set |
| G5_PLAN | Season with ≥ 1 planting; every planting has yields and prices |
| G6_OFFTAKE | Offtake contracts with status `loi` or `signed` cover ≥ 60 % of base deliverable kg per crop (min volume counted) |
| G7_MODEL | Current model run (inputs hash matches) |
| G8_HCR | If a seasonal tranche is requested: `HCR_block` base ≥ 1.30 and `combined` ≥ 1.00 |
| G9_OPERATOR_KYC | Operator org `kyc_status = verified` |
| G10_ESCROW | Offtake contracts covering ≥ 60 % volume have `pays_into_escrow = true` |

Failures return reason codes with the offending entity ids (UI links to fix).

#### 9.2.2 Score (0–100) and grade

| Component | Max | Formula |
|---|---|---|
| Land security | 20 | title_foncier 20; bail ≥ remaining tenor + 12 months 18; bail shorter 12; approved deliberation + community agreement 15; anything else 0 |
| Offtake strength | 20 | `min(1, signed_coverage)` × 12 + (price_type `fixed` or `floor_plus_market` with floor: 4, else 0) + (buyer org KYC verified: 4) — coverage = signed min volume / base deliverable |
| Financial robustness | 20 | HCR base: ≥ 1.8 → 8, 1.5–1.8 → 6, 1.3–1.5 → 3; HCR combined: ≥ 1.3 → 6, 1.1–1.3 → 4, 1.0–1.1 → 2; minDSCR (if investment tranche): ≥ 1.5 → 6, 1.25–1.5 → 4, 1.1–1.25 → 2, else 0 (no investment tranche → 6) |
| Farmer quality | 10 | % farmers with verified wallet × 4 + % with credit bureau consent × 3 + (no farmer with open arrears from previous seasons: 3; else 3 × (1 − share in arrears)) |
| Risk cover | 15 | guarantee committed/active: `min(coverage_pct, 80)/80 × 8`; insurance committed/active 4; operator first-loss ≥ 5 % of tranche 3 |
| Operator capacity | 10 | prior settled seasons on platform: 0 → 0, 1 → 3, ≥ 2 → 5; agronomist or field agent ratio ≤ 50 ha per staff → 3; operator equity in capex ≥ 10 % → 2 |
| Data completeness | 5 | all plots with soil type 1; all farmers with photo 1; ≥ 1 field visit per plot in last 60 days or season not started 1; supplier quotes attached to ≥ 80 % of seasonal budget value 2 |

Bands are lower-inclusive (e.g. 1.5 ≤ x < 1.8). Score = Σ rounded to integer. Grade: A ≥ 80, B 65–79, C 50–64, D < 50.

Golden test RS-1: provide a fixture with title_foncier (20), signed coverage 70 % fixed price buyer verified (8.4+4+4 = 16.4), HCR base 1.84 (8), combined 1.18 (4), no investment tranche (6), wallets 100 % (4), consent 100 % (3), no arrears (3), FONGIP guarantee 80 % committed (8), no insurance (0), first loss 0 (0), operator 0 prior seasons (0), staff ratio ok (3), equity 0 (0), completeness all true (5) → total 20+16.4+18+10+8+3+5 = **80.4 → 80, grade A**.

### 9.3 Lender matching — `matchLenders(dossierSummary, profiles): Match[]`

Profile matches iff all: `active`; crop overlap (or profile crops empty); block region ∈ regions (or empty); tranche type ∈ profile types; `min_ticket ≤ tranche amount` (a lender may bid for a share: use `tranche.amount × min_bid_share_pct/100 ≥ min_ticket` OR `tranche.amount ≥ min_ticket`) and `max_ticket ≥ tranche.amount × min_bid_share_pct/100`; `readiness_score ≥ min_readiness_score`; `requested_tenor ≤ max_tenor_months`; guarantee and insurance requirements satisfied by committed risk covers. Output includes `reasons[]` (passed checks) for display; non-matches are not shown to the operator except to platform admin.

### 9.4 Bid evaluation — `evaluateBids(tranche, bids, schedules): Evaluation[]`

- **Effective annual rate (EAR):** build lender cash flows: month 0 = −(amount − upfront fee), then each schedule line total (§9.5) at its month. Monthly IRR `r` by Newton–Raphson (fallback bisection, tolerance 1e-10). `EAR = (1+r)^12 − 1`, reported in bps rounded half-even.
  - Golden test BE-1: 1 000 000, 18 % flat, 6 months bullet, upfront fee 1 % → flows −990 000 at m0, +1 090 000 at m6 → EAR **2122 bps** (21.22 %; tolerance ±1 bp).
- **Component scores (0–100):**
  - cost = `100 × min(EAR) / EAR_bid`
  - share = `100 × bid.amount / tranche.amount` (cap 100)
  - speed = `100 × min(days_to_disbursement) / days_bid` (min floor 1 day)
  - conditions = `100 − 15 × count(security_requirements not in {escrow_domiciliation, guarantee_fongip, insurance, group_guarantee}) − 10 × count(conditions_precedent) − cash_collateral_pct`, floored at 0
- **Total** = 0.50 cost + 0.20 share + 0.15 speed + 0.15 conditions (weights in `settings`, editable by platform admin). Rank descending; ties by earlier `submitted_at`.
- **Suggested allocation:** greedy by ascending EAR, filling the tranche up to 100 %; a bid can be partially taken only if the lender flagged `accepts_partial` (bid field, default true) and the partial ≥ `min_bid_share_pct`. The operator may override; the UI shows the weighted average EAR of the selection.

### 9.5 Schedules — `buildSchedule(facility): ScheduleLine[]`

Profiles: `bullet` (all principal + interest at maturity), `seasonal` (principal and interest due at each planned harvest month + `payment_terms` of offtake, N seasons within tenor), `annuity` (monthly), `equal_principal` (monthly). Grace: `interest_only` (interest paid monthly during grace, or at first harvest for seasonal) or `capitalised`. Interest methods: `flat` (on initial principal), `declining` (on outstanding). Day count: 30/360 monthly for instalments; for bullet flat: months/12. Rounding: each line half-even to XOF; last line adjusts principal so Σ principal = principal.

### 9.6 Settlement waterfall — `computeSettlement(input): SettlementOutput`

#### 9.6.1 Inputs

Confirmed escrow receipts total `R` for the block-season; per farmer delivered net kg by grade with contract price → **gross credit** `G_i = Σ net_kg × price × (1 + grade_adjustment)`, rounded half-even; farmer seasonal debts due (from `facility_farmer_allocations`, incl. open arrears from previous seasons in bucket `seasonal_debt` for the same facility lender, if the facility allows carry-over); investment fee, land fee, operator service fee per farmer (from fee policy); other agreed deductions; solidarity settings; operator investment instalments due this season (if investment borrower is operator).

#### 9.6.2 Algorithm

1. **Scale to receipts.** `G = Σ G_i`. If `R < G` (buyer paid less than deliveries' value), scale each `G_i' = floor(G_i × R / G)`; residual `R − ΣG_i'` goes to the farmer with the largest `G_i` (tie: farmer code). If `R > G`, the excess (e.g. price bonus) is distributed pro rata the same way. Hereafter `G_i` means scaled.
2. **Per farmer, in order:** pay from `G_i`:
   a. seasonal debt due (principal + interest + farmer-borne fees), up to available;
   b. investment recovery fee;
   c. land fee + operator service fee;
   d. other deductions;
   e. remainder = payout `P_i`.
   Unpaid amounts of (a)–(d) become `farmer_arrears` in the corresponding bucket.
3. **Solidarity** (if `solidarity_mode = group` and the seasonal tranche borrower is the farmer group or farmers with group guarantee): total seasonal shortfall `S = Σ unpaid (a)`. Cover `S` from payouts of farmers with `P_i > 0`, pro rata to `P_i`, each contribution capped at `solidarity_cap_pct × P_i`; contributions computed with floor, residual to the largest contributor still under cap. Covered amounts reduce the arrears of the short farmers proportionally (pro rata to their shortfall, floor + residual to the largest shortfall). Solidarity never covers buckets (b)–(d).
4. **Block-level distribution.**
   - Seasonal lenders: Σ (a) paid (+ solidarity) split among seasonal facilities pro rata to each facility's due amount, floor + residual to the largest facility.
   - Investment: Σ (b) goes **first** to the operator's investment instalments due this season (if operator is borrower), paid to the investment lender; any excess goes to the operator.
   - Operator: Σ (c) + any excess of (b) + other deductions designated to operator.
   - Farmers: `P_i` each.
   - **Invariant:** seasonal + investment + operator + Σ P_i = R exactly. Any rounding residual from step 4 goes to the operator.
5. **Instructions.** One payout instruction per beneficiary (farmers to verified mobile wallets; farmers without verified wallet → `bank_transfer` to operator **in trust** with a flag `held_for_farmer`, listed separately).

#### 9.6.3 Golden test WF-1 (no solidarity)

3 farmers, price 250 XOF/kg, grade adjustments 0. Seasonal facility: principal 3 000 000 at 18 % flat 6 months = interest 270 000; allocated F1 1 200 000 / F2 1 000 000 / F3 800 000 → interest 108 000 / 90 000 / 72 000 → due **1 308 000 / 1 090 000 / 872 000**. Investment recovery fee 100 000 each; operator service fee 50 000 each; land fee 0. Deliveries: F1 12 000 kg, F2 8 000 kg, F3 3 000 kg → G = 3 000 000 / 2 000 000 / 750 000. Receipts R = 5 750 000.

Expected:
| Farmer | Seasonal paid | Invest. fee | Operator fees | Payout | Arrears |
|---|---|---|---|---|---|
| F1 | 1 308 000 | 100 000 | 50 000 | **1 542 000** | 0 |
| F2 | 1 090 000 | 100 000 | 50 000 | **760 000** | 0 |
| F3 | 750 000 | 0 | 0 | **0** | seasonal 122 000; invest 100 000; operator 50 000 |

Block: seasonal lender **3 148 000**, investment **200 000**, operator **100 000**, farmers **2 302 000**; Σ = **5 750 000**.

#### 9.6.4 Golden test WF-2 (same, `solidarity_mode = group`, cap 20 %)

S = 122 000. Contributions pro rata to payouts 1 542 000 : 760 000. Exact shares: F1 81 721.98, F2 40 278.02. Floors: F1 81 721, F2 40 278 (Σ 121 999). The 1 XOF residual goes to the largest fractional part (F1, 0.98) → contributions F1 **81 722**, F2 **40 278**. Caps: 308 400 and 152 000 → not binding.
Payouts: F1 **1 460 278**, F2 **719 722**, F3 0. F3 arrears: seasonal 0, invest 100 000, operator 50 000. Seasonal lender **3 270 000**; investment 200 000; operator 100 000; farmers 2 180 000; Σ = 5 750 000.

(Rounding rule used everywhere a total is split: compute floors for all parts, then distribute the remaining XOF one at a time in descending order of fractional part, ties broken by farmer code (or facility id). A part whose cap is reached is skipped.)

#### 9.6.5 Output schema

```ts
SettlementOutput {
  engineVersion; receiptsTotalXof;
  lines: { farmerId; grossCreditXof; seasonalPaidXof; investmentFeePaidXof; operatorFeesPaidXof;
           otherDeductionsXof; solidarityContributionXof; solidarityReceivedXof; payoutXof;
           arrears: { seasonalDebtXof; investmentFeeXof; operatorFeesXof } }[];
  distribution: { seasonalByFacility: {facilityId; amountXof}[]; investmentToLenderXof;
                  investmentExcessToOperatorXof; operatorXof; farmersTotalXof; roundingToOperatorXof };
  invariants: { sumEqualsReceipts: true };
}
```

### 9.7 Ref generation, working days

`nextRef(prefix, year)`; `addWorkingDays(date, n, holidays)` (Mon–Fri, skip `holidays` table seeded with Senegal fixed holidays for 2026–2028; movable religious holidays are entered by platform admin).

### 9.8 Alert rules (evaluated by worker nightly and on relevant events)

| Code | Trigger | Severity |
|---|---|---|
| VISIT_GAP | No field visit on a planted plot for 21 days during `in_progress` | warning |
| HEALTH_LOW | Last visit health_score ≤ 2 | warning; ≤ 1 critical |
| YIELD_FORECAST_DROP | Avg estimated yield of last visits < 80 % of base for a crop | critical |
| INPUT_LATE | Budget line `planned_date` + 10 days passed without delivery | warning |
| DISBURSEMENT_LATE | Disbursement approved > 7 days without execution | warning |
| DELIVERY_SHORTFALL | At season end + 15 days, delivered kg < 85 % of expected (base, by farmer) | critical (also flags farmer side-selling suspicion) |
| BUYER_PAYMENT_OVERDUE | Buyer invoice past due date | critical |
| SCHEDULE_OVERDUE | Facility schedule line unpaid after due date | critical |
| LAND_DOC_EXPIRING | Land document expires within 90 days | warning |
| GRIEVANCE_OPEN | Community grievance open > 30 days | warning |

Alerts notify operator managers and, for blocks with active facilities, lender credit officers (in-app + email; critical also SMS).

### 9.9 KPIs (nightly snapshot per block/season and per lender portfolio)

Area financed (ha), farmers (count, % women, % youth < 35 by birth year), amounts disbursed and outstanding per tranche, schedule PAR30/PAR90 (portfolio at risk), repayment rate at maturity (Σ paid due / Σ due), expected vs delivered kg, yield achieved vs base, buyer payment delay (days), farmer net income avg and median, value created avg, service delivery cost per farmer, direct cost recovery (fees collected / service costs), time from dossier submission to first disbursement (days), alert counts by severity.

---

## 10. API surface (`/v1`)

Below: method, path, permission, notes. All list endpoints paginated. All mutations audited and emitting events. (Full request/response schemas are defined in `packages/contracts` following the domain model; field names are camelCase versions of column names.)

### 10.1 Auth and identity

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | /auth/signup | public | Creates operator (or lender/buyer, type chosen) org + org_admin user, sends email verification; org `kyc_status=pending` |
| POST | /auth/login | public | email+password → access token + refresh cookie; TOTP if enabled |
| POST | /auth/otp/request, /auth/otp/verify | public | phone login (users with phone) |
| POST | /auth/refresh, /auth/logout | session | refresh rotation, family revocation on reuse |
| POST | /auth/password/forgot, /auth/password/reset | public | |
| POST | /farmer-auth/otp/request, /farmer-auth/otp/verify | public | farmer principal |
| GET | /me | any | user, memberships, permissions for active org |
| GET/PATCH | /orgs/current | org:read / org:update | |
| POST | /orgs/current/kyc-documents | org:update | multipart |
| GET/POST/PATCH | /orgs/current/members, /invitations | member:manage | |
| GET/POST/DELETE | /orgs/current/api-keys | apikey:manage | key shown once |
| GET | /orgs/directory?type=lender | org:directory | public profile of verified lenders, buyers, guarantors, insurers |
| Admin | /admin/orgs, /admin/orgs/{id}/kyc/actions/{verify|reject}, /admin/land-documents/{id}/actions/{verify|reject}, /admin/plans, /admin/templates, /admin/settings, /admin/holidays, /admin/alert-rules, /admin/audit | platform_admin | |

### 10.2 Files

`POST /files` (multipart, ≤ 25 MB, MIME allow-list pdf/jpg/png/webp/docx/xlsx/csv/geojson/kml/zip), `GET /files/{id}` (metadata), `GET /files/{id}/download` (302 to signed URL after authz).

### 10.3 Farmers

`GET/POST /farmers`, `GET/PATCH /farmers/{id}`, `POST /farmers/{id}/actions/verify-kyc`, `POST /farmers/{id}/actions/verify-wallet` (sends OTP to the wallet phone; verify via `POST /farmers/{id}/actions/confirm-wallet`), `POST /farmers/import` (CSV, template downloadable at `GET /farmers/import-template`; returns row-level errors; idempotent by phone/national id), `GET /farmers/{id}/history` (allocations, deliveries, statements, arrears).

### 10.4 Land

`GET/POST /blocks`, `GET/PATCH /blocks/{id}`, `PUT /blocks/{id}/boundary` (GeoJSON MultiPolygon or Polygon; also accepts KML/GeoJSON file id), `GET /blocks/{id}/map` (GeoJSON FeatureCollection: boundary, plots, assets, visits last 30 days), `GET/POST /blocks/{id}/land-documents`, `GET/POST /blocks/{id}/plots`, `PATCH/DELETE(archive) /plots/{id}`, `POST /blocks/{id}/plots/actions/auto-grid` (split boundary into N plots of target size along the longest axis — helper for design), `GET/POST /plots/{id}/allocations`, `POST /allocations/{id}/actions/end`, `GET/POST /blocks/{id}/assets`, `GET/POST /blocks/{id}/grievances`, `POST /blocks/{id}/actions/{check-readiness|archive}`.

### 10.5 Catalogue

`GET /crops`, `GET /crop-templates?crop=&zone=&irrigated=`, `POST/PATCH /crop-templates` (operator override), `GET/POST /services`, `GET /market-prices`, admin CRUD for platform defaults.

### 10.6 Planning

`GET/POST /blocks/{id}/seasons`, `GET/PATCH /seasons/{id}`, `POST /seasons/{id}/actions/{start|start-settlement|cancel}`, `GET/POST /seasons/{id}/plantings`, `POST /seasons/{id}/plantings/actions/bulk-assign` (crop to many plots), `GET/POST /seasons/{id}/budget-lines`, `POST /seasons/{id}/budget-lines/actions/generate-from-templates`, `GET/POST /supplier-quotes`, `GET/POST /blocks/{id}/capex-items`, `GET/POST /blocks/{id}/operator-opex`, `GET/PUT /blocks/{id}/fee-policy`.

### 10.7 Offtake

`GET/POST /offtake-contracts`, `GET/PATCH /offtake-contracts/{id}`, `POST /offtake-contracts/{id}/actions/{mark-loi|mark-signed|terminate}`; buyer side: `GET /buyer/contracts`, `GET /buyer/dispatches`.

### 10.8 Finance model and dossier

`POST /seasons/{id}/model-runs` (computes now, sync, < 2 s for 500 farmers), `GET /model-runs/{id}`, `GET /seasons/{id}/model-runs/current`, `POST /seasons/{id}/model-runs/preview` (unsaved what-if with overrides: yield shock, price shock, rate), `GET /seasons/{id}/readiness`, `POST /seasons/{id}/dossiers` (freeze: guard gates; creates snapshot, enqueues PDF), `GET /dossiers/{id}`, `GET /dossiers/{id}/pdf`, `GET /dossiers/{id}/data-room` (file list with labels), `GET/POST /blocks/{id}/risk-covers`.

### 10.9 Marketplace

Lender: `GET/POST/PATCH /lender-profiles`, `GET /lender/opportunities` (invitations with match reasons and status), `POST /rfps/{id}/actions/{view|decline}`, `GET /rfps/{id}` (lender view), `GET/POST /rfps/{id}/questions`, `GET/POST /rfps/{id}/bids` (own bids), `PATCH /bids/{id}` (draft), `POST /bids/{id}/actions/{submit|withdraw}`, `POST /awards/{id}/actions/{accept|decline}`.
Operator: `POST /financing-requests` (from frozen dossier, with tranches), `GET/PATCH /financing-requests/{id}`, `POST /financing-requests/{id}/actions/{submit|cancel}`, `GET /financing-requests/{id}/matches` (computed matches), `POST /rfps` (from request; invite list defaults to all matches, operator can deselect), `POST /rfps/{id}/actions/{open|extend|close-early|cancel}`, `POST /rfps/{id}/questions/{qid}/answer`, `GET /rfps/{id}/bids` (only after close), `GET /rfps/{id}/evaluation` (scores, ranks, suggested allocation), `POST /rfps/{id}/actions/award` (body: list of `{bidId, amountXof}`).

### 10.10 Agreements

`GET /contract-templates`, `POST /contracts` (type + related entity → data assembled automatically from block/award/etc.; operator can edit free-text clauses defined as editable in the template schema), `GET /contracts/{id}`, `GET /contracts/{id}/pdf`, `POST /contracts/{id}/actions/{send|void}`, `POST /contracts/{id}/signatures/actions/request-otp` (for the current principal's party), `POST /contracts/{id}/signatures` (OTP code; or in-person: field agent with witness + photo evidence for farmers), `POST /blocks/{id}/contracts/actions/generate-pack` (generates framework, plot contracts for all allocated farmers, loan contracts from awards, escrow mandate).

### 10.11 Facilities and disbursements

`GET /facilities?blockId=`, `GET /facilities/{id}` (with schedule), `POST /facilities/{id}/actions/{confirm-cp|mark-default|restructure}` (lender), `PATCH /facilities/{id}` (lender loan ref), `GET/POST /escrow-accounts` (lender), `GET/POST /facilities/{id}/disbursements` (operator request), `POST /disbursements/{id}/actions/{approve|reject|execute|confirm}` (lender), `GET /facilities/{id}/repayments`.

### 10.12 Operations and harvest

`GET/POST /seasons/{id}/service-deliveries`, `GET/POST /plots/{id}/visits`, `GET /blocks/{id}/alerts`, `POST /alerts/{id}/actions/{acknowledge|resolve}`, `GET/POST /seasons/{id}/harvest-deliveries`, `POST /harvest-deliveries/{id}/actions/void`, `GET/POST /seasons/{id}/dispatches`, `POST /dispatches/{id}/actions/{accept}` (buyer, with accepted/rejected kg), `GET/POST /buyer-invoices` (generated from accepted dispatches), `GET/POST /escrow-receipts` (buyer or lender records), `POST /escrow-receipts/{id}/actions/{confirm|reject}` (lender).

### 10.13 Field sync (PWA)

`GET /field/bootstrap?blockIds=` (everything the agent needs offline: blocks, plots, farmers (masked PII), plantings, budget lines, templates, last visits) with `syncToken`; `POST /field/sync` (batch of operations `{clientId, type, payload, createdAt}`: `farmer.create`, `farmer.update`, `plot.create`, `plot.updateGeometry`, `visit.create`, `serviceDelivery.create`, `harvestDelivery.create`, `photo.attach`), idempotent by `clientId`, returns per-op result and server changes since `syncToken`. Photos uploaded separately via `/files` then attached by op.

### 10.14 Settlement

`POST /seasons/{id}/settlement-runs` (compute), `GET /settlement-runs/{id}` (with lines and distribution), `POST /settlement-runs/{id}/actions/{recompute|approve-operator|approve-lender|instruct|mark-executed|reconcile}`, `GET /settlement-runs/{id}/instructions` (+ `?format=csv` export per provider format), `POST /payout-instructions/{id}/actions/{confirm|fail}`, `POST /settlement-runs/{id}/instructions/actions/import-confirmations` (CSV from bank/mobile money), `GET /settlement-runs/{id}/statements`, `POST /settlement-runs/{id}/statements/actions/send` (SMS + PDF), `GET /farmers/{id}/arrears`.

### 10.15 Monitoring and reports

`GET /dashboards/operator`, `GET /dashboards/lender` (portfolio across blocks with grants), `GET /dashboards/block/{id}`, `GET /kpis?scopeType=&scopeId=&from=&to=`, `POST /reports` (type, scope, period → PDF job), `GET /reports/{id}`.

### 10.16 Farmer self-service

`GET /me/farmer` (profile masked), `GET /me/farmer/plots`, `GET /me/farmer/statements`, `GET /me/farmer/statements/{id}/pdf`.

### 10.17 Billing

`GET /billing/plans` (public), `GET /billing/subscription`, `POST /billing/subscription` (change plan), `GET /billing/invoices`, `GET /billing/invoices/{id}/pdf`; admin `POST /admin/invoices/{id}/actions/{mark-paid|void}`.

### 10.18 Webhooks, events, health

`GET/POST/DELETE /webhooks`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/{id}/actions/test`, `GET /events?since=` (org-scoped event feed for polling integrations), `GET /health`, `GET /ready`, `GET /metrics` (internal network only).

---

## 11. Events, webhooks and the extension framework

### 11.1 Domain events

Written to `events_outbox` in the same transaction as the change. Envelope:

```json
{ "id": "uuidv7", "type": "rfp.closed", "version": 1, "occurredAt": "...", "orgId": "...",
  "aggregate": { "type": "rfp", "id": "..." }, "actor": { "type": "user", "id": "..." }, "data": { } }
```

Catalogue (V1): `org.kyc_verified`, `farmer.created`, `farmer.kyc_verified`, `block.created`, `block.boundary_updated`, `block.ready`, `land_document.verified`, `plot.allocated`, `season.started`, `model_run.computed`, `dossier.frozen`, `financing_request.submitted`, `rfp.opened`, `rfp.question_published`, `rfp.closed`, `bid.submitted`, `bid.withdrawn`, `rfp.awarded`, `award.accepted`, `award.declined`, `contract.sent`, `contract.signed`, `facility.activated`, `disbursement.requested|approved|executed|confirmed`, `service_delivery.recorded`, `visit.recorded`, `alert.raised`, `harvest_delivery.recorded`, `dispatch.accepted`, `buyer_invoice.issued`, `escrow_receipt.confirmed`, `settlement.computed|approved|instructed|reconciled`, `payout.confirmed`, `statement.sent`, `facility.overdue`, `invoice.issued`.

### 11.2 Webhooks

Org admins subscribe to event types visible to their org (visibility rules §6 apply to event delivery). POST JSON envelope with headers `Jappo-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`, `Jappo-Event-Id`. Retries with exponential backoff (1 m, 5 m, 30 m, 2 h, 12 h, 24 h), then `failed`. Delivery log visible in UI.

### 11.3 Extension framework (how new services plug in)

Every module (core and future) implements:

```ts
export interface JappoModule {
  name: string;                         // 'harvest', 'carbon', 'satellite'
  version: string;
  dependsOn?: string[];                 // module names; enforce acyclic, core modules may not depend on extensions
  migrationsDir?: string;               // own SQL migrations, namespaced tables (prefix = module name)
  permissions?: PermissionDef[];        // new 'resource:action' strings + default role mapping
  routes?: (app: FastifyInstance, ctx: ModuleContext) => Promise<void>;   // mounted under /v1
  eventHandlers?: Record<EventType, (event: DomainEvent, ctx: ModuleContext) => Promise<void>>;
  jobs?: JobDef[];                      // pg-boss jobs (cron or on-demand)
  readinessContributors?: ReadinessContributor[];  // optional extra gates/score components (weights must keep total 100 via settings)
  dossierSections?: DossierSectionDef[];           // extra sections in dossier PDF and data room
  ui?: { navItems: NavItemDef[]; workspace: OrgType[] };  // web reads /v1/modules to render navigation
  featureFlag?: string;                 // module active only for orgs with the flag/plan feature
}
```

- Modules are registered in `apps/api/src/modules/index.ts`. `GET /v1/modules` returns active modules and nav items for the current org.
- The web app has a route group `app/(app)/x/[module]/...` where extension UIs live; core navigation is generated from `/v1/modules`.
- Feature flags and plans gate modules per org.
- Examples to keep in mind (not built in V1): `satellite` (NDVI per plot, readiness contributor), `iot` (solar pump telemetry → alerts), `carbon` (practice records), `scoring` (ML farmer score as dossier section), `insurance-api` (CNAAS quote), `mobile-money-wave` (payout adapter).

---

## 12. Frontend

### 12.1 General

- Next.js App Router. Route groups: `(public)` marketing + pricing + signup/login; `(app)` authenticated workspaces; `field` PWA; `me` farmer portal.
- Layout: left sidebar (generated from modules + role), top bar with org switcher, locale switcher, notifications bell, user menu.
- Design: shadcn/ui, neutral palette with one green accent; data-dense tables (TanStack Table) with saved filters; all forms with inline validation from Zod schemas shared via SDK types.
- Every list: search, filters, CSV export. Every entity page: header with status badge and allowed actions (from API `allowedActions[]` field returned with each resource), tabs, activity timeline (audit entries + comments).
- Empty states explain the next step and link to it (no dead ends).
- Responsiveness: workspaces usable on tablet (≥ 768 px); field PWA designed for phone (≥ 360 px).
- Accessibility: WCAG 2.1 AA for forms and tables.

### 12.2 Public site

Landing (value for operators and lenders), how it works (waterfall diagram), pricing (from `/billing/plans`), signup (choose org type: operator / lender / buyer), login, legal pages (terms, privacy — template text with placeholders the admin edits in `/admin/settings`).

### 12.3 Operator workspace

1. **Home:** KPIs, blocks by status, alerts, tasks (gates failing, signatures pending, approvals pending).
2. **Blocks list + map view** (all blocks on a map, colored by status).
3. **Block page** tabs:
   - *Overview:* map, area, farmers, status, readiness ring, next actions.
   - *Land:* boundary editor (draw/import KML/GeoJSON), documents with verification status.
   - *Plots:* map editor (draw, split, auto-grid), table, allocations (assign farmers, drag-and-drop list), plot detail.
   - *Farmers:* list scoped to block, import CSV, KYC status, wallet verification.
   - *Seasons:* season list → season page with sub-tabs *Plan* (plantings grid plot × crop, bulk assign), *Budget* (lines generated from templates, edit, quotes attach, totals per farmer/per ha), *Model* (scenarios table, farmer P&L table, charts: revenue vs debt, monthly cash flow; what-if sliders using preview endpoint), *Readiness* (gates checklist with fix links, score breakdown), *Dossier* (freeze, PDF preview, data room), *Financing* (request, tranches, matches, RFP, Q&A, bids comparison after close, award), *Contracts* (pack generation, signature progress per party), *Disbursements*, *Operations* (deliveries, visits feed with photos, alerts), *Harvest* (weighing tickets, dispatches, invoices, receipts), *Settlement* (compute, review lines, approvals, instructions export, confirmations import, statements).
   - *Assets*, *Community* (grievances), *Offtake* (contracts), *Risk covers*, *Activity*.
4. **Farmers** (all), **Suppliers & quotes**, **Buyers & contracts**, **Reports**, **Settings** (org, members, API keys, webhooks, billing, templates overrides).

### 12.4 Lender workspace

1. **Home:** new opportunities, deadlines, portfolio KPIs (outstanding, PAR, repayment rate), approvals pending (disbursements, settlements, CPs).
2. **Appetite profiles** (create several; preview "how many current dossiers would match").
3. **Opportunities:** invitations list with match reasons, deadline countdown; **RFP page:** dossier viewer (structured, not only PDF), map, model with own what-if (preview, read-only), data room downloads (watermarked PDF with lender name and timestamp), Q&A, **bid form** (per tranche; live EAR calculation and schedule preview), submit (credit_committee only).
4. **Awards** (accept/decline, then escrow account setup).
5. **Portfolio:** facilities list, facility page (schedule, disbursements, repayments, block monitoring dashboard, alerts, visits, harvest progress vs expected, settlement approvals).
6. **Reports:** monthly lender report PDF per facility/portfolio.

### 12.5 Buyer portal

Contracts, expected volumes calendar, dispatches to accept (kg accepted/rejected, grade), invoices, record payment into escrow (amount, date, reference, proof upload).

### 12.6 Guarantor / insurer view

Portfolio of covered facilities, exposure, PAR, claims candidates (arrears > threshold), block monitoring read-only.

### 12.7 Platform admin console

Org KYC queue, land document verification queue, users, plans and subscriptions, invoices, catalogue (crops, templates, services, zones, market prices), contract templates editor (Handlebars with variable list and preview), settings (scoring weights, gate thresholds, RFP defaults, VAT), holidays, alert rules, audit log viewer with hash-chain status, webhooks delivery monitor, system health.

### 12.8 Field PWA (`/field`)

Installable, offline-first. Login online once; token refresh when online. Screens: choose block(s) to sync; **Enrol farmer** (form + photo + ID photo + GPS); **Map plot** (walk boundary: record GPS points every 5 m or tap; or draw on cached tiles) ; **Allocate**; **Visit** (stage, health, issues, estimated yield, photos); **Service delivery** (budget line, qty, farmer acknowledgement by OTP when online or signature/photo offline); **Harvest weighing** (ticket auto-number `block-agentShort-seq`, gross/tare, grade, farmer ack); **Sync status** (queue, conflicts). Conflict policy: server wins for master data edited by office users after the client's base version; client creates are never lost (rejected ops shown with reason for correction).

### 12.9 Farmer portal (`/me`)

Phone + OTP; shows plots, season status, deliveries, statements (PDF), arrears. Simple French/English, large type.

---

## 13. External adapters

Each adapter has an interface in `apps/api/src/core/adapters/<kind>/index.ts`, a `mock`/`manual` implementation that fully works in V1, and env selection.

| Kind | Interface | V1 implementations | Env |
|---|---|---|---|
| SMS | `send(to, text) → {providerRef}` | `console` (dev, logs + stores), `http_generic` (configurable POST URL, auth header, body template — works with most Senegal SMS gateways) | `SMS_PROVIDER`, `SMS_HTTP_*` |
| Email | `send(msg)` | SMTP | `SMTP_*` |
| Storage | S3 put/get/sign | MinIO/S3 | `S3_*` |
| PDF | `render(templateCode, data, locale) → Buffer` | Playwright Chromium in worker | — |
| Payouts | `export(instructions) → File`, `send?(instructions)`, `parseConfirmations(file)` | `manual_csv` (generic CSV: beneficiary, wallet/account, amount, reference), `wave_bulk_csv` and `orange_money_bulk_csv` export formats (columns configurable in settings); `send` not implemented in V1 → instructions marked `exported`, confirmation by import or manual | `PAYOUT_PROVIDERS` |
| Maps tiles | URL template | OSM raster default; satellite tile URL configurable | `NEXT_PUBLIC_TILE_URL`, `NEXT_PUBLIC_SAT_TILE_URL` |
| Credit bureau | `consentRecord`, `check?` | `manual` (lender records check result as document) | — |

---

## 14. Documents and contract generation

### 14.1 PDFs (Handlebars → HTML → PDF)

| Code | Content |
|---|---|
| `dossier` | Cover (block ref, grade, score), summary, map image (static render via MapLibre in Playwright), land, farmers summary (counts, women %, not full PII), plan, budget, offtake, model tables and charts (inline SVG), stress tests, risk covers, gates, data room index. Footer: version, frozen date, content hash |
| `lender_report` | Facility status, schedule, repayments, harvest vs expected, alerts, KPIs |
| `farmer_statement` | Farmer, plots, deliveries (tickets), gross credit, deductions by bucket, solidarity, payout, arrears, payment reference |
| `settlement_summary` | Receipts, distribution table, approvals, instruction list |
| `buyer_invoice`, `platform_invoice` | Standard invoice layout (OHADA-compliant mentions: NINEA, RCCM, VAT) |
| `contract` | From contract templates |

Data-room PDFs downloaded by lenders are watermarked "Confidential — <Lender> — <date time>".

### 14.2 Contract templates (seeded, fr + en, editable by platform admin)

`block_framework` (parties, block, roles, escrow domiciliation, waterfall order, solidarity, reporting, step-in right, dispute resolution — OHADA/CCJA or Senegal courts as variable), `plot_production` (farmer, plot, duration, services, price formula, deductions, delivery obligation, prohibition of side-selling, data consent), `offtake` (volumes, quality, price, payment to escrow), `loan_seasonal`, `loan_investment` (from award terms, schedule annex), `escrow_mandate` (irrevocable payment instruction from operator and buyer to lender). Each template begins with a notice in the admin editor: "Template text must be reviewed by counsel before production use." The seed text is a structured draft with all variables wired, so the flow is complete.

---

## 15. Billing (in-product)

Seeded plans (prices are settings, editable):

| Code | Org type | Model | Default price |
|---|---|---|---|
| `operator_starter` | operator | per_ha_season | 5 000 XOF / ha / season, structuring fee 100 bps on awarded amount |
| `operator_pro` | operator | per_ha_season | 4 000 XOF / ha / season, 75 bps, priority support, API keys + webhooks |
| `lender_monitoring` | lender | annual_seat | 1 200 000 XOF / year, 5 seats |
| `free_partner` | buyer, guarantor, insurer | free | 0 |

Invoicing jobs: per-ha fee invoiced when a season moves to `in_progress` (hectares planted); structuring fee invoiced at `award.accepted`; lender seat licence invoiced yearly at subscription start. Invoices PDF + email; payment recorded by platform admin (mark paid with reference). Overdue > 30 days → org banner; > 60 days → read-only mode for that org (except settlement and statements, which must never be blocked).

---

## 16. Seed and demo data

`pnpm seed` creates (fictional names only):

- Platform org "Jappo Platform" + admin `admin@jappo.local` / password from env.
- Operator "Ferme Commune Kawral SARL" (verified) with users: manager, agronomist, 2 field agents, finance officer.
- Farmer group "GIE des Femmes de Niaguis" (fictional).
- Lenders: "Mutuelle Alpha SFD" (sfd, seasonal profile), "Banque Beta SA" (bank, investment profile), "Fonds Gamma" (dfi, both, first-loss interest).
- Guarantor "Fonds de Garantie Delta"; insurer "Assurance Agricole Epsilon"; buyer "Agro-Négoce Zeta SA"; supplier "Intrants Eta".
- Catalogue: 10 crops (maize, rice, onion, tomato, groundnut, millet, sorghum, cowpea, potato, chilli), templates for zones `casamance`, `niayes`, `vallee`, `bassin_arachidier` (irrigated and rainfed), 30 services.
- Block BLK-2026-0001 near Ziguinchor (realistic polygon ~10 ha), 20 plots of 0.5 ha, 20 women farmers verified with wallets, documents verified (deliberation + prefect approval + community agreement), season "Contre-saison 2026-27" with onion and maize, budget, offtake LOI 80 % volume into escrow, risk covers (guarantee 80 % committed), fee policy.
- A second block in `draft` state to show gates failing.
- Holidays 2026–2028 fixed dates.
- Scenario data fixtures used by e2e (§17 P11).

`pnpm seed:demo-lifecycle` additionally runs the API through the whole lifecycle so a sales demo shows every screen populated.

---

## 17. Build phases, Definition of Done, acceptance

Each phase: migrations, domain (if any), API + OpenAPI, SDK regen, UI, tests (unit, integration incl. authz negatives, Playwright). DoD = all tests green + `pnpm verify` clean + PROGRESS updated.

| Phase | Scope | Key DoD checks |
|---|---|---|
| **P0 Scaffold** | Monorepo, compose (postgres+postgis, minio, mailpit), Fastify skeleton with error/pagination/idempotency/ETag plugins, Next.js shell with i18n, CI, `/health`, OpenAPI served, SDK generation script | `docker compose up` → API health OK, web loads, CI green |
| **P1 Identity & core** | Orgs, users, memberships, invitations, auth (password, OTP, refresh rotation, TOTP optional), API keys, authz engine, access grants, files, audit hash chain, outbox + worker dispatch, notifications (in-app, email, SMS console), admin KYC queue, public signup | Signup → KYC verify → invite member → login; authz negative suite scaffold; audit chain verify job |
| **P2 Land & farmers** | Farmers CRUD/import/KYC/wallet OTP, blocks, boundary, land docs + verification, plots (draw, auto-grid, overlap/within checks), allocations, assets, grievances, map endpoints, field PWA: bootstrap, enrol farmer, map plot, sync | Build a block with 20 plots and 20 farmers from UI and from PWA offline then sync |
| **P3 Catalogue, planning, offtake** | Catalogue, templates, seasons, plantings, budget generation, quotes, capex, opex, fee policy, offtake contracts, buyer portal contracts view | Budget totals per farmer match manual calculation fixture |
| **P4 Model, readiness, dossier** | `computeBlockModel`, `computeReadiness`, schedules, model runs, preview, readiness UI, dossier freeze, PDF, data room | Golden tests FM-1, FM-2, RS-1 pass; dossier PDF generated with map and charts |
| **P5 Marketplace** | Lender profiles, financing requests/tranches, matching, RFP lifecycle with deadline job and working days, Q&A, bids, sealed rules, evaluation (EAR, scores, suggested allocation), award, accept/decline | BE-1 passes; sealed-bid authz tests; deadline job closes RFP |
| **P6 Agreements & facilities** | Templates, contract generation pack, OTP e-sign, in-person signing in PWA, facilities from awards, schedules, CP confirmation, escrow accounts, disbursement four-eyes flow | Full pack signed; facility active with schedule; disbursement confirmed |
| **P7 Operations & harvest** | Service deliveries, visits, alert rules engine, harvest weighing (PWA), dispatches, buyer acceptance, buyer invoices, escrow receipts + lender confirmation | Alerts raised by rules on fixture; invoice amounts correct with grade adjustments |
| **P8 Settlement** | `computeSettlement`, runs, approvals (operator + every lender), instructions export (3 formats), confirmations import, arrears, repayments posting to schedules, statements PDF + SMS, farmer portal | Golden WF-1 and WF-2 pass; reconciliation invariant enforced |
| **P9 Monitoring** | KPI snapshot job, dashboards (operator, lender, block, guarantor), reports PDFs | KPIs on fixture match expected values file |
| **P10 Commercial** | Plans, subscriptions, invoicing jobs, overdue rules, public site, pricing, admin console completion, webhooks UI, `/v1/modules` + generated navigation | New operator can self-signup, subscribe, and is invoiced at season start |
| **P11 Hardening & acceptance** | Security tests (rate limits, OTP brute force, IDOR suite), backup/restore scripts tested, prod compose with Caddy, RUNBOOK, API.md, performance check, `pnpm e2e:full` | Full scenario below passes on a clean prod-like stack |

### 17.1 End-to-end acceptance scenario (`pnpm e2e:full`)

1. New operator signs up, uploads KYC; admin verifies.
2. Operator creates a block, imports boundary GeoJSON, uploads deliberation + prefect approval + community agreement; admin verifies them.
3. Auto-grid 3 plots of ~1 ha; field agent (PWA, offline mode simulated) enrols 3 farmers with wallets, allocates them; sync.
4. Season with maize; budget generated so farmer credit = 1 200 000 / 1 000 000 / 800 000; fee policy 100 000/ha investment recovery (plots exactly 1 ha), 50 000/farmer operator fee; offtake signed 250 XOF/kg into escrow; guarantee committed 80 %.
5. Model run; readiness gates all pass; freeze dossier; PDF exists.
6. Financing request: seasonal tranche 3 000 000, 6 months bullet; RFP opened to matched lenders (Mutuelle Alpha, Fonds Gamma).
7. Alpha bids 100 % at 18 % flat, fee 1 %, 10 days; Gamma bids 100 % at 20 % flat, 0 fee, 5 days. Deadline job closes RFP. Evaluation: Alpha EAR 2122 bps ranks first on cost; operator awards Alpha 3 000 000; Alpha accepts.
8. Contract pack generated and signed (OTP for org parties, in-person for farmers). Facility active; escrow account set; disbursement to supplier approved by one Alpha user, executed and confirmed by another.
9. Service deliveries and 2 visits per plot recorded; season started.
10. Harvest: 12 000 / 8 000 / 3 000 kg; dispatch accepted fully by buyer; invoice 5 750 000; buyer records receipt; Alpha confirms.
11. Settlement computed = WF-1 figures; operator and Alpha approve; instructions exported (Wave CSV); confirmations imported; run reconciled; facility repaid 3 148 000 with F3 arrears 122 000 → facility `in_arrears` until arrears settled (scenario asserts state).
12. Statements sent (SMS console log contains 3 messages); farmer F1 logs in at `/me` via OTP and downloads statement.
13. KPIs snapshot shows repayment rate at maturity = 3 148 000 / 3 270 000 = 96.27 %.
14. Platform invoices exist: per-ha fee (3 ha × 5 000) and structuring fee (1 % of 3 000 000 = 30 000).

---

## 18. Non-functional requirements

### 18.1 Security

- OWASP ASVS level 2 targets. Helmet headers, strict CORS (web origin only), CSRF protection for cookie-authenticated mutations (double-submit token), rate limits (auth 10/min/IP, OTP request 3/10 min/phone, global 300/min/token).
- Passwords: min 10 chars, breached-password check against a local top-100k list. Lockout after 10 failures (15 min).
- TOTP MFA mandatory for `credit_committee` and `platform_admin` (enforced at login after enrolment, enrolment forced on first login).
- Secrets only via env; `.env.example` complete.
- File uploads: MIME sniffing, size limits, antivirus hook interface (no-op in V1, documented).
- All PII access (national id, wallet number full value) logged in audit with reason; UI masks by default (`**** 4417`).

### 18.2 Privacy (Senegal law n° 2008-12 on personal data)

Explicit consents stored with timestamp and text version; farmer data export (`GET /farmers/{id}/export`) and erasure request workflow (erasure = pseudonymisation when financial records must be retained); data processing register page in admin; data hosted on the self-hosted stack (location documented by deployer).

### 18.3 Performance

API p95 < 300 ms for reads under 50 RPS on a 4 vCPU / 8 GB VM; model run < 2 s for 500 farmers / 500 plots; settlement < 3 s for 2 000 farmers; dossier PDF < 30 s. Indexes on all FKs, `(owner_org_id, status)`, GIST on geometries.

### 18.4 Operations

- Docker Compose prod: `caddy`, `web`, `api` (2 replicas OK), `worker`, `postgres` (volume, `shared_buffers` tuned), `minio` (volume).
- Backups: nightly `pg_dump -Fc` to MinIO bucket `backups` with 30-day retention + optional WAL archiving with `wal-g` documented; MinIO bucket replication documented; `infra/backup/restore.sh` tested in P11.
- Logs JSON to stdout; request id propagated; `/metrics`; health/readiness probes.
- Migrations run on API start (`migrate` command) with advisory lock.
- `RUNBOOK.md`: install, upgrade, backup/restore, rotate keys, add admin, incident checklist.

### 18.5 Regulatory guardrails (product behaviour)

- The platform never receives or holds funds; no field anywhere represents a platform-held balance.
- Lender success fees are disabled by default (`settings.lender_success_fee_enabled = false`) pending legal opinion on UMOA intermediary status; operator structuring fees are enabled.
- No public or retail investor access: lender org types require platform KYC verification before seeing any dossier.
- Terms of use state that Jappo provides technology and structuring services, credit decisions belong to lenders.

### 18.6 Quality gates

Coverage ≥ 90 % lines for `packages/domain`, ≥ 70 % for `apps/api`; zero TypeScript `any` in domain; ESLint + Prettier; OpenAPI lint (Spectral) with no errors; Playwright on Chromium.

---

## 19. Glossary

| Term | Meaning |
|---|---|
| Block | Contiguous land area run by an operator, divided into plots |
| Operator | Company, cooperative or GIE running the block |
| Plot | Parcel within a block allocated to one or more farmers |
| Season | One production campaign on a block |
| Tranche | Part of a financing request: `investment` (CAPEX) or `seasonal` (working capital) |
| Dossier | Frozen, versioned package of a block-season for lenders |
| Readiness Score / gates | 0–100 score and mandatory checks before a dossier can be frozen |
| RFP | Closed tender to matched lenders for a financing request |
| Bid | Lender's sealed term sheet for a tranche |
| EAR | Effective annual rate from the lender's net cash flows |
| HCR | Harvest Coverage Ratio = expected harvest value / seasonal debt due |
| Escrow account | Account held at the lender into which the buyer pays |
| Settlement waterfall | Order of allocation of receipts: seasonal debt → investment fee → operator fees → farmer net |
| Solidarity | Group mechanism covering members' seasonal shortfall from other members' payouts, capped |
| Statement | Per-farmer document showing deliveries, deductions and payout |
| Deliberation | Municipal decision allocating domaine national land (use right), valid once approved by the prefect/sub-prefect |
