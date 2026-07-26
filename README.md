# WhatsApp Group Assistant

A production-ready Node.js + TypeScript service that acts as a project coordinator inside your
WhatsApp groups: scheduled reminders, intelligent follow-ups, inactivity nudges, meeting alerts and a
configuration dashboard — all driven by configuration rather than hardcoded values.

> **Important:** this connects to your *personal* WhatsApp account through
> [`whatsapp-web.js`](https://wwebjs.dev), which automates WhatsApp Web via Chromium. It is not an
> official WhatsApp API. Use it in groups where members know a bot is present, keep the sending rate
> conservative (the defaults are deliberately gentle), and be aware that automation can put an account
> at risk of restriction. For business use, prefer the official WhatsApp Business Platform.

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Dashboard](#dashboard)
- [REST API](#rest-api)
- [Database](#database)
- [Docker](#docker)
- [PM2](#pm2)
- [Testing](#testing)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)

---

## Features

**Connection**
- QR-code login with the session persisted to disk (`LocalAuth`) — scan once
- Automatic reconnection with exponential backoff, live connection status, graceful recovery
- `WHATSAPP_DRY_RUN=true` queues and logs messages without delivering them

**Groups**
- Discovers every group you belong to and stores id, name, description and member count
- Reminders are **opt-in per group** — a newly discovered group is always disabled

**Scheduling**
- Any cron expression, evaluated in your timezone (`TIMEZONE`), validated before it is accepted
- Daily check-ins, Monday planning, Friday wrap-ups, one-shot meeting reminders, daily motivation
- Duplicate-proof: each occurrence claims a slot in `schedule_runs` *and* carries a dedupe key, so a
  restart, an overlapping tick or a double click can never post the same reminder twice
- Holiday calendar and weekday exclusions suppress reminders on non-working days

**AI follow-ups (optional)**
- Pluggable providers: **Gemini** (default), **OpenAI**, or `none`
- Deterministic intent detection (`blocked`, `waiting`, `help_request`, `update`, `question`) runs first,
  so the bot stays useful — and free — even with AI switched off
- Per-group hourly reply cap, minimum message length and a `SKIP` escape hatch keep it from chattering
- AI-generated weekly summaries (completed / in progress / blockers / risks)

**Reliability**
- Durable outbox queue in the database — nothing is lost on restart or crash
- Retries with exponential backoff + jitter, then a terminal `failed` state you can retry from the UI
- Token-bucket rate limiting with a minimum gap between sends
- Stale `sending` rows are automatically re-queued after an unclean shutdown

**Security**
- Session-based dashboard auth (bcrypt), plus `X-API-Key` for machine clients
- CSRF double-submit tokens on every form, Helmet headers, request rate limits
- Environment validation at boot: the process refuses to start on an unusable configuration

**Extras**
- Group activity analytics, CSV export, message templates, manual broadcast, JSON backup/restore
  (portable between SQLite and PostgreSQL)

---

## Architecture

```
src/
  app.ts                 Express application factory (no side effects)
  server.ts              Entry point: migrate → wire → listen → graceful shutdown
  container.ts           Composition root — all dependency wiring lives here
  config/                Env schema (zod), validation, typed AppConfig
  database/              knex bootstrap, migrations, seeds
  repositories/          Data access, one class per table
  services/              Business logic (groups, messages, schedules, follow-ups, analytics…)
  whatsapp/              Gateway interface, whatsapp-web.js client, outbox worker
  scheduler/             node-cron orchestration + system jobs
  ai/                    Provider interface, Gemini/OpenAI adapters, intent rules, prompts
  routes/                REST API, auth, dashboard
  middleware/            Auth, CSRF, validation, rate limits, error handling, session store
  models/                Shared domain types
  utils/                 Logger, cron, time, retry/backoff, rate limiter, templating, event bus
  views/ public/         EJS templates and static assets
tests/                   Jest unit + supertest integration suites
```

Design rules the code follows:

- **Dependency inversion.** Nothing outside `whatsapp/` imports `whatsapp-web.js`; everything talks to
  the `WhatsAppGateway` interface, which is why the whole system is testable without a browser.
- **Single responsibility.** Repositories touch SQL, services hold rules, routes only translate HTTP.
- **One way to send.** Every outgoing message — scheduled, manual, AI, broadcast — goes through
  `MessageService`, so rate limiting, dedupe, mentions, signatures and audit logging always apply.
- **Configuration over constants.** Every threshold, interval and cadence is an environment variable or
  a database setting.

---

## Quick start

Requirements: **Node.js 22 or 24** (`.nvmrc` pins 22, which is what Docker and CI use), and
Chromium/Chrome available locally (Puppeteer downloads one by default).

> Node 20 is no longer supported: `better-sqlite3` v12 dropped its prebuilt binaries for it, and
> building from source needs a full C++ toolchain.

> Recommended: use Node 20 via `nvm` to avoid native build issues with `better-sqlite3` on Windows.

```bash
git clone <your-repo> whatsapp-group-assistant
cd whatsapp-group-assistant

npm install
cp .env.example .env
#   Set SESSION_SECRET (openssl rand -hex 32).
#   Leave DASHBOARD_PASSWORD empty to get the guided setup wizard on first visit.

npm run migrate        # create the schema
npm run seed           # default settings, templates, sample holidays

npm run dev            # development, with reload
# or
npm run build && npm start
```

### First boot

If no `DASHBOARD_PASSWORD` is set, visiting the app opens a four-step wizard:

1. **Administrator** — creates your account (bcrypt-hashed into the `settings` table)
2. **Localization** — timezone, locale and an optional signature appended to every message
3. **Link WhatsApp** — shows the QR code and waits for the scan
4. **Groups** — pick the groups the assistant may post in, optionally with starter reminders
   (daily check-in, Monday planning, Friday wrap-up)

Setting `DASHBOARD_PASSWORD` in the environment skips the wizard — the environment always wins, so
declarative deployments stay declarative. You can re-run it later from **Settings → Re-run setup wizard**.

Then open <http://localhost:4000>. After the wizard (or after signing in, if you set a password in
`.env`), create your first reminder on **Schedules**, e.g. `30 9 * * *`:

```
Good morning everyone 👋

Quick check-in:
• What are you working on today?
• Any blockers?
• Does anyone need help?

Reply here so everyone stays aligned.
```

Press **Run now** to verify delivery before trusting the schedule. Set `WHATSAPP_DRY_RUN=true` while
you're experimenting: messages are queued and logged, but never delivered.

---

## Configuration

Every option lives in `.env` (see `.env.example` for the annotated full list). Highlights:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | HTTP listener |
| `TIMEZONE` | `Asia/Kolkata` | Timezone for **all** cron evaluation and display |
| `DB_CLIENT` | `sqlite` | `sqlite` or `postgres` |
| `DATABASE_URL` | `./data/app.sqlite` | File path (SQLite) or connection string (Postgres) |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | `admin` / — | Dashboard credentials (`DASHBOARD_PASSWORD_HASH` wins if set) |
| `SESSION_SECRET` | — | ≥32 random chars; **required** in production |
| `API_KEY` | — | Enables `X-API-Key` access to `/api`; empty disables it |
| `WHATSAPP_DRY_RUN` | `false` | Queue and log messages without delivering them |
| `RATE_LIMIT_MESSAGES` / `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MIN_GAP_MS` | `20` / `60000` / `1500` | Outgoing throttle |
| `QUEUE_MAX_ATTEMPTS` / `QUEUE_BASE_BACKOFF_MS` | `5` / `5000` | Retry policy |
| `INACTIVITY_HOURS` | `6` | Silence before a nudge |
| `INACTIVITY_QUIET_START` / `_END` | `22` / `8` | Never nudge inside this window |
| `AI_PROVIDER` / `AI_ENABLED` | `gemini` / `false` | AI provider and master switch |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | — | Credentials for the chosen provider |
| `AI_MAX_REPLIES_PER_HOUR` | `6` | Per-group anti-spam cap |
| `HOLIDAY_AWARENESS_ENABLED` | `true` | Suppress reminders on calendar holidays |
| `SKIP_WEEKDAYS` | — | e.g. `0,6` to skip weekends |

Runtime behaviour that you'll want to change without a redeploy (AI persona, inactivity text, feature
toggles) lives in the `settings` table and is editable on the **Settings** page.

**Switching to PostgreSQL:**

```env
DB_CLIENT=postgres
DATABASE_URL=postgres://user:pass@localhost:5432/whatsapp_assistant
```

then `npm run migrate && npm run seed`. Migrations are dialect-portable; a JSON backup taken on SQLite
restores into PostgreSQL unchanged.

---

## Dashboard

| Page | What it does |
| --- | --- |
| **Overview** | Connection status, QR code, queue/group counters, recent activity, restart & logout |
| **Groups** | Sync from WhatsApp, enable/disable reminders per group |
| **Schedules** | Create/edit/delete schedules, live cron description, run-now, one-shot toggle |
| **Send** | Manual send to one group or broadcast to all enabled groups; queue with retry |
| **Templates** | Reusable message bodies by category (reminder, meeting, inactivity, motivation) |
| **Analytics** | Per-group message volume, contributors, daily sparkline, CSV export |
| **Logs** | Filterable audit trail (login, sends, failures, reconnects, AI responses, errors) |
| **Settings** | AI provider & persona, inactivity, motivation, signature, holidays, backup/restore, re-run setup |

Dark mode follows your system preference and can be toggled; the layout is mobile-responsive.

Message bodies support `{{group}}`, `{{date}}`, `{{time}}` and `{{schedule}}` placeholders.

---

## REST API

Full reference: **[API.md](./API.md)**.

Authenticate with a dashboard session cookie or `X-API-Key: <API_KEY>`.

```bash
curl -H "X-API-Key: $API_KEY" http://localhost:4000/api/status
curl -H "X-API-Key: $API_KEY" http://localhost:4000/api/groups

curl -X POST http://localhost:4000/api/message \
  -H "X-API-Key: $API_KEY" -H 'Content-Type: application/json' \
  -d '{"groupId":1,"message":"Deploy starts in 10 minutes."}'

curl -X POST http://localhost:4000/api/schedule \
  -H "X-API-Key: $API_KEY" -H 'Content-Type: application/json' \
  -d '{"groupId":1,"name":"Friday wrap-up","cron":"0 17 * * 5","message":"Weekly Check-in 📅"}'

curl -X DELETE -H "X-API-Key: $API_KEY" http://localhost:4000/api/schedule/3
curl -H "X-API-Key: $API_KEY" 'http://localhost:4000/api/logs?limit=50&level=error'
```

---

## Database

| Table | Purpose |
| --- | --- |
| `groups` | `whatsappId`, `name`, `enabled`, member count, last message/reminder timestamps |
| `schedules` | `groupId`, `cron`, `message`, `enabled`, mention/holiday/run-once flags |
| `logs` | `timestamp`, `level`, `event`, `details`, `groupId` |
| `settings` | Key/value runtime configuration |
| `outbox` | Durable outgoing queue: status, attempts, backoff, dedupe key |
| `schedule_runs` | One row per fired slot — the duplicate-prevention ledger |
| `templates` | Reusable message bodies |
| `group_activity` | Per-message record powering inactivity detection and analytics |
| `holidays` | Dates on which reminders are suppressed |
| `sessions` | Dashboard sessions (survive restarts) |

```bash
npm run migrate            # apply pending migrations
npm run migrate:rollback   # roll back the last batch
npm run seed               # idempotent seed data
npm run db:reset           # rollback all → migrate → seed
```

Backups are JSON snapshots written to `BACKUP_DIR` (dashboard → Settings, or `POST /api/backups`).

---

## Deploying to Railway

Railway runs the Dockerfile as a long-lived container, which is what this app needs (a persistent
process, a real Chromium, and a disk that survives restarts). Serverless platforms such as Vercel
cannot host it — see [the note below](#why-not-serverless).

1. **Create the project** — *New Project → Deploy from GitHub repo*. Railway reads `railway.json` and
   builds the Dockerfile; no build configuration needed.
2. **Attach a volume** — *Service → Settings → Volumes → Add volume*, mount path **`/app/data`**.
   This holds the WhatsApp session (`wwebjs_auth`) and, on SQLite, the database file. Without it every
   redeploy forces a new QR scan.
3. **Set variables** — *Service → Variables*:

   | Variable | Value |
   | --- | --- |
   | `SESSION_SECRET` | `openssl rand -hex 32` |
   | `TIMEZONE` | e.g. `Asia/Kolkata` (or set it in the wizard) |
   | `DATABASE_URL` | `/app/data/app.sqlite` |
   | `WHATSAPP_SESSION_PATH` | `/app/data/wwebjs_auth` |
   | `WHATSAPP_EXECUTABLE_PATH` | `/usr/bin/chromium` |
   | `SESSION_SECURE_COOKIE` | `true` (Railway terminates TLS) |
   | `GEMINI_API_KEY` | optional, only if you enable AI |

   Leave `DASHBOARD_PASSWORD` unset to create your account through the setup wizard.
4. **Generate a domain** — *Settings → Networking → Generate Domain*. Railway injects `PORT`, which the
   app already respects.
5. **Open the URL**, walk the wizard, scan the QR code, and enable your groups.

Notes:

- Keep **one replica**. The client owns a single Chromium instance and an exclusive auth folder;
  a second replica would fight over the session.
- The healthcheck hits `/healthz`, which reports database connectivity and WhatsApp state.
- For PostgreSQL, add a Railway Postgres plugin and set `DB_CLIENT=postgres` plus the provided
  `DATABASE_URL`. You still want the volume for the WhatsApp session folder.
- Watch *Deploy Logs* on the first boot — the QR code is also printed there.

### Why not serverless

Vercel, Netlify Functions and Lambda can't run this: `whatsapp-web.js` needs a Chromium instance it can
keep alive, the client must stay connected to receive messages, `node-cron` lives in the process, and the
session folder and SQLite file need a real disk. Any container host works — Railway, Render, Fly.io, or a
plain VPS.

## Docker

```bash
cp .env.example .env        # edit secrets first
docker compose up -d --build
docker compose logs -f app  # the QR code also appears on the dashboard
```

The image installs system Chromium and runs as a non-root user; `data/`, `logs/` and `backups/` are
named volumes, so the WhatsApp session survives rebuilds. To run PostgreSQL alongside:

```bash
docker compose --profile postgres up -d
# and set in .env:
#   DB_CLIENT=postgres
#   DATABASE_URL=postgres://wga:wga@db:5432/wga
```

---

## PM2

```bash
npm run build
pm2 start ecosystem.config.js --env production
pm2 logs whatsapp-group-assistant
pm2 save && pm2 startup
```

Run a **single instance** (the ecosystem file enforces `fork` mode): the client owns one Chromium
process and an exclusive auth folder, so cluster mode would corrupt the session.

---

## Testing

```bash
npm test              # unit + integration
npm run test:coverage
npm run lint
npm run typecheck
```

`.github/workflows/ci.yml` runs format check, lint, typecheck and the full suite on every push and pull
request, then compiles the app, builds the Docker image and smoke-tests migrations inside it.

Integration tests run against an in-memory SQLite database with the real migrations applied, and use a
`FakeGateway` in place of WhatsApp — no browser, no network, no credentials. Coverage includes cron
validation, backoff/retry, rate limiting, intent detection, repository behaviour, queue delivery and
failure paths, duplicate-fire prevention, holiday/quiet-hour suppression, the REST API (auth, validation,
CRUD) and the dashboard (login, CSRF, page rendering).

---

## Operations

- **Health:** `GET /healthz` returns database status, WhatsApp state and uptime (no auth) — wire it to
  your orchestrator's liveness probe.
- **Logs:** structured JSON in `LOG_DIR` (daily rotation, gzipped) plus a queryable audit trail in the
  `logs` table, pruned to `LOG_DB_RETENTION` rows nightly.
- **Housekeeping:** a 03:15 job prunes logs, run history, delivered outbox rows (14 days) and activity
  (90 days).
- **Shutdown:** `SIGTERM`/`SIGINT` stop the queue and scheduler, close Chromium and the database, with a
  20-second force-exit guard.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Chromium fails to start in Docker/CI | Add `--no-sandbox,--disable-dev-shm-usage` to `WHATSAPP_PUPPETEER_ARGS` and set `WHATSAPP_EXECUTABLE_PATH=/usr/bin/chromium` |
| QR code never appears | Check logs for a Puppeteer launch failure; delete `data/wwebjs_auth` and restart to force a fresh pairing |
| Repeated disconnects | Keep the phone online occasionally; check `WHATSAPP_MAX_RECONNECT_ATTEMPTS` and the `reconnect` events in Logs |
| Messages stuck `pending` | The client is not `ready`, or the rate limit is throttling. Check `/api/status` |
| Messages `failed` | Open the details in Logs; retry from **Send → queue**, or `POST /api/queue/:id/retry` |
| Schedule never fires | The group must be enabled *and* the schedule enabled; check for holiday/weekday suppression in Logs |
| `Invalid environment configuration` on boot | The message lists each offending variable — the process exits with code 78 |
| `better-sqlite3` fails to build (`gyp ERR! find VS`) | You're on an unsupported Node version, so npm tried to compile from source. Use Node 22 or 24 (`nvm use 22`), delete `node_modules` and `package-lock.json`, reinstall |
| `EPERM: operation not permitted, rmdir` during install | Windows file lock — close your editor/terminal (and pause antivirus scanning of the folder), then delete `node_modules` and reinstall |
| AI replies never appear | `AI_ENABLED=true`, a valid API key, and Settings → "Follow up on member replies" must all be on |

## License

MIT
#   w h a t s a p p - a u t o m a t i o n  
 