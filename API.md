# REST API reference

Base URL: `http://<host>:<PORT>/api` (default port `4000`).

## Authentication

Either mechanism works on every `/api` route:

| Method | How |
| --- | --- |
| Session | Sign in to the dashboard; the `wga.sid` cookie is accepted automatically |
| API key | Send `X-API-Key: <API_KEY>` (set `API_KEY` in `.env`; empty disables this path) |

CSRF protection applies to cookie-authenticated **dashboard forms** only. API-key clients are exempt.
Session-authenticated clients calling `/api` with unsafe methods should send `X-CSRF-Token`.

## Response envelope

```jsonc
// success
{ "success": true, "data": { /* ... */ } }

// failure
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [ … ] } }
```

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body/query/params failed schema validation (`details` lists fields) |
| 401 | `UNAUTHORIZED` | No session and no valid API key |
| 403 | `FORBIDDEN` | Missing or invalid CSRF token |
| 404 | `NOT_FOUND` | Unknown resource or route |
| 429 | `RATE_LIMITED` | HTTP rate limit exceeded (120 req/min; 30/min on sends) |
| 500 | `INTERNAL_ERROR` | Unexpected server error (details are never leaked) |
| 503 | `SERVICE_UNAVAILABLE` | WhatsApp client not ready |

---

## Status

### `GET /api/status`

```json
{
  "success": true,
  "data": {
    "status": "ready",
    "connected": true,
    "pushname": "Shubham",
    "wid": "919999999999@c.us",
    "qrAvailable": false,
    "connectedSince": "2026-07-26T04:10:22.114Z",
    "reconnectAttempts": 0,
    "dryRun": false,
    "uptimeSeconds": 8123,
    "queue": { "pending": 0, "failed": 0, "sentLastHour": 3 },
    "scheduler": { "enabled": true, "activeJobs": 6 },
    "ai": { "enabled": true, "provider": "gemini", "ready": true },
    "version": "1.0.0"
  }
}
```

`status` is one of `initializing`, `qr`, `authenticated`, `ready`, `disconnected`, `auth_failure`,
`reconnecting`, `stopped`.

### `GET /api/status/qr`

Returns `{ "dataUrl": "data:image/png;base64,…", "generatedAt": "…" }`, or `404` when no QR is pending.

### `POST /api/status/restart` · `POST /api/status/logout`

Restart the client, or unlink the device (a new QR scan will be required).

---

## Groups

### `GET /api/groups?enabled=true`

```json
{ "success": true, "data": [
  { "id": 1, "whatsappId": "120363000000000000@g.us", "name": "Project Falcon",
    "enabled": true, "participantCount": 12,
    "lastMessageAt": "2026-07-26T05:40:00.000Z", "lastReminderAt": "2026-07-26T04:00:00.000Z" }
] }
```

### `POST /api/groups/sync`

Pulls the group list from WhatsApp. New groups are stored **disabled**. Returns `{ discovered, groups }`.

### `GET /api/groups/:id` · `GET /api/groups/:id/stats?days=7`

Single group, or its analytics (totals, contributors, daily buckets, idle hours).

### `PATCH /api/groups/:id`

```json
{ "enabled": true }
```

---

## Messages

### `POST /api/message`

| Field | Type | Notes |
| --- | --- | --- |
| `groupId` | number | Required unless `whatsappId` is given |
| `whatsappId` | string | Chat id ending in `@g.us` / `@c.us` |
| `message` | string | 1–4096 chars; supports `{{group}}`, `{{date}}`, `{{time}}` |
| `mentionAll` | boolean | @-mention every stored participant |
| `mentions` | string[] | Explicit participant ids |
| `vars` | object | Extra template variables |
| `force` | boolean | Send even if the group is disabled |
| `dedupeKey` | string | Idempotency key — a repeat is silently ignored |

`201` → `{ "queued": true, "outboxId": 42, "status": "pending" }`
`202` → `{ "queued": false, "reason": "suppressed (group disabled or duplicate)" }`

Delivery is asynchronous: the message enters the durable outbox and is sent by the worker under the
configured rate limit.

### `POST /api/message/broadcast`

`{ "message": "…", "mentionAll": false }` → queues to every **enabled** group; returns per-group results.

### `GET /api/queue?status=failed` · `POST /api/queue/:id/retry` · `DELETE /api/queue/:id`

Inspect the outbox, retry a failed message, or cancel a pending one.

---

## Schedules

### `GET /api/schedule?groupId=1`

Each item includes a human-readable `description` (e.g. `"Every day at 09:30"`).

### `POST /api/schedule`

