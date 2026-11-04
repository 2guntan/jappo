# Jappo — operations runbook

Self-hosted stack (SPEC §18.4): Caddy → web (Next.js) and api (Fastify, 2 replicas OK) → PostgreSQL 16 + PostGIS 3.4, MinIO (files, backups), worker (pg-boss jobs, outbox, notifications, webhooks). No managed services.

## 1. Install

1. A VM with 4 vCPU / 8 GB RAM, Docker 24+, ports 80/443 open, DNS `JAPPO_DOMAIN` pointing to it.
2. `cp .env.example .env.prod` and set **every** secret (`openssl rand -base64 32`): `JWT_SECRET`, `PII_ENCRYPTION_KEY` (32 bytes base64), `PII_HMAC_KEY`, `FILE_URL_SIGNING_KEY`, `WEBHOOK_SECRET_KEY`, `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_TOTP_SECRET`, SMTP and SMS gateway settings, `JAPPO_DOMAIN`, `ACME_EMAIL`.
3. `docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d --build`.
4. Migrations run automatically on API start (advisory lock, safe with 2 replicas). Seed reference data and the platform admin once:
   `docker compose -f infra/docker-compose.prod.yml --env-file .env.prod exec api node dist/cli.js seed`
5. Log in as `admin@jappo.local` with `SEED_ADMIN_PASSWORD` and the TOTP secret; change the password; review `/app/admin/console` (VAT, legal texts, RFP defaults, holidays — enter movable religious holidays every year).
6. Contract templates are structured drafts: **have them reviewed by counsel** before production use (`/app/admin/console` → templates; each save creates a new version).

## 2. Upgrade

1. `git pull` the release tag; read `docs/PROGRESS.md` and the migration list in `apps/api/drizzle/`.
2. Take a backup (§3).
3. `docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d --build api worker web` — the first API container applies new migrations; migrations are append-only and never edited.
4. Check `GET /health`, the admin console webhook monitor and the worker logs.
5. Rollback = restore the pre-upgrade backup and redeploy the previous tag (migrations are not reversible).

## 3. Backup and restore

- The `backup` service runs `infra/backup/backup.sh` every 24 h: `pg_dump -Fc`, archive check (`pg_restore --list`), upload to the MinIO bucket `backups`, 30-day retention (`RETENTION_DAYS`).
- Files live in the MinIO bucket `jappo`; replicate it with `mc mirror --watch` or MinIO site replication to a second host (documented choice of the deployer). Optional continuous WAL archiving: `wal-g` with `archive_command` to the same MinIO (not enabled by default).
- Restore (DESTRUCTIVE for the target database):
  ```
  mc cp jappo/backups/jappo-<stamp>.dump /tmp/
  PGHOST=… PGUSER=jappo PGPASSWORD=… infra/backup/restore.sh /tmp/jappo-<stamp>.dump jappo --yes
  ```
  Restore into a scratch database first (e.g. `jappo_restore_test`) and compare row counts; then run `POST /v1/admin/audit/actions/verify` to check the audit hash chain.
- Tested in P11 against the e2e database (see `docs/PROGRESS.md`).

## 4. Rotate keys

| Key | Impact | Procedure |
|---|---|---|
| `JWT_SECRET` | All sessions end | Change, restart api; users log in again. |
| `FILE_URL_SIGNING_KEY` | Signed file links (5 min) expire | Change, restart api. |
| `PII_HMAC_KEY` | Duplicate detection hashes | Not rotatable without re-hashing; keep stable. |
| `PII_ENCRYPTION_KEY` | Encrypted national ids, wallets, IBANs, webhook secrets | Not rotatable in place in V1: export → re-encrypt script required. Keep it in a vault, never in git. |
| Webhook secrets | Per endpoint | Delete and re-create the endpoint; the new secret is shown once. |
| SMTP / SMS credentials | Notifications | Update env, restart api and worker. |

## 5. Add a platform admin

1. Invite the person from the platform organisation (`/app/settings/members`) with role `platform_admin`.
2. They accept, then enrol TOTP on first login (mandatory).
3. Remove leavers immediately (`/app/settings/members` → disable).

## 6. Incident checklist

1. **Triage**: what is broken (API 5xx, worker backlog, PDFs, SMS, payouts)? `docker compose logs --since 30m api worker` (JSON logs with `requestId`).
2. **Money first**: never edit settlement, payout or ledger rows by hand. Payout problems → mark instructions failed with a reason and re-confirm after correction; the reconciliation invariant (Σ confirmed = receipts) must hold.
3. **Outbox / jobs**: `select type, count(*) from events_outbox where dispatched_at is null group by 1;` — rows with `attempts >= 10` need a fix then `update events_outbox set attempts = 0 where …`.
4. **Webhooks**: admin console → deliveries (failed first); customers can re-test from their settings.
5. **Billing lock-out**: an org in read-only mode keeps settlement and statements; mark invoices paid in `/app/admin/billing` to lift it at once.
6. **Security event**: rotate `JWT_SECRET` (ends sessions), review `/app/admin/audit` (hash chain verify), disable affected users, export the audit log.
7. **Post-mortem**: timeline, impact (orgs, farmers, amounts), root cause, follow-ups.
