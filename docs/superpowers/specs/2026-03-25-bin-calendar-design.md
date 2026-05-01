# bin-calendar Design Spec

**Date:** 2026-03-25
**Status:** Approved

## Overview

bin-calendar is a Synology NAS-hosted Docker application that fetches bin collection schedules from East Ayrshire Council (via ReCollect) and syncs them to personal Google or iCloud calendars. It supports multiple properties, each with its own ICS calendar URL mapped to a target calendar, and runs automatically on the 1st of each month.

---

## Problem Statement

East Ayrshire Council publishes bin collection schedules as downloadable ICS files. Manually checking collection dates is error-prone and time-consuming. bin-calendar automates fetching and syncing these schedules to personal calendars, supporting multiple properties (e.g. home, family members).

---

## Scope

- Single council: East Ayrshire Council (schedules served via ReCollect)
- Two calendar targets: Google Calendar (OAuth2) and iCloud (CalDAV)
- Multiple property/calendar mappings, each syncing independently via a user-supplied ICS URL
- Hosted as a Docker container on a Synology NAS
- Web UI for configuration and monitoring

Out of scope (for now):
- Support for other councils
- Mobile app or push notifications
- Email notifications on sync failure
- Updating events that already exist but have changed (existing events are skipped by UID, not updated)
- Selecting a non-primary Google Calendar

---

## Architecture

Single Docker container running a Node.js + Express application. It serves the web UI, manages the SQLite database, handles scheduling via node-cron, and performs calendar syncs.

```
bin-calendar/
├── src/
│   ├── server.js              # Express app and routes
│   ├── scheduler.js           # node-cron: monthly sync + weekly credential check
│   ├── sync.js                # Orchestrates per-property sync run
│   ├── credential-check.js    # Weekly credential validity check for all properties
│   ├── ics.js                 # Fetches and parses ICS URL (webcal:// normalised to https://)
│   ├── google.js              # Google Calendar API integration (googleapis)
│   ├── icloud.js              # iCloud CalDAV integration (tsdav)
│   └── db.js                  # SQLite via better-sqlite3, applies migrations at startup
├── src/migrations/            # Sequential SQL migration files (001.sql, 002.sql, ...)
├── public/                    # Web UI (plain HTML/CSS/JS, no framework)
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## Data Model

### `properties`
One row per property/calendar mapping.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| label | TEXT | Friendly name (e.g. "Home", "Mum") |
| uprn | TEXT | Legacy field — always `''` for new properties; retained for schema compatibility |
| ics_url | TEXT | ICS calendar URL from the EAC/ReCollect bin collection page (`https://` or `webcal://`). Properties without an ICS URL are skipped during sync. |
| calendar_type | TEXT | `google` or `icloud` |
| calendar_id | TEXT | Google: `'primary'`. iCloud: the CalDAV calendar URL. Null until setup completes. |
| credentials | TEXT | AES-256-GCM encrypted JSON (see Credentials JSON below); null for incomplete setup |
| credential_status | TEXT | `ok`, `invalid`, or `unknown` (default). Set to `ok` when credentials are saved; set to `invalid` when an auth error is detected during sync or the weekly credential check. |
| credential_checked_at | DATETIME | Timestamp of the last explicit credential verification (weekly check or manual check via API). Null if never checked. |
| created_at | DATETIME | |
| updated_at | DATETIME | Maintained via a SQLite `AFTER UPDATE` trigger defined in `001.sql` |

**Credentials JSON structure by calendar type:**

- **Google:** `{ "access_token": "...", "refresh_token": "...", "expiry_date": 1234567890 }`
- **iCloud:** `{ "apple_id": "user@example.com", "app_specific_password": "xxxx-xxxx-xxxx-xxxx" }`

`calendar_id` is the single source of truth for the target calendar — it is not duplicated in `credentials`.

### `sync_runs`
One row per sync execution (scheduled or manual).

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| started_at | DATETIME | |
| completed_at | DATETIME | |
| status | TEXT | `running`, `success`, `partial`, `failed`, `skipped` |
| error | TEXT | Null on success; used for run-level messages (e.g. "Interrupted by restart") |

A partial unique index on `(status) WHERE status = 'running'` ensures at most one `running` row exists at the DB level.

