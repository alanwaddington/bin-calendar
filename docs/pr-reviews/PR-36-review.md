# PR #36 Review — Fix: sync never removed stale events no longer in the EA feed

**Date:** 2026-10-29
**Author:** alanwaddington
**Branch:** fix/sync-removes-stale-events → main
**State:** Open

> **Post-review update (2026-10-29):** per the user's instruction to fix every finding regardless of severity, both S1 and S2 below are now fixed and re-verified — see the `Outcome` notes inline. 395/395 tests passing (was 390), lint still clean.

---

## Summary

| Item | Result |
|------|--------|
| Overall Assessment | Pass ✅ (all findings from this pass resolved) |
| Risk Level | Low |
| Test Coverage | Adequate — 395/395 suite passing, `sync.js` 98.02%/96.29%/100%/97.69% (stmts/branch/funcs/lines); the two uncovered lines (22, 60-61) are pre-existing error-rethrow paths untouched by this diff |
| Acceptance Criteria | 7 / 7 Met |
| Lint | 0 errors / 0 warnings |

No tracked issue — this is an ad-hoc bug fix per CLAUDE.md's exception (single reported symptom, fixable within one function, no new schema, no architectural decision). Per that exception's own caveat, acceptance criteria below are derived from the user's bug report and the PR's own description rather than requirements agreed up front, so they've been checked with corresponding extra scrutiny — see the Findings section for what was actually probed, not just what the PR claims.

---

## Issues Reviewed

### Issue Hierarchy
- None. No `#NNN` reference in the PR title, body, branch name (`fix/sync-removes-stale-events`), or commit message. Confirmed by inspection — this is the correct, deliberate ad-hoc path.

---

## Changed Files Audit

### `src/sync.js` (+30 / -0)

