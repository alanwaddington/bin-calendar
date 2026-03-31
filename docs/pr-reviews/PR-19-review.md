# PR #19 Review — Allow user to configure a custom global sync frequency via cron expression (#18)

**Date:** 2026-03-31
**Author:** alanwaddington
**Branch:** feature/18-configurable-sync-frequency → main
**State:** Open

---

## Summary

| Item | Result |
|------|--------|
| Overall Assessment | Pass with comments ⚠️ |
| Risk Level | Low |
| Test Coverage | Adequate — 97% statements, 90% branches, 163 tests |
| Acceptance Criteria | 14/14 Met |

---

## Issues Reviewed

### Issue Hierarchy
- #18 — Allow user to configure a custom global sync frequency via cron expression (root — contains both Analysis and Design)

No parent or sub-issues.

---

## Changed Files Audit

### `src/migrations/004.sql` (+14 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | Create `settings` KV table with PK, NOT NULL, updated_at trigger, and default `sync_cron` seed row |
| Issues | #18 |
| Criteria covered | AC1 (settings table), AC10 (default expression) |
| Quality | ✅ No issues — uses `IF NOT EXISTS` guards, `INSERT OR IGNORE` for idempotency, parameterised trigger |
| Test coverage | `db.test.js`: 4 tests — table existence, seed value, PK constraint, updated_at |

### `src/scheduler.js` (+31 / -7 lines)

| Property | Detail |
|----------|--------|
| Purpose | Load cron expression from DB on startup, compute next-run date dynamically via `cron-parser`, expose `restartSyncSchedule()` for hot-swapping the schedule |
| Issues | #18 |
| Criteria covered | AC2 (startup reads from DB with fallback), AC4 (restart scheduler), AC8 (next sync updates) |
| Quality | ✅ Clean refactoring — `scheduleSyncTask()` extracted to avoid duplication, `loadCronExpression()` has try/catch fallback |
| Test coverage | `scheduler.test.js`: 12 tests covering DB load, fallback, restart, next-date, credential isolation, callbacks |

### `src/server.js` (+30 / -1 lines)

| Property | Detail |
|----------|--------|
| Purpose | Add `GET /api/settings/sync-schedule` and `PUT /api/settings/sync-schedule` endpoints |
| Issues | #18 |
| Criteria covered | AC3 (GET returns cronExpression + nextSync), AC4 (PUT saves + restarts + returns), AC5 (invalid returns 400) |
| Quality | ✅ Parameterised SQL, `cron.validate()` for server-side validation, proper error handling with try/catch |
| Test coverage | `server.test.js`: 11 new tests — GET happy path, GET fallback, GET error, PUT valid, PUT invalid, PUT missing, PUT error, plus integration edge cases |

### `public/properties.js` (+112 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | Add "Sync Schedule" accordion section above Properties in Settings UI |
| Issues | #18 |
| Criteria covered | AC6 (editable input), AC7 (save triggers PUT + toast), AC8 (next sync updates), AC9 (inline validation), AC10 (example expressions), AC12 (XSS escaping) |
| Quality | See findings below |
| Test coverage | No automated frontend tests (vanilla JS, no test framework) — manual verification required |

### `public/style.css` (+16 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | Add `.sync-schedule-examples` and `.sync-schedule-next` utility classes |
| Issues | #18 |
| Criteria covered | Supporting styles for AC6/AC10 |
| Quality | ✅ Follows existing design token patterns, consistent with codebase |
| Test coverage | Visual verification only |

### `package.json` / `package-lock.json` (+23 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | Add `cron-parser` ^5.5.0 dependency |
| Issues | #18 |
| Criteria covered | Supports dynamic `getNextSyncDate()` |
| Quality | ✅ `cron-parser` is a well-maintained package — only adds `luxon` as transitive dependency |
| Test coverage | N/A |

