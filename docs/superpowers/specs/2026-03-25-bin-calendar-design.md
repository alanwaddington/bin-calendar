# bin-calendar Design Spec

**Date:** 2026-03-25
**Status:** Approved

## Overview

bin-calendar is a Synology NAS-hosted Docker application that fetches bin collection schedules from East Ayrshire Council and syncs them to personal Google or iCloud calendars. It supports multiple properties (UPRNs), each mapped to its own target calendar, and runs automatically on the 1st of each month.

---

## Problem Statement

East Ayrshire Council publishes bin collection schedules as downloadable ICS files. Manually checking collection dates is error-prone and time-consuming. bin-calendar automates fetching and syncing these schedules to personal calendars, supporting multiple properties (e.g. home, family members).

---

## Scope

- Single council: East Ayrshire Council
- Two calendar targets: Google Calendar (OAuth2) and iCloud (CalDAV)
- Multiple UPRN/calendar mappings, each syncing independently
- Hosted as a Docker container on a Synology NAS
- Web UI for configuration and monitoring

Out of scope (for now):
- Support for other councils
- Mobile app or push notifications
- Email notifications on sync failure

---

## Architecture

Single Docker container running a Node.js + Express application. It serves the web UI, manages the SQLite database, handles scheduling via node-cron, and performs calendar syncs.

```
bin-calendar/
├── src/
│   ├── server.js          # Express app and routes
│   ├── scheduler.js       # node-cron: fires sync on 1st of each month
│   ├── sync.js            # Orchestrates per-UPRN sync run
│   ├── ics.js             # Fetches and parses EAC ICS endpoint
│   ├── google.js          # Google Calendar API integration (googleapis)
│   ├── icloud.js          # iCloud CalDAV integration (tsdav)
│   └── db.js              # SQLite via better-sqlite3
├── public/                # Web UI (plain HTML/CSS/JS, no framework)
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## Data Model

### `properties`
One row per UPRN/calendar mapping.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| label | TEXT | Friendly name (e.g. "Home", "Mum") |
| uprn | TEXT | East Ayrshire UPRN |
| calendar_type | TEXT | `google` or `icloud` |
| calendar_id | TEXT | Google calendar ID or iCloud calendar URL |
| credentials | TEXT | JSON, AES-256 encrypted at rest |
| created_at | DATETIME | |

### `sync_runs`
One row per sync execution (scheduled or manual).

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| started_at | DATETIME | |
| completed_at | DATETIME | |
| status | TEXT | `running`, `success`, `partial`, `failed` |

### `sync_results`
One row per property per sync run.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| run_id | INTEGER FK | References sync_runs |
| property_id | INTEGER FK | References properties |
| events_added | INTEGER | |
| events_skipped | INTEGER | |
| error | TEXT | Null on success |
| completed_at | DATETIME | |

Records older than 90 days are automatically purged on each sync run.

---

## ICS Fetch

East Ayrshire Council exposes an unauthenticated POST endpoint:

```
POST https://www.east-ayrshire.gov.uk/WasteCalendarICSDownload
Content-Type: application/x-www-form-urlencoded

uprn=<UPRN>&captchaResponse=
```

No session, cookies, or CAPTCHA handling required. The response is a valid ICS file with VEVENT blocks. Event UIDs follow the format `EAC_YYYYMMDD_N` and are used for deduplication.

---

## Sync Flow

1. Create a `sync_runs` record with status `running`
2. For each property, run in parallel:
   a. POST to EAC endpoint with UPRN
   b. Parse VEVENT blocks from the ICS response
   c. Fetch existing events from the target calendar for the same date range
   d. Deduplicate by UID (`EAC_YYYYMMDD_N`) — skip events already present
   e. Insert new events only
   f. Write a `sync_results` record (events added, skipped, error if any)
3. Update `sync_runs` status:
   - `success` — all properties synced without error
   - `partial` — at least one property succeeded, at least one failed
   - `failed` — all properties failed

Manual sync ("Sync Now" button) runs the same flow immediately outside the schedule.

---

## Scheduling

`node-cron` triggers the sync at `00:00` on the 1st of each month:

```js
cron.schedule('0 0 1 * *', runSync);
```

---

## Google Calendar Integration

Uses the `googleapis` npm package with OAuth2.

### Setup (once per Google calendar)
1. User clicks "Connect Google Calendar" in the Add/Edit property form
2. App redirects to Google OAuth2 consent screen
3. Google redirects back to `GOOGLE_REDIRECT_URI` with an auth code
4. App exchanges auth code for access + refresh tokens
5. Tokens stored encrypted in the `credentials` column of `properties`

### Syncing
- Access token refreshed automatically using the stored refresh token
- Events inserted via `calendar.events.insert()`
- Existing events fetched via `calendar.events.list()` filtered by time range
- Deduplication by event `iCalUID` field

### Prerequisites
- Google Cloud project with Calendar API enabled
- OAuth2 credentials (client ID + secret) configured
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` set in environment

