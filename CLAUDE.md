# bin-calendar — Project Rules

## Project Overview

A self-hosted Node.js/Express SPA that fetches bin collection schedules from East Ayrshire Council and syncs them to Google Calendar or iCloud. Runs in Docker on a Synology NAS. SQLite database. Vanilla JS frontend with no build step.

## Commands

```bash
npm test              # Run full test suite with coverage
npm test -- --watch   # Watch mode
node src/server.js    # Start dev server (requires ENCRYPTION_KEY env var)
ENCRYPTION_KEY=$(openssl rand -hex 32) node src/server.js
```

## Architecture

- **`src/server.js`** — Express API + static file serving
- **`src/sync.js`** — Sync orchestrator (fetches ICS, pushes to Google/iCloud)
- **`src/credential-check.js`** — Credential validation orchestrator
- **`src/scheduler.js`** — node-cron: monthly sync (1st of month) + weekly credential check (Sundays)
- **`src/google.js`** — Google Calendar integration (googleapis OAuth2)
- **`src/icloud.js`** — iCloud CalDAV integration (tsdav)
- **`src/ics.js`** — ICS fetcher and parser
- **`src/db.js`** — SQLite setup, migrations, connection singleton
- **`src/crypto.js`** — AES-256-GCM credential encryption
- **`src/migrations/`** — Sequential SQL migrations (001.sql, 002.sql, …)
- **`public/`** — Vanilla JS SPA (index.html, style.css, app.js, dashboard.js, properties.js, logs.js)

## Testing

- Framework: Jest (CommonJS — no ES modules)
- Coverage threshold: **80% on all metrics** — the build fails below this
- Test structure: `tests/unit/`, `tests/integration/`, `tests/api/`
- Test naming convention: `MethodName_Scenario_ExpectedResult`
- Pattern: Arrange-Act-Assert
- All external dependencies mocked via `jest.mock()` — never hit real APIs in tests
- `jest.mock()` calls must be at the top of the file (hoisting requirement)
- Integration tests for `server.js` use Supertest

## Development Workflow

Follow the `/analyse` → `/design` → `/develop` → `/pr-reviewer` → `/merge` lifecycle for all features.

### Branching
- Feature branches: `feature/<issue-number>-<short-description>`
- Always branch from `main`

### TDD (Strict)
1. Write failing tests first
2. Write minimum production code to pass
3. Refactor with tests green
4. Never write production code without a failing test first

### Commits
- Reference the issue number: `#4 Task 1: Add credential_status migration`
- Commit at minimum once per completed task

## Frontend Rules

**Any task that touches HTML templates, CSS, JavaScript interactions, layouts, or any visual component requires the `/product-designer` skill. This is mandatory — do not write frontend code without invoking it first.**

- Frontend is vanilla JS only — no frameworks, no build step
- Files: `public/style.css`, `public/index.html`, `public/app.js`, `public/dashboard.js`, `public/properties.js`, `public/logs.js`
- XSS escaping is **always** required:
  - `escHtml()` for all user data in HTML content
  - `escAttr()` for all user data in HTML attributes
  - `escLogHtml()` in `logs.js`
  - Never assign unescaped user data to `innerHTML`
- Existing API contracts must be preserved — the frontend calls the backend, not the other way round
- Shared utilities live in `app.js`: `api()`, `navigate()`, `registerView()`, `showToast()`, `CONFIG`

## Database

- SQLite via `better-sqlite3` (synchronous API)
- Migrations: sequential SQL files in `src/migrations/` — run automatically at startup
- New migrations: create the next numbered file (e.g. `003.sql`)
- Never modify existing migration files — always add a new one
- `getDb()` returns the singleton connection

## Security

- Credentials encrypted at rest with AES-256-GCM (`src/crypto.js`)
- Never log decrypted credentials
- Never return credentials or encryption keys in API responses
- Validate all user input at API boundaries
- Use parameterised queries — never string-concatenate SQL

## Deployment

- Docker on Synology NAS
- Image published to `ghcr.io/alanwaddington/bin-calendar:latest` via GitHub Actions on push to `main`
- Data volume: `/volume1/docker/bin-calendar/data` → `/app/data`
- Database file: `/app/data/bin-calendar.db`
- CI/CD: tests must pass before image is built

## GitHub Project

- Issues use the `/analyse` → `/design` → `/develop` → `/pr-reviewer` → `/merge` lifecycle
- PR reviews saved to `docs/pr-reviews/PR-<number>-review.md`
- Design specs in `docs/superpowers/specs/`
- Implementation plans in `docs/superpowers/plans/`