### `tests/unit/db.test.js` (+35 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | Verify migration 004 creates settings table with correct schema and seed data |
| Issues | #18 |
| Quality | ✅ Follows existing test patterns — fresh module + temp DB per test, Arrange-Act-Assert |

### `tests/unit/scheduler.test.js` (+71 / -36 lines)

| Property | Detail |
|----------|--------|
| Purpose | Test all scheduler functions including new DB-driven loading, restart, and dynamic next-date |
| Issues | #18 |
| Quality | ✅ Comprehensive — mock factory creates unique objects per call, tests isolation of credential task |

### `tests/api/server.test.js` (+123 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | API tests for GET/PUT sync-schedule endpoints plus integration edge cases |
| Issues | #18 |
| Quality | ✅ Covers happy path, validation, errors, and cross-endpoint integration |

---

## Acceptance Criteria Verification

### #18 — Allow user to configure a custom global sync frequency via cron expression

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| 1 | Settings table created via migration | `src/migrations/004.sql:1-14` | `db.test.js:135-168` (4 tests) | ✅ Met |
| 2 | Scheduler reads cron from DB on startup; falls back to `0 0 1 * *` | `src/scheduler.js:13-19,34-36` | `scheduler.test.js:33-45` (2 tests) | ✅ Met |
| 3 | GET returns `{ cronExpression, nextSync }` | `src/server.js:274-281` | `server.test.js:631-650` (2 tests) | ✅ Met |
| 4 | PUT with valid expression saves, restarts, returns updated data | `src/server.js:284-296` | `server.test.js:654-667` | ✅ Met |
| 5 | PUT with invalid expression returns 400 | `src/server.js:287` | `server.test.js:669-676` | ✅ Met |
| 6 | Settings UI displays cron expression in editable input | `public/properties.js:67-69` | Manual | ✅ Met |
| 7 | Saving valid expression triggers PUT and shows success toast | `public/properties.js:131-137` | Manual | ✅ Met |
| 8 | Next sync date updates after save | `public/properties.js:134` | `server.test.js:702-708` (health reflects change) | ✅ Met |
| 9 | Inline validation error on invalid cron | `public/properties.js:118-129` (client) + `server.test.js:669-676` (server) | Manual + automated | ✅ Met |
| 10 | Example expressions shown | `public/properties.js:72-77` | Visual | ✅ Met |
| 11 | Server-side code meets 80% coverage | 97% stmts, 90% branches | `npm test --coverage` | ✅ Met |
| 12 | Frontend follows XSS escaping rules | `escHtml()` at lines 50, 59, 83, 134; `escAttr()` at line 68 | Code audit | ✅ Met |
| 13 | Manual Sync Now unaffected | `runSync()` path unchanged in `server.js:172-179` | `server.test.js:711-718` | ✅ Met |
| 14 | Schedule change doesn't affect running syncs | `restartSyncSchedule` only stops/starts the cron task, not `runSync()` | `scheduler.test.js:93-99` (credential isolation) | ✅ Met |

**Summary:** 14/14 criteria met.

---

## Findings

### Critical (must fix before merge)

None.

### Major (should fix)

#### M1 — `DEFAULT_SYNC_CRON` duplicated across modules ✅ Resolved
- **Category:** Code Quality
- **Location:** `src/scheduler.js:7`, `src/server.js:272`
- **Description:** The default cron expression `'0 0 1 * *'` is defined as a constant in both `scheduler.js` (`DEFAULT_CRON`) and `server.js` (`DEFAULT_SYNC_CRON`). If the default ever changes, both must be updated in lockstep. Since the migration also seeds this value, there are three places defining the same default.
- **Recommendation:** Export `DEFAULT_CRON` from `scheduler.js` and import it in `server.js` instead of redeclaring. The migration seed is acceptable as a one-time bootstrap value.
- **Resolution:** `DEFAULT_CRON` now exported from `scheduler.js` and imported in `server.js`. Duplicate constant removed.

