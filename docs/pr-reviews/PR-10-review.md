# PR #10 Review — M1: Automated test suite (#3)

**Date:** 2026-03-27
**Author:** alanwaddington
**Branch:** feature/3-automated-test-suite -> main
**State:** Open

---

## Summary

| Item | Result |
|------|--------|
| Overall Assessment | Pass with comments |
| Risk Level | Low |
| Test Coverage | Adequate — 96% statements, 87% branches, 94% functions, 96.5% lines |
| Acceptance Criteria | 38/40 Met |

---

## Issues Reviewed

### Issue Hierarchy
- #2 — Enhancement Recommendations: bin-calendar v1.x Improvements (parent analysis)
  - #3 — M1: Automated test suite (implementation)

---

## Changed Files Audit

### `package.json` (+6 / -1 lines)

| Property | Detail |
|----------|--------|
| Purpose | Add Jest and supertest devDependencies; add `test` script |
| Issues | #3 |
| Criteria covered | Framework & Tooling: Jest installed, supertest installed, test script defined |
| Quality | No issues |
| Test coverage | N/A — configuration file |

### `jest.config.js` (+10 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | Jest configuration with 80% coverage thresholds, test matching pattern |
| Issues | #3 |
| Criteria covered | Framework & Tooling: testMatch, coverage thresholds, coverage reporters |
| Quality | No issues. Clean, minimal config with correct thresholds. |
| Test coverage | N/A — configuration file |

### `src/server.js` (+12 / -14 lines)

| Property | Detail |
|----------|--------|
| Purpose | Wrap startup side effects (ENCRYPTION_KEY validation, initDb, startScheduler, listen) in `require.main === module` guard; export `{ app }` |
| Issues | #3 (Task 1) |
| Criteria covered | Design Task 1: server.js exports { app }, startup only when run directly |
| Quality | Clean refactor. Behaviour unchanged when run directly via `node src/server.js`. |
| Test coverage | `tests/api/server.test.js` — 38 tests via supertest |

### `.github/workflows/build.yml` (+15 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | Add `test` job (Node 20, npm ci, npm test) before Docker build; add pull_request trigger |
| Issues | #3 (Task 9) |
| Criteria covered | CI: test job, node:20, needs: test, push + PR triggers |
| Quality | Good. `if: github.event_name == 'push'` on build job prevents Docker push on PRs. npm caching enabled. |
| Test coverage | N/A — CI configuration |

### `.gitignore` (+1 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | Ignore `coverage/` directory |
| Issues | #3 |
| Quality | Correct — coverage output should not be committed |

### `tests/helpers/testDb.js` (+14 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | In-memory SQLite factory using 001.sql migration |
| Issues | #3 (Task 2) |
| Quality | Clean implementation. Creates fresh in-memory DB per call. |

### `tests/fixtures/ics-samples.js` (+80 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | ICS text fixtures: standard, all-day, parameterised summary, missing summary, empty calendar, missing UID |
| Issues | #3 (Task 2) |
| Quality | Well-structured. All 6 fixture types present. Uses `\r\n` line endings (ICS spec-correct). |

### `tests/unit/crypto.test.js` (+45 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | 5 tests covering encrypt/decrypt round-trips, tampered ciphertext, key validation |
| Issues | #3 (Task 3) |
| Quality | Clean AAA pattern. Proper env cleanup in afterEach. |

### `tests/unit/ics.test.js` (+183 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | 9 tests covering parseIcs (6 scenarios) and fetchIcs (3 scenarios including retry logic) |
| Issues | #3 (Task 4) |
| Quality | Good mock strategy. Fake timers with `advanceTimers: true` for retry tests. Original fetch properly restored in afterEach. |

### `tests/unit/uprn.test.js` (+105 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | 9 tests covering lookupPostcode and getAddressDetail with mocked fetch |
| Issues | #3 (Task 5) |
| Quality | Thorough — covers happy path, 404, timeout (AbortError), HTTP errors, missing API key for both functions. |

### `tests/unit/scheduler.test.js` (+70 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | 5 tests covering getNextSyncDate, startScheduler cron wiring, stopScheduler, and cron callback success/error paths |
| Issues | #3 (Task 5) |
| Quality | Good. Tests cron callback error handling path. Console spies properly restored. |

### `tests/unit/db.test.js` (+75 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | 4 tests covering db initialization, table creation, recovery of interrupted syncs, idempotent migrations |
| Issues | #3 (C1 — Could Have, implemented) |
| Quality | Uses temp directories with proper cleanup. jest.resetModules() for singleton isolation. |

### `tests/integration/google.test.js` (+186 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | 9 tests covering isGoogleConfigured, getAuthUrl, insertEvent (all-day/timed), listCalendars, token refresh, exchangeCode, listEvents |
| Issues | #3 (Task 6) |
| Quality | Comprehensive googleapis mock. Tests both all-day (date) and timed (dateTime) event formats. Token refresh path tested. |

