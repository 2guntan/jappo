# AGENTS.md — Build protocol for the Jappo platform

You are an autonomous coding agent. Your job is to build the Jappo platform **end to end** from `SPEC.md`, in this repository, without stopping to ask questions. This file tells you how to work; `SPEC.md` tells you what to build.

## 1. Read order

1. This file, entirely.
2. `SPEC.md` §1–§4 (product, stack, architecture, conventions).
3. The section of `SPEC.md` for the phase you are working on (§17 lists phases).
4. `docs/DECISIONS.md` and `docs/PROGRESS.md` if they exist (they are your own memory across sessions).

## 2. Non-negotiable rules

1. **Never stop to ask.** When something is ambiguous, apply the decision rules in §4 below, record the decision in `docs/DECISIONS.md` (date, question, choice, reason), and continue.
2. **API first.** Every feature exists first as a documented, tested endpoint in `apps/api`. The web app only calls the public API through the generated SDK (`packages/sdk`). No direct DB access from `apps/web`.
3. **Domain logic is pure.** Financial model, readiness score, matching, bid evaluation, schedules and the settlement waterfall live in `packages/domain` as pure, deterministic TypeScript functions with no I/O. They must pass the golden tests in `SPEC.md` §9 exactly.
4. **Money is integer XOF.** Store money as `bigint` (XOF has no minor unit). Compute with `decimal.js`; round only at the output boundary, using the rounding rule stated for each engine. Never use JS floating point for money.
5. **Database changes only through migrations** (`apps/api/drizzle/`), never edited after commit. Seed data only through `pnpm seed`.
6. **No dead ends in V1.** No `TODO`, `NotImplemented`, placeholder pages or fake buttons in any V1 user path. External integrations that need credentials are implemented behind an adapter interface with a working `mock`/`manual` adapter selected by env var (see SPEC §13).
7. **Tests gate progress.** A phase is done only when its Definition of Done (SPEC §17) passes: unit + integration tests green, typecheck clean, lint clean, Playwright scenario for that phase green.
8. **Security by default.** Every endpoint declares its permission; every query is scoped by the actor's organisation through the authorisation layer (SPEC §6). Write a negative test (forbidden access) for every new resource.
9. **Commit per milestone** with a conventional commit message. Update `docs/PROGRESS.md` after each phase: what was built, tests status, known limitations.
10. **Do not invent real institutions** in seed or demo data. Use fictional names listed in SPEC §16.

## 3. Working loop (repeat until §17 is complete)

1. Pick the next unchecked phase in `docs/PROGRESS.md` (create it from SPEC §17 on first run).
2. Write or update migrations → domain functions + tests → API routes + schemas + tests → SDK regeneration → UI screens → Playwright test.
3. Run `pnpm verify` (typecheck, lint, unit, integration, e2e for touched phase).
4. Fix until green. If a test from an earlier phase breaks, fix the regression before continuing.
5. Update `docs/PROGRESS.md`, commit, continue.

## 4. Decision rules for ambiguity

Apply the first rule that resolves the question:

1. The SPEC says it explicitly → do that.
2. The SPEC implies it (pattern elsewhere in the SPEC) → follow the pattern.
3. Choose the option that is **safer for the lender's money and the farmer's data** (stricter validation, more audit, less exposure).
4. Choose the option that is **simpler to extend later** (configuration over hard-coding, a table over an enum when values belong to users).
5. Choose the option with **fewer new dependencies**.
6. Record the decision in `docs/DECISIONS.md` and move on.

## 5. Definition of finished V1

All of SPEC §17 phases checked, and `pnpm e2e:full` passes the full lifecycle scenario (SPEC §17, P11): an operator signs up, builds a block, submits a dossier, two lenders bid, the operator awards, contracts are signed, funds are disbursed, the season runs, the harvest is weighed, the buyer pays into escrow, the settlement is approved by both sides, farmers receive statements, and every figure matches the golden values.