### `sync_results`
One row per property per sync run.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| run_id | INTEGER FK | References sync_runs (ON DELETE CASCADE) |
| property_id | INTEGER FK | References properties (ON DELETE SET NULL) |
| events_added | INTEGER | |
| events_skipped | INTEGER | |
| error | TEXT | Null on success |
| started_at | DATETIME | |
| completed_at | DATETIME | |

`ON DELETE CASCADE` on `run_id` means results are deleted with their parent run. `ON DELETE SET NULL` on `property_id` means log rows are retained when a property is deleted, with `property_id` set to null — the Logs UI displays these as "(deleted property)".

Records older than 90 days are automatically purged on each sync run.

### `oauth_state`
Short-lived store for OAuth2 CSRF nonces.

| Column | Type | Notes |
|---|---|---|
| nonce | TEXT PK | Cryptographically random value (32 bytes, hex-encoded) |
| property_id | INTEGER | The property being connected |
| expires_at | DATETIME | 10 minutes from creation; expired rows purged on next OAuth initiation |

### `schema_version`
Tracks applied migrations.

| Column | Type | Notes |
|---|---|---|
| version | INTEGER PK | Migration number |
| applied_at | DATETIME | |

### Database file

The SQLite database is stored at `/app/data/bin-calendar.db` inside the container, which maps to `/volume1/docker/bin-calendar/data/bin-calendar.db` on the NAS via the volume mount.

### Database migrations

`db.js` applies migrations at startup by comparing the current `schema_version` against sequential SQL files in `src/migrations/`. Migrations run in order and are never re-applied. If `ENCRYPTION_KEY` changes between deployments, all stored credentials become unreadable — the UI surfaces a credential error on next sync and the user must re-enter credentials.

Current migrations:
- `001.sql` — creates all initial tables, indexes, and the `updated_at` trigger
- `002.sql` — adds `credential_status` and `credential_checked_at` columns to `properties`
- `003.sql` — adds `bin_types` table and `events` cache table
- `004.sql` — adds `settings` table (for user-configurable sync schedule)
- `005.sql` — adds `ics_url TEXT` column to `properties`

---

---

## Startup

On startup, before accepting requests, the app:

1. **Validates environment:** Asserts `ENCRYPTION_KEY` is present and exactly 64 hex characters (32 bytes). If missing or malformed, the process exits with a clear error message — the container will not start.
2. **Google credentials:** If `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is absent, the app starts but the Google OAuth flow is unavailable. The Add Property form disables the Google calendar type and shows a configuration warning.
3. **Applies DB migrations:** Runs any unapplied migration files.
5. **Recovers interrupted syncs:** Any `sync_runs` row with `status = 'running'` is updated to `status = 'failed'` with `error = 'Interrupted by restart'`. This releases the concurrency lock if the previous process crashed mid-sync.
6. **Starts the scheduler** and begins accepting requests.

---

## ICS Fetch

East Ayrshire Council now serves bin collection schedules via **ReCollect**. Each property has a unique ICS subscription URL obtained from the EAC bin collection page. The URL is stored in the `ics_url` column of the `properties` table and entered by the user.

```
GET <ics_url>
```

`webcal://` URLs are automatically normalised to `https://` at fetch time by `normaliseIcsUrl()` — the original URL is preserved in the database. No authentication, session, or cookies required. The response is a valid ICS file with VEVENT blocks used for deduplication.