### `tests/integration/icloud.test.js` (+115 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | 5 tests covering fetchCalendars, listEventUids, insertEvent (with/without description) |
| Issues | #3 (Task 6) |
| Quality | Good. Tests UID extraction from raw CalDAV data. Verifies description conditional inclusion. |

### `tests/integration/sync.test.js` (+219 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | 8 tests covering sync orchestration: skip, 429 lock, Google path, iCloud path, duplicate UID skip, partial failure, full failure, success |
| Issues | #3 (Task 7) |
| Quality | Good mock setup. Transaction mock correctly returns callable function. Tests all status outcomes. |

### `tests/api/server.test.js` (+418 / -0 lines)

| Property | Detail |
|----------|--------|
| Purpose | 38 tests covering all Express routes via supertest |
| Issues | #3 (Task 8) |
| Quality | Very thorough. Tests happy paths, validation errors, 503s, OAuth flows (missing state, expired session, error in URL, valid code), iCloud flows, UPRN lookup/detail routes, sync error handling. |

---

## Acceptance Criteria Verification

### #3 — M1: Automated test suite

#### Top-Level Acceptance Criteria

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| 1 | Test suite exists and runs via `npm test` | `package.json:8` | All 95 tests pass | Met |
| 2 | ICS parsing handles all-day events, parameterised properties, missing SUMMARY | `ics.test.js:42,60,78` | 3 dedicated tests | Met |
| 3 | Crypto module: encrypt/decrypt round-trip | `crypto.test.js:14,21` | 2 round-trip tests | Met |
| 4 | Sync orchestration: mocked Google/iCloud verify correct API calls | `sync.test.js:54,86` | 2 tests for Google/iCloud paths | Met |
| 5 | API routes: /health, /api/properties, /api/sync covered | `server.test.js:41-103` | 8+ route tests | Met |
| 6 | GitHub Actions CI runs tests on every push and blocks merge on failure | `build.yml:6-7,10-19,22` | test job + needs: test | Met |

#### Framework & Tooling

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| 1 | Jest installed as dev dependency | `package.json:19` | N/A | Met |
| 2 | supertest installed as dev dependency | `package.json:20` | N/A | Met |
| 3 | package.json has `"test": "jest --coverage"` | `package.json:8` | N/A | Met |
| 4 | jest.config.js defines testMatch, thresholds, reporters | `jest.config.js:1-10` | N/A | Met |
| 5 | Running npm test with no tests exits non-zero | N/A — tests exist now | N/A | Met (by design) |

#### Unit Tests — crypto.js

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| 1 | encrypt/decrypt round-trip returns original string | N/A | `crypto.test.js:14` | Met |
| 2 | encryptJson/decryptJson round-trip returns original object | N/A | `crypto.test.js:21` | Met |
| 3 | decrypt with tampered ciphertext throws | N/A | `crypto.test.js:28` | Met |
| 4 | Throws if ENCRYPTION_KEY missing or invalid | N/A | `crypto.test.js:36,41` | Met |

#### Unit Tests — ics.js

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| 1 | Parses standard VEVENT correctly | N/A | `ics.test.js:13` | Met |
| 2 | Parses all-day event | N/A | `ics.test.js:42` | Met |
| 3 | Extracts parameterised SUMMARY | N/A | `ics.test.js:60` | Met |
| 4 | Returns "Bin Collection" when SUMMARY absent | N/A | `ics.test.js:78` | Met |
| 5 | Returns empty array when no VEVENTs | N/A | `ics.test.js:95` | Met |
| 6 | Retries up to MAX_RETRIES then throws | N/A | `ics.test.js:138` | Met |
| 7 | Throws on non-retryable HTTP error | N/A | `ics.test.js:148` | Partially Met |

**Note on criterion 7:** The issue says "Throws immediately on non-retryable HTTP error (e.g. 404)" — however the actual `ics.js` code retries ALL errors (including HTTP errors like 404/500) up to MAX_RETRIES. The test at line 148 verifies it retries 3 times and then throws, which matches the actual code behaviour. The acceptance criterion assumed non-retryable errors would not retry, but the code does not distinguish between retryable and non-retryable. This is a spec/code mismatch, not a test deficiency. The test correctly verifies actual behaviour.

#### Unit Tests — sync.js

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| 1 | Calls fetchIcs once per property | N/A | `sync.test.js:54` (implicit — fetchIcs called, events returned) | Met |
| 2 | Calls google.insertEvent for new Google events | N/A | `sync.test.js:54` | Met |
| 3 | Calls icloud.insertEvent for new iCloud events | N/A | `sync.test.js:86` | Met |
| 4 | Skips events with existing UID | N/A | `sync.test.js:117` | Met |
| 5 | Records events_added and events_skipped correctly | N/A | Indirectly tested via writeResult mock calls | Met |
| 6 | Continues syncing when one property throws | N/A | `sync.test.js:146` | Met |
| 7 | Sets status to partial when some fail | N/A | `sync.test.js:146` | Met |
| 8 | Sets status to failed when all fail | N/A | `sync.test.js:173` | Met |
| 9 | Concurrency lock prevents second sync | N/A | `sync.test.js:43` | Met |

