# PR #34 Review — Garden Waste opt-in per property (#33)

**Date:** 2026-10-28
**Author:** alanwaddington
**Branch:** `feature/33-garden-waste-opt-in` → `main`
**State:** Open

---

## Summary

| Item | Result |
|------|--------|
| Overall Assessment | **Fail ❌** — one Critical finding (unbounded calendar deletion) must be fixed before merge |
| Risk Level | **High** — the feature's core new capability is irreversible deletion from the user's real external calendar |
| Test Coverage | Adequate overall (97.18% stmts / 91.79% branch, well above the 80% gate); two specific gaps identified |
| Acceptance Criteria | 12 Met / 1 Partially Met (13 total) |
| Lint | 0 errors / 0 warnings (0 in diff, 0 pre-existing) |

The feature is well-architected, cleanly decomposed across 7 commits, and the display-layer and UI halves are solid and independently verified against a running instance. The blocking problem is that the PR wires user-editable `bin_types.summary_match` values into a destructive deletion path without hardening an input-validation flaw that was previously only cosmetic.

---

## Issues Reviewed

### Issue Hierarchy

Flat — no parent, no sub-issues (confirmed via GraphQL `subIssues`).

- [#33 — Add per-property opt-in for Garden Waste collection](https://github.com/alanwaddington/bin-calendar/issues/33) (root; contains both `## Analysis` and `## Design` sections, 13 Analysis acceptance criteria + 7 per-task Design criteria sets)

---

## Changed Files Audit

### `src/migrations/006.sql` (+10 / -0)

| Property | Detail |
|----------|--------|
| Purpose | Adds `properties.garden_waste_opted_in` and `bin_types.is_garden_waste`, both `INTEGER NOT NULL DEFAULT 0` |
| Issues | #33 |
| Criteria covered | AC2, AC3 |
| Quality | ✅ Additive-only, append-only, matches project migration conventions. Default 0 satisfies "existing properties opted-out with no backfill" |
| Test coverage | `tests/unit/db.test.js:initDb_migration006_addsGardenWasteOptedInToProperties`, `…_addsIsGardenWasteToBinTypes` |

### `src/migrations/007.sql` (+4 / -0)

| Property | Detail |
|----------|--------|
| Purpose | Adds `sync_results.events_deleted` so a reconciling run is auditable |
| Issues | #33 (Design Task 5 AC) |
| Criteria covered | Design Task 5 — "deleted counts recorded in `sync_results`" |
| Quality | ✅ Additive. Note: this file was **not** in the Design's Task 5 file list; adding it was a justified deviation (the AC demands it) and is called out in the commit message |
| Test coverage | `tests/unit/db.test.js:initDb_migration007_addsEventsDeletedToSyncResults` |

### `src/bin-types.js` (+57 / -0, new)

| Property | Detail |
|----------|--------|
| Purpose | Shared matching primitives extracted from `server.js` (`stripParentheticals`, `matchesOutsideParentheses`, `splitSummarySegments`) plus new `isGardenWaste()` / `stripGardenWasteSegments()` |
| Issues | #33 (Design Task 2) |
| Criteria covered | Underpins AC5–AC10, AC12 |
| Quality | ⚠️ **See C1.** `matchesOutsideParentheses(summary, '')` returns `true` for every input (`String.includes('')`), so a single blank matcher makes every event classify as Garden Waste. No guard against blank/whitespace matchers. Otherwise excellent: pure functions, no I/O, 100% covered, and the `isGarden &&` guard in `sync.js` correctly prevents the `' and '` re-join from normalising whitespace on non-garden summaries |
| Test coverage | `tests/unit/bin-types.test.js` — 16 tests, 100% stmts/branch/funcs/lines. **No test covers an empty or whitespace-only matcher** |

### `src/server.js` (+50 / -43)

| Property | Detail |
|----------|--------|
| Purpose | Imports primitives from `bin-types.js` instead of defining them; adds `toBoolInt()`; plumbs both flags through `GET`/`POST`/`PUT /api/properties` and `sanitiseBinTypeInput` + bin-types `POST`/`PUT`; adds `excludeOptedOutGardenWaste()` and applies it in `getPropertyEventsRows` and `/api/next-collection` |
| Issues | #33 (Design Tasks 1, 2, 3) |
| Criteria covered | AC1, AC2, AC5, AC6, AC7, AC12 |
| Quality | ⚠️ **See C1** — `sanitiseBinTypeInput` validates `!summary_match` *before* `.replace(/[%_]/g, '')`, so a Match of `"%"` passes validation and is persisted as `""`. Otherwise strong: `toBoolInt` correctly handles the `"false"` string footgun; `excludeOptedOutGardenWaste` runs *before* the nearest-date selection in `next-collection` (the subtle ordering the AC demands); strict `=== 1`/`=== 0` correctly leaves `NULL` (unmatched LEFT JOIN) rows alone; all queries parameterised |
| Test coverage | `tests/api/server.test.js` (+187) — endpoint round-trips, defaulting, `"false"` coercion, SQL-shape assertions, next-collection filtering incl. nearest-date interaction |

### `src/sync.js` (+74 / -13)

| Property | Detail |
|----------|--------|
| Purpose | Loads garden matchers, classifies in-memory feed events as pure-garden / combined / non-garden, gates push, reconciles deletions, strips combined-day summaries, records `deleted` count |
| Issues | #33 (Design Tasks 5, 6) |
| Criteria covered | AC4, AC8, AC9, AC10, AC12, AC13 |
| Quality | ⚠️ **See C1, M2, m1, m2.** Decision 2 is correctly implemented — classification runs on the in-memory `events` array (full feed range), not the 6-month cache, and `cacheEvents` is untouched. Deletion is correctly scoped to UIDs that are both (a) from this property's own feed and (b) pure garden waste. But: the iCloud combined-day `updateEvent` fires on **every** sync with no comparison against current remote state; it is counted as `added`; and `deleted++` increments even when the underlying delete silently failed |
| Test coverage | `tests/integration/sync.test.js` (+331) — 11 new tests across both providers, both opt-in states, combined-day paths. ⚠️ Line 157 (iCloud combined-day **first** push) uncovered |

### `src/google.js` (+17 / -1)

| Property | Detail |
|----------|--------|
| Purpose | New `deleteEvent(property, googleEventId)` via `calendar.events.delete` |
| Issues | #33 (Design Task 4) |
| Criteria covered | AC10 |
| Quality | ✅ Good separation: only the delete call is wrapped in try/catch, so auth failures still propagate to `syncProperty`'s `isAuthError` handling. ⚠️ See **m5** — `listEvents` (which feeds `existingByUid`) remains unpaginated with Google's default 250-result cap, which this PR newly makes a *correctness* concern for deletion |
| Test coverage | `tests/integration/google.test.js` — `deleteEvent_callsCalendarEventsDeleteWithCalendarIdAndEventId`, `deleteEvent_whenApiCallRejects_doesNotThrow` |

### `src/icloud.js` (+50 / -10)

| Property | Detail |
|----------|--------|
| Purpose | New `listEventObjects()` (Map<uid, davObject> preserving url/etag), `updateEvent()` via `updateCalendarObject`, `deleteEvent()` via `deleteCalendarObject`; `buildVCalendarString()` extracted; `listEventUids()` re-expressed in terms of `listEventObjects()` |
| Issues | #33 (Design Tasks 4, 6) |
| Criteria covered | AC10, AC12 |
| Quality | ⚠️ See **m1** — `deleteEvent` swallows errors but `updateEvent` does not, so a transient CalDAV failure on the combined-day update aborts the whole property's sync. The `listEventUids` re-expression is clean and preserves existing caller behaviour exactly |
| Test coverage | `tests/integration/icloud.test.js` (+81) — listEventObjects/url+etag preservation, listEventUids regression, deleteEvent args + rejection handling, updateEvent args. ⚠️ `icloud.js:38` (`if (match)` false branch) uncovered |

### `public/properties.js` (+78 / -6)

| Property | Detail |
|----------|--------|
| Purpose | Garden Waste checkbox + PAID ADD-ON badge on property add/edit forms; `performPropertySave()` extracted; `showGardenWasteOffWarning()` modal; `is_garden_waste` column/checkbox on bin types; both flags plumbed into the API calls |
| Issues | #33 (Design Task 7) |
| Criteria covered | AC1, AC11 |
| Quality | ✅ No new XSS surface — all new markup is static or boolean-driven; no user data interpolated into the new HTML. Existing `escHtml`/`escAttr` reused, not duplicated. The opted-in→opted-out detection correctly reads the *last loaded* `_settingsProperties` value rather than trusting the DOM. ⚠️ See **m4** (modal a11y) |
| Test coverage | `tests/unit/properties-frontend.test.js` (+209, new) — 9 tests covering render, defaults, persistence, modal appearance, cancel-restores-and-saves-nothing, confirm-saves-false, bin-type flag round-trips |

### `public/style.css` (+33 / -0)

| Property | Detail |
|----------|--------|
| Purpose | `input[type="checkbox"]` reset (the global `input` rule would otherwise stretch it full-width), `.checkbox-label`, `.badge-paid` modifier, `.modal-body`, `.modal-actions` |
| Issues | #33 (Design Task 7) |
| Criteria covered | AC1, AC11 |
| Quality | ✅ Extends the existing `.badge-*` family rather than inventing a parallel component; uses existing design tokens throughout; activates the previously-dead `.modal-overlay`/`.modal`/`.modal-title` block instead of duplicating it |
| Test coverage | n/a (CSS) — visual behaviour confirmed by live browser verification |

### `tests/helpers/browserDom.js` (+50 / -1)

| Property | Detail |
|----------|--------|
| Purpose | New `createSettingsWindow()` and `mockRouterFetch()` (method-aware, body-capturing); forces `window.CONFIG` after evaluating `app.js` |
| Issues | #33 (Design Task 7 testing) |
| Quality | ✅ The `window.CONFIG` bridge is correctly a *test-harness* fix, not a production change — `app.js` declares `let CONFIG`, which never becomes a global-object property and so is invisible across jsdom's separate `window.eval()` calls, unlike a real browser where all `<script>` tags share one global scope. `properties.js` is the first file to read `CONFIG`, which is why this never surfaced before. Well-commented |
| Test coverage | Exercised by the new frontend test file |

### `tests/helpers/testDb.js` (+9 / -2)

| Property | Detail |
|----------|--------|
| Purpose | Reads all migration files dynamically instead of a hardcoded `['001','002','003']` list |
| Issues | #33 (incidental fix) |
| Quality | ✅ Genuine latent-bug fix — the helper had already silently fallen behind 004/005 before this PR. Now mirrors `db.js`'s own logic |
| Test coverage | Implicitly exercised by every real-DB test file |

### Test files (`tests/api/server.test.js` +187, `tests/integration/sync.test.js` +331, `tests/integration/google.test.js` +28, `tests/integration/icloud.test.js` +81, `tests/unit/bin-types.test.js` +90, `tests/unit/calendar-events.test.js` +65, `tests/unit/db.test.js` +33, `tests/unit/properties-frontend.test.js` +209)

| Property | Detail |
|----------|--------|
| Purpose | 56 new tests across migration, API, display-filtering, provider, sync-orchestration and frontend layers |
| Quality | ✅ Consistently follow the project's `MethodName_Scenario_ExpectedResult` convention and Arrange-Act-Assert. Comments explain *why* each case exists, often citing the real feed data behind it. All external deps mocked. ⚠️ Gaps noted in **m3**; no test exercises a blank matcher (**C1**) |

---

## Acceptance Criteria Verification

### #33 — Analysis section (13 criteria)

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| 1 | Property add/edit form has a Garden Waste opt-in control, clearly labelled as a paid add-on, defaulting to off | `public/properties.js:327-335` (edit), `:600-608` (add); `public/style.css` `.badge-paid` | `properties-frontend.test.js:buildAddPropertyAccordion_rendersUncheckedGardenWasteControlLabelledAsPaidAddOn`, `buildPropertyAccordion_optedInProperty_rendersCheckedGardenWasteControl` | ✅ Met |
| 2 | New properties are created opted-out by default | `src/server.js:56-64` (`toBoolInt(undefined) → 0`) | `server.test.js:POST /api/properties without garden_waste_opted_in defaults to 0` | ✅ Met |
| 3 | Existing properties opted-out by default after migration (no manual fix-up) | `src/migrations/006.sql:6` (`NOT NULL DEFAULT 0`) | `db.test.js:initDb_migration006_addsGardenWasteOptedInToProperties` | ✅ Met |
| 4 | Garden Waste event present in local `events` cache regardless of opt-in status | `src/sync.js:174` — `cacheEvents` called unconditionally with the full `events` array | `sync.test.js:runSync_gardenWasteOptedOut_stillCachesTheGardenWasteEventDespiteNotPushingIt` | ✅ Met |
| 5 | `GET /api/properties/:id/events` excludes Garden Waste rows for an opted-out property | `src/server.js:240-250` + `excludeOptedOutGardenWaste` | `calendar-events.test.js:getPropertyEventsRows_gardenWasteOptedOut_excludesGardenWasteRow` | ✅ Met (also confirmed live) |
| 6 | …includes Garden Waste rows for an opted-in property | same | `calendar-events.test.js:…_gardenWasteOptedIn_includesGardenWasteRow` | ✅ Met (also confirmed live) |
| 7 | `GET /api/next-collection` excludes for opted-out **and** an excluded row must not cause "no collection" when a non-garden collection exists for the nearest date | `src/server.js:406-432` — filter applied before the `expanded[0].date` selection | `server.test.js:getNextCollection_gardenWasteOptedOut_excludesGardenWasteRow`, `…OnCombinedDay_stillShowsTheNonGardenWasteRowForThatDate`, `…IsOnlyRowOnNearestDate_advancesToLaterNonGardenDate` | ✅ Met (also confirmed live) |
| 8 | A sync run does not push Garden Waste events for an opted-out property | `src/sync.js:122-133` | `sync.test.js:runSync_gardenWasteOptedOut_doesNotPushPureGardenWasteEvent` | ✅ Met (mocked only — see Note A) |
| 9 | A sync run pushes Garden Waste for an opted-in property, including events withheld during a prior opted-out period | `src/sync.js:164-170` (falls through to the existing uid diff) | `sync.test.js:runSync_gardenWasteOptedIn_pushesGardenWasteEventNotYetPresentExternally` | ✅ Met (see Note B) |
| 10 | Opted-in → opted-out: a subsequent sync deletes previously-pushed Garden Waste events | `src/sync.js:123-131`; `google.js:102-110`; `icloud.js:93-101` | `sync.test.js:…_deletesAlreadyPushedGardenWasteEventOnGoogle` / `…OnIcloud`; provider-level tests in `google.test.js` / `icloud.test.js` | ✅ Met (mocked only — see Note A) |
| 11 | Switching opt-in on→off warns the user before the change is saved | `public/properties.js:383-396` (`savePropertyEdit` gate), `:417-447` (`showGardenWasteOffWarning`) | `properties-frontend.test.js:savePropertyEdit_turningGardenWasteOff_showsWarningModalAndDoesNotSaveYet`, `gardenWasteOffWarning_cancel_reChecksTheBoxAndNeverSaves`, `…_confirm_savesWithGardenWasteOptedInFalse` | ✅ Met (also confirmed live) |
| 12 | On a combined day, an opted-out property still sees/receives the non-Garden-Waste portion | Display: `src/server.js` fan-out + row filter. Push: `src/sync.js:135-162` | `calendar-events.test.js:…OnCombinedDay_stillReturnsTheNonGardenWasteHalf`; `sync.test.js:…newCombinedDayEvent_pushesWithGardenWasteSegmentStripped`, `…alreadyPushedCombinedDayEventOnIcloud_updatesInPlaceWithStrippedSummary` | ✅ Met — with the documented Google limitation (**M1**) |
| 13 | Every non-Garden-Waste collection type's display and sync behaviour is unchanged (regression check) | Full suite green; live verification | 326 tests pass; `tests/unit/attribute-summary-segment.test.js` and `calendar-events.test.js` pass unmodified as the Task 2 refactor proof | ⚠️ **Partially Met** — holds for all valid configurations, but **C1** shows a reachable configuration in which *every* non-garden event is silently withheld from push and deleted externally |

**Note A:** AC8 and AC10 are verified only through mocked integration tests. The sync push/delete path was not exercised against live Google/iCloud APIs (no credentials or outbound access available in the review environment). Given these are the PR's only irreversible operations, a manual smoke test against a throwaway calendar before the first production sync is strongly recommended.

**Note B:** AC9's parenthetical specifies the full `opt out → sync → opt in → sync` sequence. No single test performs that multi-run sequence; it is covered compositionally (the "not pushed while opted out" and "pushed when opted in and absent externally" states are each tested, and the mechanism between them is the pre-existing uid diff). Acceptable, but a single end-to-end transition test would close the gap cheaply.

### #33 — Design section, per-task criteria

| Task | Criteria | Verdict |
|------|----------|---------|
| 1 — Migration + API plumbing | Both columns default 0; `GET` returns flag; `POST`/`PUT` accept and persist; omitting on `PUT` preserves; invalid values coerce without 500 | ✅ All met (`server.test.js`, 11 tests) |
| 2 — Extract primitives | `server.js` behaviour provably unchanged; `isGardenWaste` true for pure + combined, false for the parenthetical caveat; `stripGardenWasteSegments` returns the non-garden half / `''` | ✅ All met; existing suites pass unmodified as the regression proof |
| 3 — Display filtering | Both endpoints filter; nearest-date ordering preserved; combined day survives; non-garden untouched | ✅ All met, independently confirmed against a running instance |
| 4 — Provider delete capability | Correct identifiers passed; existing callers unaffected; a rejected delete is handled not thrown | ✅ All met |
| 5 — Push gating + reconciliation | Not pushed / deleted when opted out; pushed when opted in; classification covers full feed range; cache unaffected; non-garden never deleted; deleted counts recorded | ⚠️ Met in code, but "recorded… so a run is auditable" is only half-delivered — see **M3**. "Non-garden never deleted" is violated under **C1** |
| 6 — Combined-day stripping | Stripped summary pushed, event not deleted; opted-in unchanged; in-place update rather than delete-and-reinsert, or document the limitation | ✅ Met for iCloud; Google documented as a limitation — but the stated rationale does not hold (**M1**) |
| 7 — Settings UI | Control on add + edit, labelled, defaults off; persisted; off-switch warning; bin-type flag; existing behaviour unchanged | ✅ All met, confirmed live in a browser |

**Summary: 12/13 Analysis criteria fully met, 1 partially met.**

---

## Findings

### Critical (must fix before merge)

#### C1 — A bin type whose Match is only wildcard characters becomes an empty matcher that classifies every event as Garden Waste, causing mass deletion from the user's external calendar

- **Category:** Reliability / Data loss
- **Location:** `src/server.js:482-487` (`sanitiseBinTypeInput` — guard at :483, strip at :486), `src/bin-types.js:15-17` (`matchesOutsideParentheses`), consumed destructively at `src/sync.js:112-133`
- **Description:**
  `sanitiseBinTypeInput` checks `!summary_match` **before** applying `.replace(/[%_]/g, '')`. A Match of `"%"`, `"_"`, or `"%%"` therefore passes validation and is persisted as an empty string. The codebase explicitly anticipates users typing wildcards — that is the entire reason the strip exists, and there is a dedicated test for it (`postBinType_withSummaryMatchContainingWildcard_stripsWildcards`).

  Before this PR an empty `summary_match` was merely cosmetic: `LIKE '%' || '' || '%'` matched every event, adding a spurious label. **This PR newly routes `summary_match` into a destructive path.** `matchesOutsideParentheses(segment, '')` returns `true` for every input because `String.prototype.includes('')` is always true, so with one blank matcher flagged `is_garden_waste = 1`:
  - `isGardenWaste(anything) === true`
  - `stripGardenWasteSegments(anything) === ''` → `isPureGardenWaste === true`
  - at `sync.js:122-133`, for every opted-out property (**the default state for all properties**): every event is skipped from push, and every event already present externally is passed to `google.deleteEvent` / `icloud.deleteEvent`.

  Reproduced against a running instance:
  ```
  POST /api/bin-types {"summary_match":"%","label":"Oops","colour":"#111111","is_garden_waste":true}
  → {"id":5,"summary_match":"","label":"Oops","colour":"#111111","is_garden_waste":1}

  matchers sync.js would load: [""]
  "Grey Bin"        -> isGarden: true | stripped: "" | isPureGardenWaste: true
  "Blue Bin"        -> isGarden: true | stripped: "" | isPureGardenWaste: true
  "Trolley+food"    -> isGarden: true | stripped: "" | isPureGardenWaste: true
  "Transition week" -> isGarden: true | stripped: "" | isPureGardenWaste: true
  ```
  The shipped Add Bin Type form (`public/properties.js:981-989`) sends the Match field verbatim after `.trim()` and carries the Garden Waste checkbox in the same form, so this is reachable in a single user action through the UI this PR introduces. The display layer happens to be resilient (its per-bin-type fan-out means only the blank-matcher row is dropped), which makes the failure **silent** — the app's own Calendar page looks completely normal while the user's real Google/iCloud calendar is being emptied.

- **Recommendation:** Three independent guards, ideally all of them:
  1. `sanitiseBinTypeInput` — strip first, then validate, and reject an empty result:
     ```js
     const cleaned = String(summary_match ?? '').replace(/[%_]/g, '').trim();
     if (!cleaned) return { error: 'Invalid match text: must contain at least one non-wildcard character' };
     ```
  2. `src/bin-types.js` — make the primitive safe: `matchesOutsideParentheses` returns `false` when `matchText` is empty/blank, and/or `isGardenWaste`/`stripGardenWasteSegments` apply `matchers.filter(m => m && m.trim())`.
  3. Add regression tests: an empty/whitespace matcher must classify nothing as garden waste, and `POST`/`PUT /api/bin-types` with `summary_match: "%"` must return 400.

  Guard 2 is the most important of the three, because it protects the destructive path regardless of how a blank value reached the table (existing rows, direct DB writes, future endpoints).

---

### Major (should fix)

#### M1 — The Google combined-day limitation is justified by a premise that does not hold; `events.patch` by ID is available and the ID is already in hand

- **Category:** Code Quality / Correctness
- **Location:** `src/sync.js:138-152`
- **Description:** The comment justifies skipping in-place rewrite on Google because "events.import has no documented behaviour for re-importing an existing iCalUID". That is true of `events.import`, but it is not the only option. `existingByUid` for Google is built at `sync.js:105` as `Map<iCalUID, e.id>` — i.e. **the Google event ID is already loaded**, precisely so `deleteEvent` can use it. `calendar.events.patch({ calendarId, eventId, requestBody: { summary } })` is a fully documented, idempotent, ID-addressed update, and `googleapis` exposes it on the same resource as the `delete` this PR already added. The consequence of the current choice: an opted-out Google property that was previously opted in keeps "Garden waste and general waste+food (…)" visible on the user's real calendar indefinitely, which is the thing the feature exists to prevent.
- **Recommendation:** Add `google.updateEventSummary(property, eventId, summary)` wrapping `calendar.events.patch`, and call it in the `isCombinedWithGardenWaste` + already-present branch for Google, mirroring the iCloud path. If the team prefers to defer, correct the comment to say the limitation is a deliberate scope decision rather than an API constraint, so it is not carried forward as received wisdom.

#### M2 — The iCloud combined-day update re-writes the remote event on every sync and is miscounted as "added"

- **Category:** Reliability / Performance
- **Location:** `src/sync.js:147-149`
- **Description:** For an opted-out iCloud property with a combined-day event, `isCombinedWithGardenWaste` is true on **every** run and the uid is always present in `existingByUid`, so `icloud.updateEvent` fires every sync — with no comparison against the summary already stored remotely. The event has in fact been correct since the first run. Each redundant `PUT` bumps the object's etag/sequence on iCloud, which can cause the user's devices to re-surface the event as "updated". It also increments `added`, so `sync_results` reports `events_added: 1` in perpetuity for a property where nothing was actually added — degrading exactly the audit trail Task 5 set out to establish.
- **Recommendation:** Compare before writing — `listEventObjects` already returns each object's raw `data`, so the current `SUMMARY:` line can be parsed and the update skipped when it already equals `strippedSummary` (counting it as `skipped` instead). Alternatively introduce a distinct `updated` counter rather than overloading `added`.

#### M3 — `events_deleted` is persisted but never surfaced, so the destructive operation is invisible in the UI

- **Category:** Reliability / Observability
- **Location:** `public/logs.js:56`
- **Description:** Design Task 5's criterion is "deleted counts are recorded in `sync_results` **so a run is auditable**". The column is written (`sync.js:186-190`) and is already returned to the client — `/api/sync/runs` selects `sr.*` — but the Logs page renders only `added: ${r.events_added}, skipped: ${r.events_skipped}`. A user whose calendar events were deleted has no way to see that it happened. Given deletion is the only irreversible action in the app, and the Analysis flagged the first post-deploy sync as a high rollout risk, this is the one place the user would look to confirm what the sync did.
- **Recommendation:** One-line change in `public/logs.js:56` to render `deleted: ${r.events_deleted}` (ideally only when non-zero, or styled to stand out when it is). Add a case to `tests/unit/logs-frontend.test.js` if one exists, or to the dashboard/logs frontend test pattern.

---

### Minor (nice to fix)

#### m1 — Inconsistent error guarding between `deleteEvent` and `updateEvent`
- **Category:** Reliability
- **Location:** `src/icloud.js:80-86` vs `:93-101`
- **Description:** Both providers' `deleteEvent` deliberately swallow and log per-event failures so one bad event never aborts a run — a well-reasoned decision, documented in both files. `icloud.updateEvent` has no such guard, so a transient CalDAV failure (e.g. a 412 etag conflict) propagates to `syncProperty`'s catch, aborting every remaining event for that property and marking the whole property's sync failed. Combined with M2 (the update firing every run), a persistent conflict would repeatedly fail that property.
- **Recommendation:** Apply the same try/catch-and-log treatment, or state in the comment why an update failure is deliberately fatal when a delete failure is not.

#### m2 — `deleted++` counts attempted, not confirmed, deletions
- **Category:** Reliability / Observability
- **Location:** `src/sync.js:126-130`
- **Description:** Because `deleteEvent` swallows its own errors, `deleted++` increments even when the deletion failed. `events_deleted` therefore over-reports, which matters more than usual given M3 proposes surfacing it as the user's audit trail for an irreversible action.
- **Recommendation:** Have `deleteEvent` return a boolean success and increment only on `true`, or expose a separate failure count.

#### m3 — Two new code paths uncovered by tests
- **Category:** Test Coverage
- **Location:** `src/sync.js:157`, `src/icloud.js:38`
- **Description:** `sync.js:157` — the iCloud combined-day **first** push (`icloud.insertEvent(property, strippedEvent)`) — has no test; the equivalent Google path does. `icloud.js:38`'s false branch (a calendar object with no parseable `UID:`) is uncovered. Overall coverage remains excellent (97.18%/91.79%), well above the 80% gate.
- **Recommendation:** Mirror `runSync_gardenWasteOptedOut_newCombinedDayEvent_pushesWithGardenWasteSegmentStripped` for `calendar_type: 'icloud'`.

#### m4 — The warning modal has no keyboard or backdrop dismissal and no focus management
- **Category:** Accessibility
- **Location:** `public/properties.js:415-447`
- **Description:** The new modal cannot be dismissed with Escape, clicking the backdrop does nothing, focus is not moved into the dialog or trapped, and it carries no `role="dialog"`/`aria-modal`/`aria-labelledby`. Cancel is reachable only by mouse-clicking the button. This is the project's first real modal, so whatever ships here sets the pattern.
- **Recommendation:** Add an Escape listener wired to the same handler as Cancel (removed on close), focus the Cancel button on open, and add `role="dialog" aria-modal="true" aria-labelledby`.

#### m5 — `google.listEvents` is unpaginated, which this PR newly makes a correctness issue for deletion
- **Category:** Reliability
- **Location:** `src/google.js:63-73`, consumed at `src/sync.js:104-105`
- **Description:** `calendar.events.list` is called with no `maxResults` and no `pageToken` loop, so it returns at most Google's default 250 events. This is pre-existing and previously only caused redundant re-imports (made harmless by `iCalUID` dedup). This PR gives `existingByUid` a second, destructive responsibility: a garden-waste event that exists externally beyond page 1 is absent from the map and therefore **never deleted** on opt-out, silently failing AC10. The window is the full feed range (~14 months) against whatever calendar the user selected — which for a Google property defaults to `primary`, i.e. the user's entire personal calendar.
- **Recommendation:** Add a `pageToken` loop (or `maxResults: 2500`) in `listEvents`. Pre-existing, so reasonable to split into a follow-up issue — but worth doing before relying on deletion correctness.

---

### Suggestions (optional)

#### S1 — `writeResult` now takes eight positional parameters
- **Location:** `src/sync.js:186`
- `writeResult(db, runId, property.id, 0, 0, 0, msg, startedAt)` — three consecutive zeros make a transposed argument easy to introduce and hard to spot. An options object (`{ added, skipped, deleted, error }`) would be self-documenting.

#### S2 — Garden matchers are re-queried once per property per sync
- **Location:** `src/sync.js:99-100`
- `bin_types` is global, not per-property, so the query could be hoisted into `runSync` and passed down. Negligible at current scale; purely tidiness.

#### S3 — The bin-types "Garden Waste" column gives no indication of what the flag does
- **Location:** `public/properties.js:905` (header), `:920` (✓ cell)
- The property-level toggle has strong explanatory copy; the bin-type flag — which is what actually *defines* garden waste for the whole feature, and which drives deletion — is a bare checkbox and ✓ with no hint text. Given C1, a line of guidance here (and a warning when no bin type is flagged, since the feature is then silently inert) would help.

---

## Positive Observations

- **Decision 2 is correctly and non-obviously implemented.** Classifying against the in-memory feed rather than the 6-month `events` cache is the kind of detail that is easy to get wrong and invisible when wrong — it would have silently under-filtered everything beyond six months. The reasoning is captured in a comment at the exact line it matters (`sync.js:94-98`).
- **Task 2's refactor is genuinely behaviour-free**, and the proof is structural: `attribute-summary-segment.test.js` and `calendar-events.test.js` pass completely unmodified. Extracting the matching primitives *before* adding a second consumer is exactly the right sequencing, and it is why `sync.js` and `server.js` cannot drift on what "matches" means.
- **The display layer gets the combined-day case for free**, because the pre-existing fan-out already splits a combined VEVENT into per-bin-type rows — so filtering one row leaves the other intact. Recognising and relying on that rather than building parallel logic is good judgement.
- **Error-handling boundaries in the provider deletes are carefully drawn**: only the delete call is wrapped, so auth failures still reach `syncProperty`'s `isAuthError` handling and still mark credentials invalid. The comments explain the distinction.
- **The `window.CONFIG` test-harness fix was correctly diagnosed and correctly placed.** It would have been easy and wrong to change `let CONFIG` to `var CONFIG` in production code to make a test pass; instead the jsdom-vs-browser scoping difference is explained and bridged in the harness.
- **Test quality is high throughout** — real feed strings used as fixtures, comments explaining the real-world bug behind each case, and negative/regression assertions (e.g. "PUT without the field must not reference the column") rather than only happy paths.
- **Rollout risk was surfaced proactively** in the Analysis, the Design, and the PR description, rather than being left for a reviewer to discover.

---

## Action Items

### Immediate Fixes (block merge)
- [ ] **C1:** Reject bin-type Match text that is empty after wildcard stripping, and make the matching primitives treat a blank matcher as matching nothing. Add regression tests for both.

### Should fix before merge (team's call)
- [ ] **M1:** Implement the Google combined-day in-place update via `events.patch` using the event ID already in `existingByUid` — or correct the comment's rationale.
- [ ] **M2:** Skip the iCloud combined-day update when the remote summary already matches; stop counting it as `added`.
- [ ] **M3:** Surface `events_deleted` on the Logs page.

### Post-merge improvements
- [ ] m1: Align `icloud.updateEvent` error handling with `deleteEvent` — create issue
- [ ] m2: Count confirmed rather than attempted deletions — create issue
- [ ] m3: Cover `sync.js:157` (iCloud combined-day first push) — create issue
- [ ] m4: Modal keyboard dismissal, focus management and ARIA — create issue
- [ ] m5: Paginate `google.listEvents` — create issue via `/analyse` (pre-existing, now load-bearing)

---

## Checklist

- [x] All acceptance criteria from the full issue hierarchy verified by reading actual code
- [x] Every changed file read and audited
- [x] Tests cover happy path, error paths, and edge cases — with the gaps noted in m3 and C1
- [x] Lint run — zero errors introduced by this PR (0 errors, 0 warnings)
- [ ] No security vulnerabilities introduced — no injection/XSS surface added, but C1 is an input-validation failure with destructive consequences
- [x] No performance regressions — M2's redundant write is bounded to combined-day events
- [ ] Error handling complete and consistent — see m1, m2
- [ ] Logging adequate for debugging production issues — see M3 (deletions not surfaced)
- [x] Code follows existing codebase conventions
- [x] No unnecessary changes outside scope of the issue
