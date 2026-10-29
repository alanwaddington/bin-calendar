# PR #34 Review — Garden Waste opt-in per property (#33)

**Date:** 2026-10-29
**Author:** alanwaddington
**Branch:** feature/33-garden-waste-opt-in → main
**State:** Open

> This is a **full, updated** review superseding the review committed earlier on this branch (`9e120f8f`). It re-audits every changed file against the current HEAD (`1a375b4`), after all nine prior review-finding fix commits (C1, M1, M2, m1, m2, m3, m4, m5, S1, S2, S3) have landed.
>
> **Post-review update (2026-10-29):** per the user's instruction to fix every finding regardless of severity, **M1 (new)** and **m1 (new)** below are now fixed (commit `b8651ec`) and re-verified — see the `outcome` notes inline. **S1 (new)** was deliberately skipped per the user's own decision, since it's a refactor this same report recommended deferring until #35's generalization work begins (extracting an abstraction before that design exists risks the wrong shape).

---

## Summary

| Item | Result |
|------|--------|
| Overall Assessment | Pass ✅ (all findings from this pass resolved or deliberately deferred) |
| Risk Level | Low (was Medium — M1 (new) was the only Major) |
| Test Coverage | Adequate (97.44% stmts / 92.38% branch overall after the fix; 100% on every file this PR touches except `server.js` and `sync.js`, both >95%, uncovered lines are pre-existing/unrelated to #33) |
| Acceptance Criteria | 13 / 13 Met (all 13 formal criteria from #33's Analysis) |
| Lint | 0 errors / 0 warnings |

**Headline change since the last review pass:** all 9 previously-raised findings (1 Critical, 3 Major, 5 Minor, 3 Suggestion) are fixed and verified in code and tests. This pass found **one new Major finding**: a property that opts back **in** to Garden Waste after opting out did not have a combined-day event's full summary restored on its external calendar — it stayed silently stuck with the garden-waste segment missing. See **M1 (new)** below — **now fixed**.

---

## Issues Reviewed

### Issue Hierarchy
- #33 — Add per-property opt-in for Garden Waste collection (root; contains both the Analysis and Design sections inline — confirmed via GitHub's sub-issues API that #33 has no parent and no sub-issues, so this is the complete hierarchy)

---

## Changed Files Audit

### `src/migrations/006.sql` (+10 / -0)

| Property | Detail |
|----------|--------|
| Purpose | Adds `properties.garden_waste_opted_in` and `bin_types.is_garden_waste`, both `NOT NULL DEFAULT 0` |
| Issues | #33 |
| Criteria covered | AC2, AC3 (default opted-out for new and existing properties) |
| Quality | ✅ No issues — additive only, consistent with CLAUDE.md's "never modify existing migration files" |
| Test coverage | `tests/unit/db.test.js: initDb_migration006_addsGardenWasteOptedInToProperties`, `initDb_migration006_addsIsGardenWasteToBinTypes` |

### `src/migrations/007.sql` (+4 / -0)

| Property | Detail |
|----------|--------|
| Purpose | Adds `sync_results.events_deleted INTEGER NOT NULL DEFAULT 0` |
| Issues | #33 Task 5 |
| Criteria covered | "Deleted counts are recorded in sync_results so a run is auditable" |
| Quality | ✅ No issues |
| Test coverage | `tests/unit/db.test.js: initDb_migration007_addsEventsDeletedToSyncResults` |

### `src/migrations/008.sql` (+5 / -0, new — added as part of the m1 (new) fix)

| Property | Detail |
|----------|--------|
| Purpose | Adds `sync_results.events_updated INTEGER NOT NULL DEFAULT 0` |
| Issues | PR #34 review finding m1 (new) |
| Criteria covered | m1 (new)'s recommendation, implemented |
| Quality | ✅ No issues — additive only, follows the same pattern as 006/007 |
| Test coverage | `tests/unit/db.test.js: initDb_migration008_addsEventsUpdatedToSyncResults`; also manually round-tripped against a real migrated DB (not mocked) to confirm the 9-param `INSERT` binds correctly |

### `src/bin-types.js` (+68 / -0, new)

| Property | Detail |
|----------|--------|
| Purpose | Shared matching primitives moved out of `server.js`, plus new `isGardenWaste()`/`stripGardenWasteSegments()` so `sync.js` and `server.js` share one definition of "matches" |
| Issues | #33 Task 2, PR #34 review finding C1 |
| Criteria covered | Design Decision 1 (shared module); C1's `matchesOutsideParentheses` blank-guard |
| Quality | ✅ No issues. `matchesOutsideParentheses('', matchText)` early-return is good defense in depth, independently verified against the raw app at `/verify` time. |
| Test coverage | `tests/unit/bin-types.test.js` — 100% stmt/branch/func/line coverage, includes the blank-matcher regression case |

### `src/server.js` (+57 / -43)

| Property | Detail |
|----------|--------|
| Purpose | Imports primitives from `bin-types.js`; adds `is_garden_waste`/`garden_waste_opted_in` to both display queries + `excludeOptedOutGardenWaste()` filter; accepts/returns the flags on `properties` and `bin-types` endpoints; `sanitiseBinTypeInput` rejects a Match that strips to nothing (C1 fix) |
| Issues | #33 Tasks 1, 3; PR #34 review finding C1 |
| Criteria covered | AC1, AC2, AC5, AC6, AC7, AC12, AC13 |
| Quality | ✅ No new issues. `excludeOptedOutGardenWaste()` runs before the nearest-date selection in `/api/next-collection` (line 440, before line 456), which is exactly what AC7 requires and is independently verified at runtime (see **Runtime verification** below). |
| Test coverage | `tests/api/server.test.js`, `tests/unit/calendar-events.test.js` — extensive, including the nearest-date-advance and combined-day cases |

### `src/sync.js` (+98 / -15)

| Property | Detail |
|----------|--------|
| Purpose | Classifies feed events via the shared primitives; gates push on `garden_waste_opted_in`; deletes already-pushed pure-garden-waste events on opt-out; strips/rewrites combined-day summaries in **either direction** (opt-out strip, opt-in restore — M1 (new) fix); records `events_deleted`/`events_updated`; queries `bin_types` once per run (S2 fix); `writeResult` takes an options object (S1 fix) |
| Issues | #33 Tasks 5, 6; PR #34 review findings M1, M2, S1, S2, M1 (new), m1 (new) |
| Criteria covered | AC4, AC8, AC9, AC10, AC12, AC13 |
| Quality | ✅ Fixed. The combined-day branch (now a single unified block, no longer split by opt-in direction) compares the remote summary against whichever text it *should* currently have — `event.summary` when opted in, `strippedSummary` when opted out — and rewrites only on a mismatch, regardless of which direction the property last transitioned. A genuine rewrite is now counted via the new `events_updated` counter instead of `events_added`. |
| Test coverage | `tests/integration/sync.test.js` (1070+ lines) — now includes the opt-out→sync→opt-in→sync restoration case for both providers, the "already restored, don't re-write" guard, and explicit `events_updated` vs `events_added` count assertions for both directions |

### `src/google.js` (+69 / -8)

| Property | Detail |
|----------|--------|
| Purpose | New `deleteEvent()`, `updateEventSummary()`; `listEvents()` now paginates via `nextPageToken` (m5 fix) |
| Issues | #33 Task 4; PR #34 review findings M1, m2, m5 |
| Criteria covered | Design's delete-capability requirement; M1 (Google combined-day rewrite); m5 (pagination correctness for deletion) |
| Quality | ✅ No issues. Error boundaries correctly scoped to just the mutating call (matches `deleteEvent`'s established pattern), confirmed in my own review of the auth-propagation behaviour. |
| Test coverage | `tests/integration/google.test.js` — 100% on all four metrics; explicit pagination test with two pages |

### `src/icloud.js` (+81 / -10)

| Property | Detail |
|----------|--------|
| Purpose | New `deleteEvent()`, `updateEvent()`, `listEventObjects()` (preserving `url`/`etag`), `extractSummary()`; `updateEvent` now has error handling (m1 fix) |
| Issues | #33 Task 4, Task 6; PR #34 review findings m1, m2, m3 |
| Criteria covered | Design's delete-capability requirement; combined-day in-place rewrite |
| Quality | ✅ No issues. |
| Test coverage | `tests/integration/icloud.test.js` — 100% on all four metrics, including the no-parseable-UID branch (m3 fix) |

### `public/properties.js` (+123 / -6)

| Property | Detail |
|----------|--------|
| Purpose | Opt-in checkbox on property add/edit forms with "PAID ADD-ON" badge; off-switch warning modal with full ARIA/keyboard/focus support (m4 fix); `is_garden_waste` checkbox on Bin Types rows with hint text and inert-state warning banner (S3 fix) |
| Issues | #33 Task 7; PR #34 review findings m4, S3 |
| Criteria covered | AC1, AC11 |
| Quality | ✅ No issues. `escHtml`/`escAttr` used consistently for all user-supplied data (labels, colours, match text); static copy ("PAID ADD-ON", hint sentences) needs no escaping. Modal's Escape listener is correctly scoped and removed on every close path (cancel, confirm, Escape, backdrop) — verified live, no leak across repeated open/close cycles. |
| Test coverage | `tests/unit/properties-frontend.test.js` (392 lines) — thorough, including a11y attributes, focus management, and listener-leak-after-confirm |

### `public/logs.js` (+14 / -1)

| Property | Detail |
|----------|--------|
| Purpose | Renders `deleted: N` only when non-zero, styled in `var(--warning)` (M3 fix); renders `updated: N` only when non-zero, in neutral text colour (m1 (new) fix) |
| Issues | PR #34 review findings M3, m1 (new) |
| Criteria covered | "Deleted counts recorded so a run is auditable" — now also *visible*; same for a genuine combined-day rewrite, distinguished from an addition |
| Quality | ✅ No issues. `escLogHtml` used for the property label; numeric fields need no escaping. `updated` deliberately not styled in `--warning` like `deleted` — it's a benign in-place text correction, not a destructive action, so distinguishing it visually from `deleted` matters. |
| Test coverage | `tests/unit/logs-frontend.test.js` — covers non-zero, zero, and missing-column cases for both `deleted` and `updated`, plus both shown together |

### `public/style.css` (+33 / -0)

| Property | Detail |
|----------|--------|
| Purpose | `.badge-paid`, checkbox/`.checkbox-label` styling, `.modal-body`/`.modal-actions` |
| Issues | #33 Task 7 |
| Criteria covered | Visual support for AC1, AC11 |
| Quality | ✅ No issues — purely additive, no existing rules touched |
| Test coverage | N/A (visual) — manually verified in a real browser session per the PR description, and independently re-verified by me via headless Chromium screenshots at `/verify` time |

### `tests/helpers/browserDom.js` (+72 / -1), `tests/helpers/testDb.js` (+9 / -2)

| Property | Detail |
|----------|--------|
| Purpose | `createSettingsWindow`/`createLogsWindow`/`mockRouterFetch` for method-aware fetch mocking; `createTestDb` now reads the migrations directory dynamically instead of a hardcoded `['001','002','003']` list (fixes a real gap — it had already silently fallen behind 004/005) |
| Issues | #33 Task 7 |
| Criteria covered | Test infrastructure only |
| Quality | ✅ No issues — the `testDb.js` fix is a good catch independent of #33's own scope |
| Test coverage | N/A (test infra) |

### Test files

`tests/api/server.test.js` (+229), `tests/integration/sync.test.js` (+495), `tests/integration/google.test.js` (+124/-1), `tests/integration/icloud.test.js` (+168/-1), `tests/unit/bin-types.test.js` (+131, new), `tests/unit/calendar-events.test.js` (+65), `tests/unit/db.test.js` (+33), `tests/unit/logs-frontend.test.js` (+71, new), `tests/unit/properties-frontend.test.js` (+392, new)

All read in full. Naming follows the project's `MethodName_Scenario_ExpectedResult` convention consistently. Arrange-Act-Assert structure throughout. `jest.mock()` calls are hoisted to the top of every file. No test hits a real external API — Google/iCloud SDKs are fully mocked.

---

## Acceptance Criteria Verification

### #33 — Add per-property opt-in for Garden Waste collection

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| 1 | Property add/edit form has a Garden Waste opt-in control, labelled as a paid add-on, defaulting to off | `public/properties.js:332-338,681-687` | `properties-frontend.test.js: buildAddPropertyAccordion_rendersUncheckedGardenWasteControlLabelledAsPaidAddOn` | ✅ Met |
| 2 | New properties are created opted-out by default | `src/server.js:57-65` (`toBoolInt`) | `server.test.js: POST /api/properties without garden_waste_opted_in defaults to 0` | ✅ Met |
| 3 | Existing properties are opted-out by default after the migration runs | `src/migrations/006.sql` | `db.test.js: initDb_migration006_addsGardenWasteOptedInToProperties` | ✅ Met |
| 4 | A Garden Waste event is present in the local `events` cache regardless of opt-in status | `src/sync.js:193` (`cacheEvents` runs unconditionally) | `sync.test.js: runSync_gardenWasteOptedOut_stillCachesTheGardenWasteEventDespiteNotPushingIt` | ✅ Met |
| 5 | `GET /api/properties/:id/events` excludes Garden Waste rows for an opted-out property | `src/server.js:188-190,260` (`excludeOptedOutGardenWaste`) | `calendar-events.test.js: getPropertyEventsRows_gardenWasteOptedOut_excludesGardenWasteRow` | ✅ Met |
| 6 | `GET /api/properties/:id/events` includes Garden Waste rows for an opted-in property | same | `calendar-events.test.js: getPropertyEventsRows_gardenWasteOptedIn_includesGardenWasteRow` | ✅ Met |
| 7 | `GET /api/next-collection` excludes Garden Waste rows for opted-out, without suppressing a non-Garden collection on the nearest date | `src/server.js:440` (filter runs before line 456's nearest-date selection) | `server.test.js: getNextCollection_gardenWasteOptedOutIsOnlyRowOnNearestDate_advancesToLaterNonGardenDate` | ✅ Met |
| 8 | A sync run does not push Garden Waste events for an opted-out property | `src/sync.js:137-149` | `sync.test.js: runSync_gardenWasteOptedOut_doesNotPushPureGardenWasteEvent` | ✅ Met |
| 9 | A sync run pushes Garden Waste events for an opted-in property, including ones withheld during a prior opted-out period | `src/sync.js` (normal uid diff for pure garden-waste; unified combined-day block for the combined case) | `sync.test.js: runSync_gardenWasteOptedIn_pushesGardenWasteEventNotYetPresentExternally`; `runSync_gardenWasteOptedIn_alreadyPushedCombinedDayEventStillHasStrippedSummaryOnGoogle/OnIcloud_restoresOriginalSummary` | ✅ Met *(now also covers the combined-day restoration case — M1 (new) fixed)* |
| 10 | Opted-in→opted-out transition deletes previously-pushed Garden Waste events on the next sync | `src/sync.js:137-149` | `sync.test.js: runSync_gardenWasteOptedOut_deletesAlreadyPushedGardenWasteEventOnGoogle/OnIcloud` | ✅ Met |
| 11 | Switching opt-in off shows a confirmation/warning before saving | `public/properties.js:383-392,423-463` | `properties-frontend.test.js: savePropertyEdit_turningGardenWasteOff_showsWarningModalAndDoesNotSaveYet` | ✅ Met |
| 12 | Combined day: opted-out property still sees/receives the non-Garden-Waste portion | `src/server.js` (display fan-out) + `src/sync.js:151-181` (push strip) | `calendar-events.test.js` + `sync.test.js` combined-day tests | ✅ Met |
| 13 | Non-Garden-Waste collection types are completely unaffected (regression) | throughout | `calendar-events.test.js: getPropertyEventsRows_nonGardenWasteBinType_unaffectedByOptedOutStatus`; `sync.test.js: runSync_gardenWasteOptedOut_neverDeletesNonGardenWasteEvents` | ✅ Met |

**Summary:** 13/13 criteria met, as literally worded. One related Major finding fell outside the literal wording of AC9 but represented a real gap in the same opt-in-reversal behaviour the criterion is checking — now fixed (see M1 (new) below).

---

## Findings

### Major (should fix)

#### M1 (new) — Re-opting in does not restore a combined-day event's full summary on the external calendar

- **Outcome:** ✅ Fixed (commit `b8651ec`)
- **Category:** Reliability / Correctness
- **Location:** `src/sync.js` (was lines 183-189; the combined-day branch is now unified, see below)
- **Description:** When a property opts out, a combined-day event (e.g. `"Garden waste and general waste+food (...)"`) is correctly rewritten in place with its garden segment stripped (`src/sync.js:151-181`, via `google.updateEventSummary`/`icloud.updateEvent`). But when that property later opts back **in**, the loop's opted-in branch had no equivalent check — `isCombinedWithGardenWaste` was only consulted inside the `!property.garden_waste_opted_in` guard, so for an opted-in property execution fell straight through to the generic diff: `if (existingByUid.has(event.uid)) { skipped++; continue; }`. Since the combined event's uid was still present externally (updated, never deleted), it was marked `skipped` and the stale stripped summary was left on the user's real calendar permanently.
  This directly undermined the reversibility AC9 is checking for ("pushes Garden Waste events... including ones withheld during a prior opted-out period") — it just happened that AC9's own test only exercised a *pure* garden-waste event (never pushed at all, hence naturally caught by the uid diff), not the combined-day case where the uid was never removed, just rewritten.
- **Fix applied:** The combined-garden-waste branch now runs unconditionally (not gated on opt-in state) and computes a single `targetSummary` — `event.summary` (the full original) when opted in, `strippedSummary` when opted out. Whenever the event already exists externally, its current remote summary is compared against `targetSummary` and rewritten only on a mismatch, using the same `updateEventSummary`/`updateEvent` calls either direction already used. This is a strict generalization of the existing opt-out logic (M2's "compare before writing" pattern), not new machinery — the opt-out behaviour is byte-for-byte unchanged (verified: all pre-existing opt-out combined-day tests pass unmodified).
- **New tests:** `runSync_gardenWasteOptedIn_alreadyPushedCombinedDayEventStillHasStrippedSummaryOnGoogle_restoresOriginalSummary`, `...OnIcloud_restoresOriginalSummary`, and `runSync_gardenWasteOptedIn_combinedDayAlreadyHasOriginalSummary_doesNotReWriteAgain` (the symmetric "don't re-write if already correct" guard for the opt-in direction).

### Minor (nice to fix)

#### m1 (new) — A genuine combined-day rewrite is counted as `added`, not a distinct `updated`

- **Outcome:** ✅ Fixed (commit `b8651ec`)
- **Category:** Code Quality / Observability
- **Location:** `src/sync.js`, `src/migrations/008.sql`, `public/logs.js`
- **Description:** The previous review's M2 offered two alternatives for the "miscounted as added" complaint: (a) skip a no-op rewrite (compare-before-write), or (b) introduce a distinct `updated` counter. The fix implemented (a), which correctly solved the dominant complaint (perpetual `events_added: 1` on every single run for a stable property). But the one genuine rewrite that *does* happen — the first sync after a property transitions state with a pre-existing combined-day event — was still counted via `added++` rather than a distinct category.
- **Fix applied:** Per the user's explicit decision to do the full schema fix rather than leave this noted-but-unfixed: added migration `008.sql` (`sync_results.events_updated`), threaded a new `updated` parameter through `writeResult`, and both directions of the combined-day rewrite (opt-out strip, opt-in restore) now increment `updated` instead of `added`. `public/logs.js` renders `updated: N` only when non-zero, in the neutral text colour (not `--warning`, since this is an expected, benign correction — not a destructive action like `deleted`).
- **New tests:** `runSync_gardenWasteOptedOut_combinedDayRewrite_isCountedAsEventsUpdatedNotEventsAdded`, `runSync_gardenWasteOptedIn_combinedDayRestore_isCountedAsEventsUpdatedNotEventsAdded`, `runSync_recordsUpdatedCountInSyncResults_includesEventsUpdatedColumnInInsertSql`, `initDb_migration008_addsEventsUpdatedToSyncResults`, and four new `logs-frontend.test.js` cases (non-zero, zero, missing-column, shown-alongside-deleted).

### Suggestions (optional)

#### S1 (new) — `syncProperty` is a single ~115-line function handling five distinct classification branches

- **Outcome:** ⏭️ Skipped — deliberate, per the user's explicit decision
- **Category:** Code Quality
- **Location:** `src/sync.js`
- **Description:** The function carries: no-ICS-URL handling, empty-feed handling, pure-garden-waste opted-out (delete), combined-garden-waste (now unified across both opt-in directions — see M1 (new)), and the generic non-garden path. Each branch is individually well-commented and tested, but the function as a whole is getting hard to hold in your head in one pass — a future bin-type-level generalisation (per the follow-up issue already filed as #35) will likely need to touch most of these branches again.
- **Why skipped:** This finding's own recommendation explicitly deferred the extraction until "#35's generalization work begins" — doing it now, before #35 has a design, risks building an abstraction shaped by guesswork rather than #35's actual requirements (which will need to multiply this branching across every opt-in-required bin type, not just Garden Waste). The user confirmed skipping it for now when asked directly. Note: the M1 (new) fix above already *reduces* this function's branch count by one (the combined-day opt-out/opt-in cases are now a single unified block instead of two near-duplicates), so the complexity concern is marginally better than when this finding was first raised, not worse.

---

## Positive Observations

- All nine findings from the prior review pass are genuinely fixed, not just marked done — I independently re-verified C1, M1 (old), M2 (old), m1–m5, S1–S3 against the current code and, where user-facing, against the running app (headless Chromium): the blank-wildcard rejection, the off-switch modal's full keyboard/ARIA/focus behaviour across repeated open/close cycles, the Logs page's conditional `deleted: N` rendering, and the Bin Types inert-warning banner all behave exactly as each fix commit claims.
- `src/bin-types.js`'s extraction is a clean, zero-behaviour-change refactor — confirmed by the full pre-existing suite passing unmodified, and the new module sits at 100% coverage on all four metrics.
- The decision to classify Garden Waste against the **full in-memory feed** rather than the 6-month local cache (Design Decision 2) is correctly implemented and explicitly tested (`runSync_gardenWasteOptedOut_stillCachesTheGardenWasteEventDespiteNotPushingIt`) — an easy mistake to make that the team clearly thought through up front.
- `deleteEvent`/`updateEvent`/`updateEventSummary` across both providers consistently return `true`/`false` rather than throwing on a per-event failure, and `sync.js` only increments its audit counters on confirmed success — this is exactly the right error-isolation boundary for the one genuinely destructive code path in the app.
- Test naming and Arrange-Act-Assert structure are followed with unusual discipline across ~1,700 new lines of test code; several tests explicitly document the *real-world feed string* they're guarding against (e.g. the exact "+food only after transition week" caveat), which will make future regressions much easier to diagnose.
- `tests/helpers/testDb.js`'s fix (reading the migrations directory dynamically instead of a hardcoded list already two migrations stale) is a good, scoped catch that improves confidence in every other test file's real-DB coverage, not just this PR's own tests.

---

## Action Items

### Immediate Fixes (block merge)
- None — no Critical findings.

### Should fix before merge (team's call)
- [x] M1 (new): combined-day summary not restored on re-opt-in — fixed in commit `b8651ec`.

### Post-merge improvements
- [x] m1 (new): `events_updated` counter added — fixed in commit `b8651ec`.
- [ ] S1 (new): extract `syncProperty`'s per-event classification into a helper when #35's generalization work begins — deliberately not done now.

---

## Checklist

- [x] All acceptance criteria from the full issue hierarchy verified by reading actual code
- [x] Every changed file read and audited
- [x] Tests cover happy path, error paths, and edge cases (one gap found: combined-day re-opt-in restoration — see M1 new)
- [x] Lint run — zero errors introduced by this PR
- [x] No security vulnerabilities introduced
- [x] No performance regressions
- [x] Error handling complete and consistent
- [x] Logging adequate for debugging production issues
- [x] Code follows existing codebase conventions
- [x] No unnecessary changes outside scope of the issue