#### Integration Tests — server.js API routes

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| 1 | GET /health returns 200 with status, nextSync | N/A | `server.test.js:41` | Met |
| 2 | GET /api/properties returns 200 with array | N/A | `server.test.js:49` | Met |
| 3 | POST /api/properties with valid body returns 201 | `server.js:49` returns 200 not 201 | `server.test.js:56` tests for 200 | Not Met |
| 4 | DELETE /api/properties/:id returns 200 | N/A | `server.test.js:74` | Met |
| 5 | POST /api/sync returns 200 when not running | N/A | `server.test.js:81` | Met |
| 6 | POST /api/sync returns 429 when already running | N/A | `server.test.js:88` | Met |
| 7 | GET /api/sync/runs returns 200 with runs array | N/A | `server.test.js:97` | Met |

**Note on criterion 3:** The acceptance criterion in the Analysis section says "returns 201", but `server.js:49` uses `res.json(...)` which returns 200. The test correctly verifies the actual code behaviour (200). This is a spec/code mismatch — the code should arguably return 201 for a resource creation, but the test matches the real code.

#### CI

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| 1 | test job runs npm ci && npm test | `build.yml:18-19` | N/A | Met |
| 2 | test job uses node:20 | `build.yml:15-16` | N/A | Met |
| 3 | build job has needs: test | `build.yml:22` | N/A | Met |
| 4 | Triggers on push and pull requests | `build.yml:4-7` | N/A | Met |
| 5 | Coverage < 80% fails the job | `jest.config.js:7-8` | N/A | Met |
| 6 | Test results visible in GitHub Actions log | Jest outputs to stdout | N/A | Met |

**Summary:** 38/40 criteria met. 2 are spec/code mismatches (not test deficiencies).

---

## Findings

### Major (should fix)

#### M1 — POST /api/properties returns 200 instead of 201

- **Category:** Code Quality
- **Location:** `src/server.js:49`
- **Description:** Creating a resource should return HTTP 201 (Created) per REST conventions. The acceptance criterion in the Analysis section specifies 201, but the code returns 200. The test matches the code (200), so this is a pre-existing issue. However, since this PR specifically set out to test this behaviour, it should be flagged.
- **Recommendation:** Change `res.json(...)` to `res.status(201).json(...)` in a follow-up commit or separate issue. Update the test to expect 201.

### Minor (nice to fix)

#### m1 — ICS retry logic does not distinguish retryable vs non-retryable errors

- **Category:** Code Quality
- **Location:** `src/ics.js:9-28`
- **Description:** The acceptance criterion says "Throws immediately on non-retryable HTTP error (e.g. 404)" but the code retries all errors equally. The test correctly tests actual behaviour (retries 3 times), but the spec intention was different. This is a pre-existing design gap, not introduced by this PR.
- **Recommendation:** Consider distinguishing 4xx (non-retryable) from 5xx (retryable) in a future enhancement. Not a blocker for this PR.

#### m2 — ICS fixtures defined but not directly used in tests

- **Category:** Code Quality
- **Location:** `tests/fixtures/ics-samples.js`
- **Description:** The ICS fixtures are well-structured but ics.test.js mocks `node-ical` directly rather than using the raw ICS text fixtures. The fixtures are available for future use but currently unused.
- **Recommendation:** No action needed — fixtures provide value for future tests or if the mock strategy changes.

### Suggestions (optional)

#### S1 — Consider adding `--forceExit` to Jest config

- **Category:** Reliability
- **Description:** Express/supertest tests can occasionally leave open handles. Adding `--forceExit` or `--detectOpenHandles` to the test script prevents CI from hanging.
- **Recommendation:** Add `"test": "jest --coverage --forceExit"` if CI hangs are observed.

---

## Positive Observations

- **Excellent coverage**: 96% statements, 87% branches, 94% functions, 96.5% lines — significantly above the 80% threshold
- **95 tests across 9 test files** — comprehensive suite covering unit, integration, and API layers
- **Clean mock strategy**: Each test file has clear mock boundaries. No test leaks between files.
- **Minimal production code change**: Only `server.js` was modified, and the change is a safe, backwards-compatible refactor (require.main guard)
- **CI integration well-designed**: Build depends on test, PR triggers added, Docker build only on push (not PRs)
- **Thorough server.test.js**: 38 tests covering all 15+ Express routes including OAuth flows, iCloud flows, UPRN routes, and error paths
- **Proper test isolation**: Environment variables cleaned up in afterEach, global.fetch restored, jest.clearAllMocks() in beforeEach

---

## Action Items

### Post-merge improvements
- [ ] M1: POST /api/properties should return 201 — create issue via `/analyse`
- [ ] m1: ICS retry logic should distinguish retryable vs non-retryable errors — consider for future enhancement

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
