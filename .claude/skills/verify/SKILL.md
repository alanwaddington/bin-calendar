---
name: verify
description: How to launch and drive bin-calendar for runtime verification (not just tests)
---

# Verifying bin-calendar at runtime

## Launch (isolated DB, no Docker needed)

```bash
mkdir -p /tmp/verify-data
export DB_PATH=/tmp/verify-data/bin-calendar.db   # fresh SQLite, migrations run automatically
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export PORT=3977                                   # avoid colliding with a real dev instance
node src/server.js &> /tmp/verify-server.log &
for i in {1..20}; do curl -sf http://localhost:$PORT/health > /dev/null && break; sleep 0.5; done
curl -s http://localhost:$PORT/health   # {"status":"ok","nextSync":"..."}
```

Stop with `lsof -ti:$PORT -sTCP:LISTEN | xargs -r kill`.

No `data/` dir or `.env` exists in the repo checkout — `DB_PATH` always needs
setting explicitly or it defaults to `/app/data/bin-calendar.db` (the Docker
path) and migrations will fail to create it locally.

## Seeding data for API/UI verification

The app has no seed script. To test flows that need events (e.g. Garden
Waste display gating, next-collection), insert rows directly with
`better-sqlite3` against `$DB_PATH` — the `events` and `bin_types` tables
are plain SQL, no ORM:

```bash
DB_PATH=$DB_PATH node -e "
const db = new (require('better-sqlite3'))(process.env.DB_PATH);
db.prepare('INSERT INTO events (property_id, uid, summary, start_date, end_date) VALUES (?,?,?,?,?)')
  .run(1, 'uid-1', 'Garden waste', '2026-11-05', '2026-11-06');
"
```

`sync_results` columns are `events_added, events_skipped, events_deleted,
started_at, completed_at` (no `status` column — that's only on `sync_runs`).

## Driving the API

Plain `curl` against `http://localhost:$PORT/api/...` — see `src/server.js`
for the full route list. Creating a property via POST only requires
`label`, `ics_url` (must start with `https://` or `webcal://`), and
`calendar_type` (`google`|`icloud`).

## Driving the frontend (no Playwright preinstalled)

Playwright's `npx playwright install chromium --with-deps` fails here (no
passwordless sudo). Instead, install plain `playwright` as a local npm
package in a scratch dir and install the browser without `--with-deps` —
the browser launches fine without the system deps step:

```bash
mkdir -p /tmp/pw-verify && cd /tmp/pw-verify
npm init -y && npm install playwright
npx playwright install chromium   # no --with-deps
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:3977/#settings');
  await page.screenshot({ path: 'shot.png', fullPage: true });
  await browser.close();
})();
"
```

The SPA is hash-routed: `#dashboard`, `#calendar`, `#settings`, `#logs`
(see `public/app.js` `navigate()`). Settings renders property accordions
(`#acc-prop-<id>`, click `.accordion-header` to expand) and a Bin Types
table below them, both on the same `#settings` view — no separate route.

Gotcha: several bin-type rows can share a Match/Label text across case
(e.g. badge "Garden waste" vs. another row's Label "Garden Waste") —
Playwright's `text=` selector is case-insensitive, so `tr:has-text(...)`
can match multiple rows. Find the row by exact `textContent.trim()` via
`page.evaluate`, capture its index, and re-locate by index after any
click that re-renders the table (editing a row changes its cell content
so text-based re-matching breaks after the first interaction).

## Destructive / uncoverable live

`sync.js`'s actual push/delete against Google Calendar or iCloud requires
real OAuth/CalDAV credentials and writes to a real external calendar —
never drive this live. `POST /api/sync` short-circuits to `"Skipped — no
properties configured"` when no property has `connected`/credentials set,
which is a safe way to confirm the endpoint responds without risking a
real external write.