```json
{
  "groupId": 1,
  "name": "Daily check-in",
  "cron": "30 9 * * *",
  "message": "Good morning everyone 👋\n\nQuick check-in:\n• What are you working on today?\n• Any blockers?",
  "kind": "reminder",
  "enabled": true,
  "mentionAll": false,
  "skipHolidays": true,
  "runOnce": false
}
```

`cron` accepts 5-field (or 6-field with seconds) expressions and is evaluated in `TIMEZONE`. Invalid
expressions are rejected with `400` before anything is stored.

### `GET|PATCH|DELETE /api/schedule/:id`

`PATCH` accepts any subset of the create fields.

### `POST /api/schedule/:id/run`

Fires immediately, bypassing holiday/weekday/disabled-scheduler suppression. Returns
`{ "result": "queued" | "skipped" | "duplicate" }`.

### `POST /api/schedule/meeting`

Convenience helper for a one-shot reminder before a meeting.

```json
{ "groupId": 1, "title": "Sprint planning", "startsAt": "2026-07-28T10:00:00.000Z", "minutesBefore": 30 }
```

Creates a `runOnce` schedule that fires 30 minutes before the meeting with:

```
Reminder ⏰

Sprint planning starts in 30 minutes.
Please join on time.
```

### `POST /api/schedule/validate-cron`

`{ "cron": "0 17 * * 5" }` → `{ "valid": true, "normalized": "0 17 * * 5", "description": "Every Friday at 17:00" }`

---

## Logs

### `GET /api/logs`

Query: `limit` (1–1000, default 100), `offset`, `level` (`debug|info|warn|error`), `event`, `groupId`,
`since` (ISO-8601), `search`.

```json
{ "success": true, "data": { "items": [
  { "id": 918, "timestamp": "2026-07-26T04:00:01.220Z", "level": "info",
    "event": "message_sent", "details": "{\"outboxId\":42,\"group\":\"Project Falcon\"}", "groupId": 1 }
], "total": 918 } }
```

Logged events include `dashboard_login`, `qr_generated`, `authenticated`, `ready`, `disconnected`,
`reconnect`, `message_queued`, `message_sent`, `message_failed`, `message_received`, `schedule_fired`,
`schedule_skipped`, `inactivity_nudge`, `motivation_sent`, `ai_response`, `ai_summary`, `ai_error`,
`settings_updated`, `backup_created`, `backup_restored`, `error`.

### `GET /api/logs/events` · `DELETE /api/logs`

List distinct event names, or clear the audit table.

---

## Templates

`GET /api/templates?category=motivation` · `POST /api/templates` · `PATCH /api/templates/:id` ·
`DELETE /api/templates/:id`

```json
{ "name": "Friday wrap-up", "category": "reminder", "body": "Weekly Check-in 📅\n\n• What was completed?", "enabled": true }
```

Categories drive behaviour: `motivation` templates feed the daily random message, `inactivity` is the
nudge pool, `meeting` and `reminder` are offered in the dashboard composer.

---

## Settings

### `GET /api/settings`

```json
{ "aiEnabled": true, "aiProvider": "gemini", "aiPersona": "…", "aiAutoReply": true,
  "aiWeeklySummary": false, "inactivityEnabled": true, "inactivityHours": 6,
  "inactivityMessage": "Hey everyone 👋…", "motivationEnabled": false,
  "schedulerEnabled": true, "signature": "" }
```

### `PUT /api/settings`

Raw key/value patch; changing `ai.provider` swaps the provider immediately.

```json
{ "ai.enabled": "true", "ai.provider": "openai", "inactivity.hours": "12" }
```

---

## Analytics

`GET /api/analytics?days=7` — per-group totals, contributors and daily buckets.
`GET /api/analytics/export?days=30` — CSV download of chat statistics.

## Holidays

`GET /api/holidays` · `POST /api/holidays` (`{ "date": "2026-08-15", "name": "Independence Day" }`) ·
`DELETE /api/holidays/:id`

## Backups

`GET /api/backups` · `POST /api/backups` · `POST /api/backups/restore` (`{ "file": "backup-….json" }`)

Backups are dialect-independent JSON snapshots; restoring **replaces** current data.

---

## Setup

`GET /setup/status` (no authentication, **only while first-boot setup is incomplete**)

```json
{ "status": "qr", "connected": false, "qrAvailable": true }
```

Used by the setup wizard to poll for the QR code. Once setup is complete this route requires a session,
so it cannot be used to probe a configured instance.

## Health

`GET /healthz` (no authentication)

```json
{ "status": "ok", "whatsapp": "ready", "uptimeSeconds": 8123, "timestamp": "2026-07-26T06:15:00.000Z" }
```

Returns `503` when the database is unreachable.
