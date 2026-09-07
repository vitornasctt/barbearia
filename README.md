# Barbearia — Full-Stack Barbershop Booking System

A complete real-time barbershop booking platform with public online scheduling, live availability, admin panel, and WhatsApp integration. Built with Node.js (ESM), Express, Socket.io, EJS, Alpine.js, and PostgreSQL.

## Stack

- **Runtime:** Node ≥ 22 (repo fixa 24 no `.nvmrc`) (ESM); `engines.node` ≥ 22
- **Server:** Express 4 + Socket.io (same process, no clustering)
- **Frontend:** EJS (server-rendered) + Alpine.js (no build step), CSS with dark theme
- **Database:** PostgreSQL ≥ 15 (Supabase Session Pooler in dev)
- **Testing:** `node:test` (isolated schemas)
- **Cache:** in-memory; `node-cron` internal (1-min interval for lock cleanup + message queue)
- **No Redis, Docker, or external job queue**

## The 4 Phases

- **[P1 — Fundação + Motor de Agenda](docs/superpowers/specs/2026-09-05-barbearia-nucleo-design.md) ([Plan](docs/superpowers/plans/2026-09-05-p1-fundacao-motor-agenda.md))**  
  PostgreSQL schema, scheduling engine (slots, availability, temporary locks, race-condition-safe transactions), commission service.

- **[P2 — API + Tempo Real + Auth](docs/superpowers/specs/2026-09-06-p2-api-tempo-real-auth-design.md) ([Plan](docs/superpowers/plans/2026-09-06-p2-api-tempo-real-auth.md))**  
  REST API (`/api/*`), real-time Socket.io (rooms + 6 events), session in Postgres, rate limiting, message worker, WhatsApp webhook (stub without credentials).

- **[P3 — Frontend](docs/superpowers/specs/2026-09-07-p3-frontend-design.md) ([Plan](docs/superpowers/plans/2026-09-07-p3-frontend.md))**  
  Public pages (landing, 5-step booking flow, customer account), admin panel (10 live screens), Content Security Policy, dark CSS, Alpine islands.

- **[P4 — Deploy + Docs + CI](docs/superpowers/specs/2026-09-07-p4-deploy-docs-ci-design.md) ([Plan](docs/superpowers/plans/2026-09-07-p4-deploy-docs-ci.md))**  
  Auto-migrating boot (via `src/bootstrap.js`), migration 004 (`NULLS NOT DISTINCT`), admin "new appointment" screen, comprehensive docs (`DEPLOY.md`, `API.md`, `whatsapp-templates.md`), CI with isolated ephemeral Postgres.

## Prerequisites

- **Node** ≥ 22 (repo fixa 24 no `.nvmrc`)
- **PostgreSQL** ≥ 15
- **Supabase project** (or self-hosted Postgres ≥ 15 with SSL)

## Setup Local

```bash
# Copy and fill environment files
cp .env.example .env                # Fill DATABASE_URL (Supabase Session Pooler) and SESSION_SECRET
cp .env.test.example .env.test

# Install dependencies
npm ci

# Initialize database (migrates + truncates + seeds schema public)
npm run db:reset

# Start dev server
npm run dev                         # http://localhost:3000
```

**Admin login:** `/admin` uses `ADMIN_EMAIL` and `ADMIN_SENHA` from `.env`.

**Database URL:** If your Supabase password contains special characters (`&`, `+`, `$`, `?`, etc.), they must be **percent-encoded** in the `DATABASE_URL`.

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Full test suite (`node:test`), schema `test` |
| `npm run dev` | Dev server with `--watch` |
| `npm start` | Prod: **auto-migrates + seeds + starts** (via `src/bootstrap.js`) |
| `npm run db:migrate` | Apply pending migrations (schema `public`) |
| `npm run db:seed` | Run idempotent seed (schema `public`) |
| `npm run db:reset` | Migrate + truncate + seed (schema `public`) |

## Test Isolation

- **Dev:** schema `public`
- **Tests:** schema `test` (same remote Supabase database)

**Known limitation:** Dev test suite shares a single remote `test` schema — do **not** run `npm test` concurrently. CI (`.github/workflows/ci.yml`) uses an ephemeral `postgres:17` container per run and has no concurrency limit.

## Deployment & Documentation

- **[Deployment Guide](docs/DEPLOY.md):** Render + VPS, environment, migrations, hardening
- **[API Reference](docs/API.md):** REST endpoints, Socket.io events, authentication
- **[WhatsApp Templates](docs/whatsapp-templates.md):** Template catalog + webhook flow

## Architecture

Single-process Express server with:
- **Server-rendered EJS** templates + **Alpine.js islands** (no frontend build)
- **Socket.io** for real-time updates (appointment reserved/freed, dashboard tick)
- **In-memory cache** with automatic cleanup via `node-cron`
- **PostgreSQL sessions** (`connect-pg-simple`, schema-aware, `httpOnly` + `sameSite=lax` + `secure` in prod)
- **Rate limiting** on login (5/15min) and messages (30/5min)
- **WhatsApp integration:** stub (simulated) without credentials; Meta Cloud API with `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`
- No Redis, no Docker in core, no clustering