---

## iCloud Calendar Integration

Uses the `tsdav` npm package with CalDAV and an app-specific password.

### Setup (once per iCloud calendar)
1. User generates an app-specific password at appleid.apple.com (done outside the app — UI provides a direct link and instructions)
2. User enters Apple ID email, app-specific password in the Add/Edit form
3. App fetches the user's calendar list via CalDAV and presents a dropdown
4. User selects the target calendar
5. Credentials stored encrypted in the `credentials` column

### Syncing
- Events written via CalDAV `PUT` requests
- Existing events fetched and deduplicated by UID before inserting

---

## Web UI

Sidebar navigation layout with three sections:

### Dashboard
- Status card per property: label, calendar type, last synced date, events added, error (if any)
- "Sync Now" button — triggers an immediate full sync
- Next scheduled sync date displayed

### Properties
- Table: Label | UPRN | Calendar Type | Last Sync Status | Actions
- Add / Edit / Delete actions per row
- Add/Edit form:
  - Label (text)
  - UPRN (text)
  - Calendar type (Google / iCloud selector)
  - *If Google*: "Connect Google Calendar" button → OAuth2 flow
  - *If iCloud*: Apple ID, app-specific password, calendar selector (populated via CalDAV)

### Logs
- Scrollable list of sync runs, newest first
- Each run shows: date, status, duration
- Expandable to show per-property results: events added, skipped, error
- Records older than 90 days auto-purged

---

## Deployment

### Build and publish (GitHub Actions)

A GitHub Actions workflow on push to `main`:
1. Builds the Docker image
2. Pushes to GitHub Container Registry (GHCR) as `ghcr.io/<owner>/bin-calendar:latest`

### Initial setup on Synology NAS

**Prerequisites:**
- Synology NAS with Container Manager installed
- Access to the NAS via SSH or the Container Manager UI
- A Google Cloud project with Calendar API enabled (if using Google Calendar)

**Step 1 — Pull the image**

In Container Manager, go to Registry, search for `ghcr.io/<owner>/bin-calendar`, and pull `latest`.

Alternatively via SSH:
```bash
docker pull ghcr.io/<owner>/bin-calendar:latest
```

**Step 2 — Create the data directory**

On the NAS, create a directory for the SQLite database:
```bash
mkdir -p /volume1/docker/bin-calendar/data
```

**Step 3 — Create the compose file**

Create `/volume1/docker/bin-calendar/docker-compose.yml`:
```yaml
services:
  bin-calendar:
    image: ghcr.io/<owner>/bin-calendar:latest
    container_name: bin-calendar
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - /volume1/docker/bin-calendar/data:/app/data
    environment:
      - ENCRYPTION_KEY=<random-32-char-string>
      - GOOGLE_CLIENT_ID=<your-google-client-id>
      - GOOGLE_CLIENT_SECRET=<your-google-client-secret>
      - GOOGLE_REDIRECT_URI=http://<nas-ip>:3000/auth/google/callback
```

**Step 4 — Start the container**

In Container Manager, import the compose file and start the project. Or via SSH:
```bash
cd /volume1/docker/bin-calendar
docker compose up -d
```

**Step 5 — Access the UI**

Open `http://<nas-ip>:3000` in your browser.

### Updating to a new version

1. Pull the latest image:
   ```bash
   docker pull ghcr.io/<owner>/bin-calendar:latest
   ```
2. Restart the container:
   ```bash
   cd /volume1/docker/bin-calendar
   docker compose up -d
   ```
   Or use the Container Manager UI: stop the project, pull the new image, start again.

The SQLite database persists in `/volume1/docker/bin-calendar/data` and is unaffected by image updates.

---

## Security

- Credentials (Google tokens, iCloud passwords) encrypted at rest using AES-256 with a key set via `ENCRYPTION_KEY` environment variable
- The UI has no authentication — access should be restricted to the local network (the NAS should not expose port 3000 to the internet)
- Google OAuth2 uses the standard authorization code flow; refresh tokens are stored encrypted

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