### Minor (nice to fix)

#### m1 — `subtitleEl.textContent` bypasses `escHtml()` on save success ✅ Resolved
- **Category:** Security
- **Location:** `public/properties.js:135`
- **Description:** On save success, `subtitleEl.textContent = data.cronExpression` sets the subtitle. Using `.textContent` is safe (it does not parse HTML), so this is not a vulnerability — but it's inconsistent with the project's convention of always using `escHtml()` for user-sourced data. For consistency with the XSS escaping rules in CLAUDE.md, prefer `subtitleEl.textContent` (which is already correct) or document why it's acceptable.
- **Recommendation:** No change needed — `.textContent` is inherently safe. This is noted for consistency awareness only.
- **Resolution:** Changed to `subtitleEl.innerHTML = escHtml(data.cronExpression)` for full consistency with the codebase XSS escaping convention.

#### m2 — `cron-parser` brings `luxon` as a transitive dependency ⚠️ Not actionable
- **Category:** Performance / Bundle Size
- **Location:** `package.json`
- **Description:** `cron-parser` v5 depends on `luxon` (~73KB minified), which is a relatively large date library. This only affects the Docker image size, not runtime performance, so the impact is minimal for a self-hosted NAS application.
- **Recommendation:** Acceptable for now. If image size becomes a concern, consider `cron-parser` v4 (which has no `luxon` dependency) or compute next-occurrence manually for 5-field cron.
- **Resolution:** Not actionable — investigation confirms `luxon` is a dependency of all released versions of `cron-parser` (v3, v4, and v5). The finding stands as accepted risk.

### Suggestions (optional)

#### S1 — Disable save button during API call ✅ Resolved
- **Category:** UX
- **Location:** `public/properties.js:108-141`
- **Description:** The save button doesn't disable while the PUT request is in flight, allowing double-submission. This is a minor UX issue — the server handles idempotent upserts, so double-submission is harmless, but disabling the button would provide better feedback.
- **Recommendation:** Add `button.disabled = true` at the start of `saveSyncSchedule()` and re-enable in the `finally` block.
- **Resolution:** Button is now disabled at start of API call and re-enabled in `finally` block.

---

## Positive Observations

- **Clean TDD workflow** — each task followed red-green-refactor with per-task commits referencing the issue
- **Thorough test coverage** — 28 new tests across 3 test files; 97% statement coverage maintained
- **Good separation of concerns** — `loadCronExpression()` and `scheduleSyncTask()` extracted cleanly from `startScheduler()`
- **Proper XSS escaping** — all dynamic user data in the HTML template uses `escHtml()` or `escAttr()`
- **Parameterised SQL throughout** — no string concatenation in queries
- **Graceful fallback** — `loadCronExpression()` catches errors and falls back to the default, preventing startup failures if the settings table doesn't exist yet
- **Consistent with existing patterns** — accordion structure, `api()` helper usage, `showToast()`, error display all match the existing codebase conventions

---

## Action Items

### Immediate Fixes (block merge)
None.

### Post-merge improvements
- [x] M1: Consolidate `DEFAULT_SYNC_CRON` constant — export from `scheduler.js` and import in `server.js`
- [x] m1: Switch subtitle update to `innerHTML` + `escHtml()` for XSS convention consistency
- [ ] m2: `cron-parser` → `luxon` transitive dependency — not actionable (all versions affected)
- [x] S1: Disable save button during API call for better UX feedback

---

## Checklist

- [x] All acceptance criteria from the full issue hierarchy verified by reading actual code
- [x] Every changed file read and audited
- [x] Tests cover happy path, error paths, and edge cases
- [x] No security vulnerabilities introduced
- [x] No performance regressions
- [x] Error handling complete and consistent
- [x] Logging adequate for debugging production issues
- [x] Code follows existing codebase conventions
- [x] No unnecessary changes outside scope of the issue