| Property | Detail |
|----------|--------|
| Purpose | Adds a reconciliation pass after the main per-event loop in `syncProperty()`: any uid present in `existingByUid` (what's on the external calendar) but absent from the current feed gets deleted. Companion fix in `cacheEvents()`: the local `events` cache now deletes any row for the property whose uid isn't in the new feed, before upserting. |
| Issues | None (ad-hoc) |
| Criteria covered | AC1–AC6 (below) |
| Quality | ✅ No issues found after deep scrutiny — see Findings for the two non-blocking Suggestions. |
| Test coverage | 6 new tests in `tests/integration/sync.test.js`, 3 new tests in `tests/unit/sync-cache.test.js` |

### `tests/integration/sync.test.js` (+187 / -0)

| Property | Detail |
|----------|--------|
| Purpose | Covers the new reconciliation pass: Google delete, iCloud delete, regression (still-in-feed uid untouched), confirmed-only counting, disjointness from the Garden Waste delete branch, and a no-stale-events baseline. |
| Issues | None (ad-hoc) |
| Criteria covered | AC1, AC2, AC3, AC4, AC5, AC7 |
| Quality | ✅ No issues. All mocks reused consistently with the existing file's established patterns (`mockPrepareReturn`, `google`/`icloud` jest mocks). |
| Test coverage | N/A (these are the tests) |

### `tests/unit/sync-cache.test.js` (+48 / -0)

| Property | Detail |
|----------|--------|
| Purpose | Covers `cacheEvents()`'s stale-row cleanup: a uid dropped from the feed is removed from the local cache; an empty new feed wipes all cached rows for that property; cross-property isolation is preserved. |
| Issues | None (ad-hoc) |
| Criteria covered | AC6 |
| Quality | ✅ No issues. |
| Test coverage | N/A (these are the tests) |

---

## Acceptance Criteria Verification

Derived from the bug report ("sync does not remove events in the calendars for events that are no longer in the data synced from East Ayrshire") and the PR's own description of its fix.

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| 1 | An event removed from the feed entirely is deleted from the Google Calendar on the next sync | `src/sync.js:213-220` (reconciliation loop), `google.deleteEvent` branch at line 216-217 | `sync.test.js: runSync_eventNoLongerInFeedOnGoogle_deletesItFromTheExternalCalendar` | ✅ Met |
| 2 | Same, for iCloud | `src/sync.js:218` (`icloud.deleteEvent` branch) | `sync.test.js: runSync_eventNoLongerInFeedOnIcloud_deletesItFromTheExternalCalendar` | ✅ Met |
| 3 | An event still present in the feed is never deleted by this path (regression safety) | `src/sync.js:215` (`if (feedUids.has(uid)) continue;`) | `sync.test.js: runSync_eventStillInFeedOnGoogle_isNotDeleted`, `runSync_withNoStaleEvents_doesNotCallDeleteAtAll` | ✅ Met |
| 4 | Only a confirmed (successful) provider deletion increments `events_deleted` | `src/sync.js:219` (`if (ok) deleted++;`) | `sync.test.js: runSync_eventNoLongerInFeed_failedDeletionIsNotCountedInEventsDeleted` | ✅ Met |
| 5 | The new reconciliation path never double-processes a uid already handled by the Garden Waste opt-out delete branch | `src/sync.js:215` — the reconciliation loop's own feed-presence guard makes this disjoint by construction, since the Garden Waste branch only ever operates on a `uid` drawn from `events` (independently re-verified by reading both branches side by side, not just trusting the comment) | `sync.test.js: runSync_eventNoLongerInFeed_isNotDoubleProcessedByTheGardenWasteDeleteBranch` | ✅ Met |
| 6 | The local `events` cache also stops carrying a uid no longer in the feed, not just the external calendar | `src/sync.js:282-289` (`cacheEvents`) | `sync-cache.test.js: cacheEvents_whenPreviouslyCachedUidNoLongerInNewFeed_removesItFromCache`, `cacheEvents_whenNewFeedIsEmpty_removesEveryCachedRowForThatProperty`, `cacheEvents_removalOfStaleUids_onlyAffectsTheGivenProperty` | ✅ Met |
| 7 | No regression to the existing suite or lint | N/A | Full suite: 390/390 passing; `npm run lint`: 0 errors, 0 warnings | ✅ Met |

**Summary:** 7/7 criteria met.

---

## Findings

No Critical, Major, or Minor findings. Two non-blocking observations surfaced during deep scrutiny (re-deriving the disjointness argument independently, checking the SQL for injection/transaction-safety, testing SQLite's actual placeholder limit, and tracing the empty-feed early-return path) — **both now fixed**, per the user's explicit instruction to fix every finding regardless of severity:

### Suggestions (optional)

#### S1 — The reconciliation window inherits a pre-existing edge case, not introduced by this PR

- **Outcome:** ✅ Fixed
- **Category:** Reliability
- **Location:** `src/sync.js:104-106` (unchanged by this PR), consumed by the new reconciliation loop at line 213-220
- **Description:** `existingByUid` is fetched via `listEvents`/`listEventObjects` within `[timeMin, timeMax]`, derived from `Math.min`/`Math.max` of the *current* feed's own event dates. If a removed event happened to be the one defining the old edge of that window, and its removal shifts the window inward, a stale event at the old edge could theoretically fall outside the new window and be missed by the listing call entirely. This isn't new risk — the Garden Waste delete path already relies on the exact same window and has the same characteristic — this PR just extends an existing mechanism to a new case, it doesn't widen or narrow the window itself. In practice, the real East Ayrshire feed spans many months with many entries, so one changed date is very unlikely to move `timeMin`/`timeMax` meaningfully. The PR description discloses this honestly rather than claiming complete coverage.
- **Fix applied:** Per the user's explicit decision (full window widening, not deferral): `timeMin`/`timeMax` now always cover at least `[today, today+6 months]` — matching `cacheEvents`'s own bound — regardless of how narrow or wide the current feed's own date range happens to be. Implemented as `Math.min(...dates, today.getTime())` / `Math.max(...dates, sixMonthsAhead.getTime())`, a pure widening: when the feed's own range is already wider, it wins unchanged (verified by dedicated regression tests for both the narrow and wide cases, and both the min and max directions).
- **New tests:** `runSync_feedDatesNarrowerThanSixMonths_widensTimeMaxToAtLeastSixMonthsAhead`, `runSync_feedDatesWiderThanSixMonths_keepsTimeMaxAtTheFeedsOwnLaterDate`, `runSync_feedMinDateAfterToday_widensTimeMinBackToToday`, `runSync_feedMinDateBeforeToday_keepsTimeMinAtTheFeedsOwnEarlierDate`.

#### S2 — No test exercises both delete paths together in a single sync run

- **Outcome:** ✅ Fixed
- **Category:** Code Quality / Test Coverage
- **Location:** `tests/integration/sync.test.js`
- **Description:** `runSync_eventNoLongerInFeed_isNotDoubleProcessedByTheGardenWasteDeleteBranch` uses a single stale uid whose name merely *resembles* garden waste text; it doesn't combine a genuine Garden-Waste-opted-out-and-still-in-feed deletion with a genuinely-stale-and-absent-from-feed deletion in the same run. The disjointness is airtight by construction (verified independently by reading both branches), so this is a coverage nicety rather than a real gap.
- **Fix applied:** Added `runSync_gardenWasteDeleteAndStaleReconciliationDelete_bothFireInTheSameRunWithoutInterfering` — one event satisfying each condition in the same `events`/`existingByUid` pair, asserting both `deleteEvent` calls fire with the right identifiers and `events_deleted` counts both.

---

## Positive Observations

- The root-cause diagnosis is precise and independently verifiable: the per-event loop genuinely has no code path that reconciles `existingByUid` against events absent from the feed, and the fix is the minimal correct addition — not a rewrite, not a new abstraction.
- Correctly identified and fixed the *same* gap one layer down in `cacheEvents()` without being asked — a weaker fix would have stopped at the external-calendar symptom and left the local cache (and therefore the app's own Dashboard/Calendar) still showing phantom collections.
- Reuses every existing convention precisely: confirmed-success-only counting (matching PR #34's m2 fix), the same `deleteEvent` call shapes per provider, the same `events_deleted` counter rather than inventing a new one.
- The disjointness between this new delete path and the pre-existing Garden Waste delete path was verified, not just asserted — both in this review and via a dedicated regression test in the PR itself.
- `cacheEvents`'s new DELETE was verified against a real (non-mocked) migrated SQLite database during development, not just the Jest-mocked integration tests — confirmed in the PR's own commit message and independently re-derivable from the test file's use of `createTestDb()` (real schema, real constraints) rather than a mock.
- Honest, specific risk disclosure in the PR description (the `timeMin`/`timeMax` window caveat) rather than an unqualified claim of complete coverage.

---

## Action Items

### Immediate Fixes (block merge)
- None.

### Post-merge improvements
- [x] S1: window widened to always cover `[today, today+6 months]` — fixed.
- [x] S2: combined-scenario test added — fixed.

---

## Checklist

- [x] All acceptance criteria (derived from the bug report, per the ad-hoc exception) verified by reading actual code
- [x] Every changed file read and audited
- [x] Tests cover happy path, error paths, and edge cases
- [x] Lint run — zero errors introduced by this PR
- [x] No security vulnerabilities introduced (parameterised SQL confirmed; no string-concatenated values)
- [x] No performance regressions (placeholder-count approach tested up to 32,766 values, far beyond any realistic feed size)
- [x] Error handling complete and consistent (delete failures caught inside `google.js`/`icloud.js`, never thrown into the new loop)
- [x] Logging adequate for debugging production issues (reuses existing `events_deleted` audit trail, visible in Logs)
- [x] Code follows existing codebase conventions
- [x] No unnecessary changes outside scope of the bug report