**How to find your ICS URL:** Visit the [EAC bin collection page](https://www.east-ayrshire.gov.uk/Housing/RubbishAndRecycling/Collection-days/bin-collection-days.aspx), search for your address, and copy the calendar subscription link. Paste it into the property's ICS Calendar URL field in the app.

**Error handling:** The fetch uses a 10-second timeout and up to 3 retry attempts with exponential backoff (1s, 2s, 4s). A non-200 response, network timeout, or unparseable ICS body is treated as a fetch failure — the `sync_results` row records the error and the property is marked failed. The run continues for other properties.

**Missing ICS URL:** Properties without an `ics_url` are skipped during sync with a descriptive message recorded in `sync_results`. They appear in the Properties table with a warning badge prompting the user to add the URL.

**Empty ICS:** If the ICS parses successfully but contains zero VEVENT blocks, the sync for that property is treated as success with `events_added = 0` and `events_skipped = 0`.

**Missing or unexpected UIDs:** If a VEVENT has no UID, skip it and log a warning in the `sync_results` error field (without failing the property). If the UID does not match the expected format, treat it as a unique event and attempt to insert it (the format check is advisory, not enforced).

---

## Sync Flow

1. Within a SQLite `BEGIN EXCLUSIVE` transaction, check for any `sync_runs` row with `status = 'running'`. If one exists, abort and return HTTP 429 to the caller. Otherwise, insert a new `sync_runs` row with `status = 'running'` and commit.
2. Collect all properties where `credentials IS NOT NULL` and `calendar_id IS NOT NULL`. Properties with incomplete setup are silently skipped — they do not appear in `sync_results`.
3. If no eligible properties exist, update the `sync_runs` row to `status = 'skipped'` and `completed_at = now()`. Write no `sync_results` rows. The Logs view shows this run as "Skipped — no properties configured."
4. For each eligible property, run in parallel (no concurrency cap — acceptable for typical use of 2–5 properties):
   a. Record `started_at` for this property's `sync_results` row
   b. GET the property's `ics_url` (with timeout and retry as specified above); `webcal://` normalised to `https://` at fetch time
   c. Parse VEVENT blocks from the ICS response
   d. If zero events, write success result and continue
   e. Determine the date range: from the earliest to latest `DTSTART` in the fetched ICS
   f. Fetch existing events from the target calendar within that date range
   g. Deduplicate by UID — skip events already present (no updates)
   h. Insert new events only. Calendar write operations are not retried — a write failure records an error in `sync_results` and stops processing for that property. Other properties continue.
   i. If the failure matches known auth error patterns (`invalid_grant`, HTTP 401/403, `unauthorized`, `forbidden`, token expired/revoked, `auth failed`, `authentication failed`), set `credential_status = 'invalid'` and `credential_checked_at = now()` on the property row. On success, set `credential_status = 'ok'`.
   j. Write a `sync_results` record (events_added, events_skipped, error if any, started_at, completed_at)
5. Update `sync_runs` status:
   - `success` — all eligible properties synced without error
   - `partial` — at least one property succeeded, at least one failed
   - `failed` — all eligible properties failed
6. Purge `sync_results` and `sync_runs` records older than 90 days

Manual sync ("Sync Now" button) runs the same flow immediately. If a sync is already in progress, the button is disabled and shows "Sync in progress". The `/sync/now` endpoint returns HTTP 429 if a run is already active. No rate limiting beyond this is applied — the UI is local-network only.

---

## Scheduling

`node-cron` manages two scheduled tasks in `src/scheduler.js`:

**Monthly sync** — triggers `runSync` at `00:00` on the 1st of each month:

```js
cron.schedule('0 0 1 * *', runSync);
```

**Weekly credential check** — triggers `checkAllCredentials` every Sunday at `00:00`:

```js
cron.schedule('0 0 * * 0', checkAllCredentials);
```

The credential check iterates over all properties with stored credentials, verifies each one against its calendar provider (Google token refresh attempt or iCloud CalDAV probe), and writes the resulting `ok` or `invalid` status plus `credential_checked_at` back to the `properties` row.

---

## Google Calendar Integration

Uses the `googleapis` npm package with OAuth2.

**OAuth2 scope:** `https://www.googleapis.com/auth/calendar.events`

**Calendar:** The user's primary Google Calendar (`calendar_id = 'primary'`).

### Setup (two-phase flow, once per Google calendar)

1. User fills in label and ICS Calendar URL, selects "Google" as the calendar type
2. User clicks "Save & Connect Google Calendar" — the property is saved to the DB with `calendar_id = 'primary'` and `credentials = null`
3. App generates a cryptographically random 32-byte nonce (hex-encoded), stores it in `oauth_state` with the `property_id` and a 10-minute expiry, then constructs the OAuth `state` value as `base64url({ "property_id": <id>, "nonce": "<hex>" })`
4. User is redirected to the Google OAuth2 consent screen
5. **Happy path:** Google redirects to `GOOGLE_REDIRECT_URI?code=...&state=<base64url>`
   - App base64url-decodes `state`, looks up the nonce in `oauth_state`, validates it matches and has not expired, then deletes the row
   - App exchanges the auth code for access + refresh tokens and stores them encrypted in `credentials`
   - User is redirected to the Properties page with a success message
6. **Error / denied path:** If the callback receives an `error` parameter (e.g. `access_denied`), the `oauth_state` row is deleted, the property row remains with `credentials = null`, and the user is redirected to the Properties page with an inline error message

If the OAuth flow is abandoned (user closes the tab), the property row remains with `credentials = null`. It appears in the Properties table as "Not connected" with Reconnect and Delete buttons. It is skipped during sync and does not appear in `sync_results`.

### Syncing
- Before each sync, the access token is refreshed if expired. The refreshed access token and updated `expiry_date` are written back to the `credentials` column so the DB always reflects the current token state.
- If token refresh fails (e.g. user revoked access), this is treated as a credential error: `credential_status` is set to `'invalid'`, the error is written to `sync_results`, and processing continues for other properties. The Dashboard and Properties table surface this as a red "Credentials expired" badge with a Reconnect button.
- Existing events fetched via `calendar.events.list()` filtered by the ICS date range, deduplicated by `iCalUID`
- New events inserted via `calendar.events.insert()`

### Prerequisites
- Google Cloud project with Calendar API enabled and kept in **Testing** mode (required for local network redirect URIs)
- OAuth2 credentials created for a "Web application" credential type
- `GOOGLE_REDIRECT_URI` whitelisted exactly in the Google Cloud Console (must match protocol, NAS IP, port, and path `/auth/google/callback`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` set in environment

---

## iCloud Calendar Integration

Uses the `tsdav` npm package with CalDAV and an app-specific password.

**Credentials stored in `credentials` column:** `{ "apple_id": "...", "app_specific_password": "..." }`

**Calendar URL stored in `calendar_id`:** the CalDAV URL of the selected calendar.

### Setup (once per iCloud calendar)
1. User generates an app-specific password at appleid.apple.com — the UI provides a direct link and brief instructions
2. User enters Apple ID email and app-specific password in the Add/Edit form
3. User clicks "Fetch Calendars" — the app makes a live CalDAV request (10-second timeout, no retries) to retrieve the user's calendar list
   - If credentials are invalid or the request times out, an inline error is shown; the form stays open for correction
   - If successful, a dropdown of available calendars is populated
4. User selects the target calendar from the dropdown
5. User saves the form — credentials stored encrypted in `credentials`; the selected calendar URL stored in `calendar_id`

### Syncing
- Existing events fetched via CalDAV for the ICS date range and deduplicated by UID
- New events written via CalDAV `PUT` to `{calendar_id}/{uid}.ics`, with the VEVENT from the ICS wrapped in a VCALENDAR object as the request body. The UID from the EAC ICS is used directly as the filename.

---

## Web UI

Sidebar navigation layout with three sections:

### Dashboard
- Status card per property: label, calendar type, connection status badge, credential check date
- Badge states: green "Connected", amber "Not connected", red "Credentials expired" (when `credential_status === 'invalid'`)
- Properties with `credential_status === 'invalid'` show a Reconnect button below the badge, linking to the Properties page
- `credential_checked_at` date shown below the badge when available
- "Sync Now" button — triggers an immediate full sync; disabled and shows "Sync in progress" if a run is active
- Next scheduled sync date displayed

### Properties
- Table: Label | Calendar Type | Status | Actions
- Badge states per row: green "Connected", amber "Not connected", red "Credentials expired" (when `credential_status === 'invalid'`)
- `credential_checked_at` date shown below the badge when available
- Properties without an `ics_url` display a warning badge prompting the user to add the URL
- Actions per row:
  - Edit button (always)
  - Reconnect button: shown for all Google properties; shown for iCloud properties when `credential_status === 'invalid'`
  - Delete button (always)
- Add/Edit form:
  - Label (text)
  - ICS Calendar URL (text, `https://` or `webcal://`) — with help text linking to the EAC bin collection page
  - Calendar type selector (Google disabled with warning if Google env vars not set)
  - *If Google*: "Save & Connect Google Calendar" button → two-phase OAuth2 flow
  - *If iCloud*: Apple ID, app-specific password, "Fetch Calendars" button, calendar dropdown

### Logs
- Scrollable list of sync runs, newest first
- Each run shows: date, status (including `skipped`), duration
- Expandable to show per-property results: events added, skipped, per-property duration, error; deleted properties shown as "(deleted property)"
- Records older than 90 days auto-purged

### Health endpoint

`GET /health` returns HTTP 200 with:
```json
{ "status": "ok", "nextSync": "2026-04-01T00:00:00.000Z" }
```
Returns HTTP 500 if the DB is unavailable. Used by Docker healthcheck and Synology Container Manager.

### Credential status API

`GET /api/properties` now includes `credential_status` and `credential_checked_at` fields for each property row.

`GET /api/properties/:id/credential-status` performs an immediate credential check for a single property and returns the result:
```json
{ "status": "ok" }
```
or
```json
{ "status": "invalid" }
```
Returns HTTP 404 if the property does not exist; HTTP 400 if the property has no credentials stored. Updates `credential_status` and `credential_checked_at` on the property row as a side-effect.

---

## Deployment

### Build and publish (GitHub Actions)

```yaml
name: Build and push

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: |
            ghcr.io/${{ github.repository_owner }}/bin-calendar:latest
            ghcr.io/${{ github.repository_owner }}/bin-calendar:${{ github.sha }}
```

The image is published as `ghcr.io/<your-github-username>/bin-calendar:latest` (and tagged with the commit SHA for rollback).

### Initial setup on Synology NAS

**Prerequisites:**
- Synology NAS with Container Manager installed
- Access to the NAS via SSH or the Container Manager UI
- A Google Cloud project with Calendar API enabled (if using Google Calendar)

**Step 1 — Pull the image**

In Container Manager, go to Registry, search for `ghcr.io/<your-github-username>/bin-calendar`, and pull `latest`.

Alternatively via SSH:
```bash
docker pull ghcr.io/<your-github-username>/bin-calendar:latest
```

**Step 2 — Create the data directory**

```bash
mkdir -p /volume1/docker/bin-calendar/data
```

**Step 3 — Generate an encryption key**

`ENCRYPTION_KEY` must be a 64-character hex string (32 bytes):
```bash
openssl rand -hex 32
```

Store this key in a password manager. If it is lost or changed, all stored credentials become unreadable and must be re-entered via the UI.

**Step 4 — Create the compose file**

Create `/volume1/docker/bin-calendar/docker-compose.yml`:
```yaml
services:
  bin-calendar:
    image: ghcr.io/<your-github-username>/bin-calendar:latest
    container_name: bin-calendar
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - /volume1/docker/bin-calendar/data:/app/data
    environment:
      - ENCRYPTION_KEY=<64-char hex string from step 3>
      - GOOGLE_CLIENT_ID=<your-google-client-id>
      - GOOGLE_CLIENT_SECRET=<your-google-client-secret>
      - GOOGLE_REDIRECT_URI=http://<nas-ip>:3000/auth/google/callback
      - PORT=3000                        # optional, defaults to 3000
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 60s
      timeout: 5s
      retries: 3
```

**Port note:** The internal Express server listens on `PORT` (default `3000`). If you need a different port, set `PORT` in the environment and update both the host-side mapping and `GOOGLE_REDIRECT_URI` to match — it must match exactly what is whitelisted in the Google Cloud Console.

**Step 5 — Start the container**

```bash
cd /volume1/docker/bin-calendar
docker compose up -d
```

Or import the compose file via Container Manager UI and start the project.

**Step 6 — Access the UI**

Open `http://<nas-ip>:3000` in your browser.

### Updating to a new version

```bash
docker pull ghcr.io/<your-github-username>/bin-calendar:latest
cd /volume1/docker/bin-calendar
docker compose up -d
```

Or use Container Manager UI: stop, pull, start. The SQLite database persists in `/volume1/docker/bin-calendar/data` and is unaffected by image updates. Schema migrations run automatically on startup.

---

## Security

- Credentials encrypted at rest using AES-256-GCM with a random IV per encryption operation; key is a 32-byte value as a 64-char hex string via `ENCRYPTION_KEY`
- The UI has no authentication — the NAS must not expose port 3000 to the internet
- Google OAuth2 uses the standard authorization code flow with a cryptographically random nonce in `state` (base64url-encoded alongside `property_id`) for CSRF protection
- Missing or malformed `ENCRYPTION_KEY` causes the process to exit at startup
- Changing `ENCRYPTION_KEY` after setup invalidates all stored credentials

---

## Dependencies

| Package | Purpose |
|---|---|
| `express` | Web server and routing |
| `better-sqlite3` | SQLite database |
| `node-cron` | Monthly sync scheduling |
| `googleapis` | Google Calendar API |
| `tsdav` | iCloud CalDAV |
| `node-ical` | ICS parsing |

---

## Future Considerations

- Support for additional councils (abstracted ICS fetch layer)
- Email/webhook notification on sync failure
- Authentication for the web UI (if NAS is internet-facing)
- Updating existing events when EAC changes them (currently skipped by UID)
- Selecting a non-primary Google Calendar
