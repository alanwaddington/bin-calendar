# PR #37 Review — Generalize bin-type opt-in beyond Garden Waste, with immediate per-property sync (#35)

**Date:** 2026-10-29
**Author:** alanwaddington
**Branch:** feature/35-generalize-bin-type-opt-in → main
**State:** Open

> **Post-review update (2026-10-29):** per the user's standing instruction to fix every finding regardless of severity, all 18 code-level findings below (C1, M1–M6, m2–m10, S1–S2) are now fixed and re-verified — see the `Outcome` note on each. Full suite: 472/472 passing (was 436), lint still clean. **m1** and **S3** were operational checks against the real NAS database rather than code fixes — both run (see their `Outcome` notes): the backfill count is the expected `1`, and no `bin_types.summary_match` row contains a wildcard, so S3's cleanup migration isn't needed at all. **S4** (back up the NAS database before this deploys) remains the one genuinely outstanding item, and can only be done by the user.

---

## Summary

| Item | Result |
|------|--------|
| Overall Assessment | ~~Fail ❌~~ → **Pass ✅** (post-fix) — all findings resolved or confirmed not applicable; only S4 (a manual pre-deploy backup) remains |
| Risk Level | ~~High~~ → **Low** (post-fix) — C1's data-loss path is closed and regression-tested |
| Test Coverage | 472/472 passing (was 436) — error paths (C1, M6) and XSS now covered |
| Acceptance Criteria | **18 / 18 Met** (all verified against code, not checkboxes) |
| Lint | 0 errors / 0 warnings |

**Per-file coverage of changed source:** `bin-types.js` 100/100/100/100, `db.js` 100/100/100/100, `sync.js` 98.08/96/100/97.74 (uncovered: 29, 80-81), `server.js` 95.42/90.54/98.24/95.43 (uncovered: 96, 120, 137, 572, 589, 627-635). All stmts/branch/funcs/lines.

**Note on the apparently mixed verdict:** all 18 acceptance criteria genuinely pass — they describe specified, happy-path behaviour, and that behaviour works. The Critical and Majors below live in paths the criteria never mention: fetch failures, degenerate feed data, concurrent UI state, and scoped-run blast radius. A clean AC sheet is therefore not a green light here.

---

## Issues Reviewed

### Issue Hierarchy
- **#35** — Generalize bin-type opt-in beyond Garden Waste, with immediate per-property sync on toggle (OPEN) — the only issue; `subIssues` is empty and the GitHub `parentIssue` field is unavailable on this API version. Flat, consistent with this repo's single-issue `/analyse` → `/design` → `/develop` convention.
- **#33** — Add per-property opt-in for Garden Waste collection (CLOSED, shipped as PR #34) — the predecessor this PR generalizes. Its acceptance criteria must continue to hold; #35's AC 8 restates that requirement explicitly.
- **PR #36** — stale-event reconciliation (merged) — its behaviour must survive this refactor.

---

## Changed Files Audit

### `src/migrations/009.sql` (+32 / −0)

| Property | Detail |
|---|---|
| Purpose | Adds `bin_types.requires_opt_in`, creates `property_bin_type_opt_ins`, backfills both from the old Garden-Waste columns, then drops those columns |
| Issues | #35 (Task 1) |
| Criteria covered | 1, 4, 5, 6, 17 |
| Quality | ✅ No issues. Statement order verified safe; the `DROP COLUMN`s are the project's first irreversible migration. See Minor m1 and Suggestion S4 |
| Test coverage | `db.test.js` — 8 migration-009 tests incl. `seedPre009Database` backfill trio (`...backfillGrantsOptedInPropertyAnOptInRowForEachFlaggedBinType`, `...backfillDoesNotGrantOptInForAnOptedOutProperty`, `...backfillDoesNotFlagABinTypeThatWasNeverIsGardenWaste`) |

Verified empirically against a seeded pre-009 database (4 properties with mixed opt-in, 3 flagged/unflagged bin types): `requires_opt_in` carried forward exactly, 4 correct opt-in rows created, **no over-granting**, all property rows/credentials/`created_at` intact through the `DROP COLUMN` table rewrite. Bundled SQLite is 3.45.3 (`DROP COLUMN` needs ≥3.35.0); no index, view, trigger, CHECK or UNIQUE constraint references either dropped column, so SQLite's "referenced elsewhere" refusal cannot fire. `PRAGMA foreign_keys` confirmed ON at runtime (`db.js:16`) and both cascade directions verified by deletion.

### `src/db.js` (+18 / −3)

| Property | Detail |
|---|---|
| Purpose | Extracts `applyMigration(version, sql)`, wrapping each migration's DDL **and** its `schema_version` insert in one `db.transaction()` |
| Issues | #35 (Task 1) |
| Criteria covered | 17 (supporting) |
| Quality | ✅ Genuine hardening over `main`, which ran a bare `db.exec(sql)` and relied on process death rather than rollback |
| Test coverage | `db.test.js:214` `applyMigration_whenSqlFailsPartway_rollsBackCompletelyWithNoOpenTransactionOrVersionRow` |

Atomicity verified empirically: forcing a mid-migration failure left `db.inTransaction === false`, no `schema_version` row, and no partial DDL.

### `src/bin-types.js` (+17 / −14)

| Property | Detail |
|---|---|
| Purpose | Renames `isGardenWaste`→`matchesAnySegment`, `stripGardenWasteSegments`→`stripMatchingSegments`; generalizes comments |
| Issues | #35 (Task 2) |
| Criteria covered | 9 (supporting) |
| Quality | ✅ Pure rename, no logic change. But see M1 — `stripMatchingSegments('   ', [])` returns `''`, which its sole caller over-trusts |
| Test coverage | `bin-types.test.js` — 100% on all metrics |

### `src/sync.js` (+70 / −37)

| Property | Detail |
|---|---|
| Purpose | Generalizes opt-in gating from one Garden Waste boolean to the full flagged-type set × per-property opt-in set; adds `runSync(propertyId)` scoping |
| Issues | #35 (Tasks 5, 6) |
| Criteria covered | 8, 9, 10, 11, 13, 14, 15 |
| Quality | ⚠️ **M1** (degenerate summary deleted), **M2** (scoped run does global mutations; prune outside `try` orphans the lock), plus m2/m5 |
| Test coverage | `sync.test.js` — the multi-type trio (`...stripsOnlyTheWithheldSegment...`, `...stripsBothWithheldSegments`, `...pushesTheFullCombinedSummaryUnchanged`) plus 7 scoped-sync tests |

The core generalization is **sound**. The two-check design (`targetSummary` from withheld types only; `touchesAnyFlaggedType` across all flagged types regardless of opt-in) was walked through all 27 cells of opted-into-{none,some,all} × summary-touching-{none,one,several} × {pushed-original, pushed-stripped, not-pushed}: no withheld segment is ever pushed, re-opt-in restores correctly, and nothing rewrites identically each run under the mocked read-back. N+1 is genuinely eliminated — flagged types and opt-in rows are each queried exactly once per run (`sync.js:64-65`), confirmed by `runSync_withMultipleProperties_queriesFlaggedBinTypesAndOptInRowsExactlyOnce`.

### `src/server.js` (+107 / −43)

| Property | Detail |
|---|---|
| Purpose | `opted_in_bin_type_ids` on GET/POST/PUT properties; `requires_opt_in` on bin-types endpoints; generalized display gating; `POST /api/properties/:id/sync`; the pre-existing NUL-byte fix |
| Issues | #35 (Tasks 3, 4, 6) + one out-of-scope drive-by fix |
| Criteria covered | 1, 2, 4, 8, 10, 13, 14, 15 |
| Quality | ⚠️ **M3** (500s + raw SQLite leakage on duplicate/non-integer ids; misleading 400 for unknown property), plus m3/m4/m6 |
| Test coverage | `server.test.js` — 4 scoped-sync endpoint tests + opt-in plumbing tests. **No test for duplicate or non-integer ids** |

Security clean: every value is bound; `OPT_IN_JOIN_SQL`/`BIN_TYPE_JOIN_SQL` are static strings and the only interpolation is generated `?` placeholders (`server.js:472`, `sync.js:329`). Nothing is server-rendered, so no server-side XSS surface. The `GET /api/properties` opt-in fetch is one grouped query, not per-property.

**Drive-by fix (commit `93e61ae`), verified:** `main:src/server.js` contains exactly 1 NUL byte, the branch 0; the line now reads `.join(' ')`. The claim that it predates this work is accurate. Out of scope for #35 but correctly isolated in its own commit with a clear message — acceptable.

### `public/properties.js` (+118 / −66)

| Property | Detail |
|---|---|
| Purpose | N opt-in switches replacing the single checkbox; generalized multi-type warning modal; `loadSettings` load-order fix; scoped-sync toast sequence; generalized Bin Types table |
| Issues | #35 (Task 7) |
| Criteria covered | 2, 3, 4, 10, 11, 12, 14, 15, 16 |
| Quality | ❌ **C1** (silent opt-in wipe on failed bin-types fetch), ⚠️ **M6** (stale switches after bin-type changes), plus m7-m10 |
| Test coverage | `properties-frontend.test.js` — 34 tests, full rewrite. **No test for C1, M6, or XSS** |

**XSS: clean.** Every interpolation of user data was audited — switch labels use `escHtml(bt.label)`, colours use `escAttr(bt.colour)` inside the `style` attribute, and the modal's title and body both pass bin-type labels through `escHtml` before interpolation. Note the colour is additionally safe because `sanitiseBinTypeInput` validates 6-digit hex server-side; `escAttr` alone would not prevent CSS injection, so that server-side validation is load-bearing and should not be relaxed.

The **load-order fix is genuine**: `await renderBinTypes()` now precedes the `Promise.all`, and every other `renderPropertyAccordions()` call site is reachable only after `loadSettings` has run.

### `public/style.css` (+13 / −0)

| Property | Detail |
|---|---|
| Purpose | Adds `.opt-in-switches` (flex column) and `.toast-info` |
| Issues | #35 (Task 7) |
| Criteria covered | 2, 15 (supporting) |
| Quality | ⚠️ **M4** — `.toast-info` uses a 10%-alpha background on a `position: fixed` overlay; also m10 (`.badge-paid` now dead) |
| Test coverage | N/A (CSS); the `toast-info` class is asserted in `properties-frontend.test.js` |

### `README.md` (+5 / −4)

| Property | Detail |
|---|---|
| Purpose | Generalizes the Features bullet and the `PUT /api/properties/:id` row; documents `POST /api/properties/:id/sync` |
| Issues | #35 (Task 7) |
| Criteria covered | 18 |
| Quality | ✅ No issues. Documenting the new endpoint was slightly beyond the stated task but correct to include |
| Test coverage | N/A (documentation) |

### `tests/helpers/browserDom.js` (+2 / −1)

| Property | Detail |
|---|---|
| Purpose | Adds a `status` field to mocked fetch responses so tests can exercise HTTP-status-dependent error handling |
| Issues | #35 (Task 7) |
| Criteria covered | 14 (supporting) |
| Quality | ✅ Safe and backward-compatible — `status ?? (ok !== false ? 200 : 500)` preserves prior behaviour for every existing route, and no other suite asserts on `status` |
| Test coverage | Exercised by the 429 test in `properties-frontend.test.js` |

### Test files (`sync.test.js` +279/−61, `properties-frontend.test.js` +397/−122, `server.test.js` +192/−55, `db.test.js` +178/−20, `bin-types.test.js` +31/−31, `calendar-events.test.js` +36/−19)

Updated alongside each task. Quality is good — real DOM, real `api()`, and the "register no sync route so a stray call throws" trick is a genuine negative assertion. Weaknesses noted in m9.

---

## Acceptance Criteria Verification

### #35 — Generalize bin-type opt-in beyond Garden Waste, with immediate per-property sync on toggle

| # | Criterion | Implementation | Test | Verdict |
|---|---|---|---|---|
| 1 | Any bin type flaggable "opt-in required"; any number incl. zero | `009.sql:14`, `server.js:547,565,581`, `properties.js:939` | `db.test.js:235`, `server.test.js` bin-types, `properties-frontend.test.js:618` | ✅ Met |
| 2 | One switch per flagged type, own label/colour + one generic sentence, no PAID badge | `properties.js:360-379` | `properties-frontend.test.js:33,54,89` | ✅ Met |
| 3 | Zero flagged types → no switches, no empty header | `properties.js:363` (`return ''`) | `properties-frontend.test.js:18,71` | ✅ Met |
| 4 | Independent opt-in per flagged type | `009.sql:17-22` (composite PK), `server.js:70-74` | `properties-frontend.test.js:89`, `sync.test.js:1466` | ✅ Met |
| 5 | Migration preserves live state | `009.sql:25-29` | `db.test.js:326` | ✅ Met (verified empirically) |
| 6 | Migration does not over-grant | `009.sql:25-29` (`WHERE garden_waste_opted_in = 1`) | `db.test.js:347,362` | ✅ Met (verified empirically) |
| 7 | Post-migration sync makes the same decisions; nothing added/deleted by migrating | `009.sql` backfill + unchanged `syncProperty` gating | By composition: `db.test.js:326-371` (state preserved) + `sync.test.js` (behaviour on state) | ✅ Met — see m1/S2 |
| 8 | All #33/#34 criteria hold, generalized | `sync.js:160-240`, `server.js:234` | Full pre-existing #34 suite still green (436/436) | ✅ Met |
| 9 | Multi-type combined summary stripped per-segment independently | `sync.js:160-176`, `bin-types.js` | `sync.test.js:1466,1500,1531` | ✅ Met |
| 10 | Changed switch → sync scoped to that property only | `properties.js:434`, `sync.js:45-51` | `sync.test.js:1589,1606`; `server.test.js:127` | ✅ Met — but see M2 |
| 11 | No changed value → no sync | `properties.js:415,434` (`changed` guard) | `properties-frontend.test.js:165` | ✅ Met |
| 12 | Background; Save returns immediately; syncing toast then result toast | `properties.js:434` (not awaited), `441-456` | `properties-frontend.test.js:~400-446` | ✅ Met — legibility caveats M4/M5 |
| 13 | Outcome in `sync_results`/`sync_runs`, visible in Logs, same shape as global | `sync.js:20-25,70-78` (shared path) | `sync.test.js:1624`; `logs.js:25` filters only by `run_id` | ✅ Met |
| 14 | Sync already running → fails fast via error toast, no queue | `sync.js:21-28` (429), `properties.js:457` | `sync.test.js:1649`; `server.test.js:137`; `properties-frontend.test.js:438` | ✅ Met — see m3 |
| 15 | Not-connected property saves; sync is a no-op; no misleading success toast | `sync.js:53-56`, `properties.js:449-450` (`toast-info`) | `sync.test.js:1660`; `server.test.js:149`; `properties-frontend.test.js:424` | ✅ Met — see M4, m2 |
| 16 | Off-switch modal copy reflects immediate deletion | `properties.js:487-489` ("removed immediately") | `properties-frontend.test.js:191,217` | ✅ Met |
| 17 | Migrations strictly additive (006/007/008 untouched); no GW columns left live | Only `009.sql` added — `git diff` on `src/migrations/` confirms | `db.test.js:253,261` | ✅ Met |
| 18 | README no longer Garden-Waste-specific | `README.md:13-14,261,270-271` | N/A (docs) | ✅ Met |

**Summary: 18/18 criteria met.** Verified independently by reading code and tests, not by trusting the ticked checkboxes on the issue.

---

## Findings

### Critical (must fix before merge)

#### C1 — A failed `GET /api/bin-types` silently wipes a property's opt-ins and deletes its events from the real calendar
- **Category:** Reliability / Data loss
- **Location:** `public/properties.js:400-417` (`renderBinTypes` error path) + `363` (`buildOptInSwitches`) + `407-417` (`savePropertyEdit`) + `src/server.js:111-112`
- **Description:** `renderBinTypes()` swallows a fetch error and returns, leaving `_binTypes` as `[]`. `buildOptInSwitches` cannot distinguish "no bin type requires opt-in" from "bin types failed to load", so it renders **no switches**. If the user then saves that property for any unrelated reason — fixing a typo in the label — `flagged` is `[]`, so `newIds` is `[]` and `turnedOff` is `[]`: **the confirmation modal never fires**. The PUT sends `opted_in_bin_type_ids: []`, the server unconditionally replaces the opt-in rows, `changed` evaluates true, and `triggerScopedSync` runs — deleting the already-pushed events from the user's real Google/iCloud calendar. Silent and irreversible, from a transient 500.
  **Verified empirically.** A repro test (bin-types route returning 500, property pre-opted-in to bin type 3, user edits only the label) produced: `PUT body: {"label":"Home renamed","ics_url":"...","opted_in_bin_type_ids":[]}`, `warning modal shown? false`, `scoped sync fired? true`.
- **Recommendation:** Distinguish "unavailable" from "none". Set a `_binTypesLoaded` flag in `renderBinTypes`; when false, **omit** `opted_in_bin_type_ids` from the PUT body entirely — `server.js:111`'s `Array.isArray` guard already makes that a no-op, so opt-ins are preserved — and show an inline error on Save rather than guessing. Add a regression test.
- **Outcome:** **Fixed** (`13dd276`) — a new `_binTypesLoaded` flag makes `savePropertyEdit` omit `opted_in_bin_type_ids` from the PUT entirely when bin types never loaded, preserving existing opt-ins instead of wiping them; verified with a repro test that reproduced the exact failure before the fix. 3 regression tests.

### Major (should fix)

#### M1 — A degenerate summary is treated as fully withheld and deleted from the real calendar
- **Category:** Correctness / Data loss
- **Location:** `src/sync.js:178`
- **Description:** `isFullyWithheld = targetSummary === ''` does not also require `touchesAnyFlaggedType`. **Verified:** `stripMatchingSegments('   ', [])` returns `''` while `matchesAnySegment('   ', [])` is `false` — so a whitespace-only summary is classified as fully withheld **even when no bin type is flagged at all**, and the event is deleted from the external calendar (`sync.js:181-190`). `src/ics.js:47`'s `extractText(entry.summary) || 'Bin Collection'` does **not** save us: `'   '` is truthy and survives the fallback. The pre-PR code was immune because the equivalent branch required `isGarden === true`.
- **Recommendation:** `const isFullyWithheld = touchesAnyFlaggedType && targetSummary === '';` plus a test for `stripMatchingSegments('   ', [])`.
- **Outcome:** **Fixed** (`77a1fb5`) — `isFullyWithheld` now also requires `touchesAnyFlaggedType`. 1 regression test (`stripMatchingSegments('   ', [])` against an already-pushed event).

#### M2 — A property-scoped sync performs global mutations, and the prune sits outside the `try`
- **Category:** Correctness / Reliability
- **Location:** `src/sync.js:37` and `:76`
- **Description:** Two issues. (a) `DELETE FROM events WHERE start_date < date('now')` (line 37) and `purgeOldRecords(db)` (line 76, which deletes `sync_runs` older than 90 days) both run **unscoped** on a scoped request, touching other properties' cached events and the shared run history — a contract violation, and the prune runs even when the scoped query matches nothing. (b) More seriously, line 37 sits **outside** the `try`, so if it throws, the `running` row is never moved to `failed` and every subsequent sync 429s until the process restarts. (`recoverInterruptedSyncs` in `db.js` clears it only at startup.)
- **Recommendation:** Move line 37 inside the `try` so `updateRun('failed')` can fire; scope the prune with `AND property_id = ?` when `propertyId` is set; gate `purgeOldRecords` to global runs.
- **Outcome:** **Fixed** (`77a1fb5`) — the prune is now scoped by `property_id` when one is given, moved inside the `try` so a failure is caught and recorded via `updateRun('failed')`, and `purgeOldRecords` only runs for global (unscoped) runs. 4 regression tests.

#### M3 — `replaceOptIns` returns 500 with raw SQLite messages, and an unknown property yields a false 400
- **Category:** Reliability / Input validation
- **Location:** `src/server.js:70-74`, with the only `catch` branches at `:93` and `:117`
- **Description:** **All three verified empirically against a running server.** Duplicate ids → `HTTP 500 {"error":"UNIQUE constraint failed: property_bin_type_opt_ins.property_id, property_bin_type_opt_ins.bin_type_id"}`. A non-integer element `[null]` → `HTTP 500 {"error":"NOT NULL constraint failed: ..."}`. Both leak raw schema detail to the client, and only `SQLITE_CONSTRAINT_FOREIGNKEY` is handled. Separately, `PUT /api/properties/999` on a nonexistent property returns `HTTP 400 {"error":"One or more bin type ids do not exist"}` — factually wrong: the bin type exists, the property doesn't. CLAUDE.md requires validating all user input at API boundaries.
- **Recommendation:** Normalise at the boundary — `[...new Set(ids)]` after rejecting non-integers, else 400 with a clear message. Return 404 from the PUT when `UPDATE ... .changes === 0`. Never surface raw SQLite text.
- **Outcome:** **Fixed** (`bb1b6b0`) — a new `sanitiseOptInIds()` validates and deduplicates before any SQL runs (duplicates silently deduplicated, non-integers rejected with 400); the PUT's own `UPDATE ... changes` count now distinguishes a real update from a no-op on a missing property id, returning 404. Verified against a running server as well as 7 new unit tests.

#### M4 — `.toast-info` is near-transparent, and it is the only skipped-sync feedback path
- **Category:** Code Quality / Accessibility
- **Location:** `public/style.css:1034-1038`
- **Description:** `--muted-bg` is `rgba(100, 116, 139, 0.10)` — a 10%-alpha fill designed for inline badges sitting on an opaque surface. Every other toast variant uses an opaque hex (`--success-dark: #dcfce7`, `--danger-dark: #fee2e2`). As a `position: fixed` overlay the info toast shows the page through it, with low-contrast `--muted` text on top, failing the 4.5:1 contrast bar. This is the *only* channel for "nothing synced — not connected" (AC 15), so the one message the user most needs is the least readable. Corroborated by a screenshot taken during development.
- **Recommendation:** Add an opaque `--muted-dark` (e.g. `#f1f5f9`) and use it, or `background: var(--surface)`.
- **Outcome:** **Fixed** (`5f31a2c`) — new opaque `--muted-dark` token (matching the `--success-dark`/`--danger-dark` pattern) replaces the 10%-alpha `--muted-bg` fill. Verified visually via a Playwright screenshot.

#### M5 — Concurrent toasts render on top of each other; this PR is the first code to emit them
- **Category:** Code Quality
- **Location:** `public/app.js:51-60` + `public/properties.js:431-435`
- **Description:** `.toast` is `position: fixed; bottom: 24px; right: 24px` with no stacking container, so every toast draws at identical coordinates. `performPropertySave` fires `'Property updated'` and then, in the same tick, `triggerScopedSync`'s `'Syncing <label>…'`, with a third result toast likely arriving before the first two expire at 3s. Directly observed overlapping during development. The defect was latent before this PR because only one toast at a time was realistic — this PR makes a 2-3 toast sequence the normal path, which is what elevates it from cosmetic.
- **Recommendation:** Add a flex-column `#toast-stack` container and append into it; or suppress `'Property updated'` when `changed` is true, since the sync toasts already confirm the save.
- **Outcome:** **Fixed** (`5f31a2c`) — `showToast()` now appends into a lazily-created `#toast-stack` flex container instead of each toast fixing its own position. Verified visually (three toasts stack cleanly with no overlap) plus 2 new tests.

#### M6 — Property switches go stale after any bin-type flag change, and one path drops an opt-in with no modal
- **Category:** Correctness / Code Quality
- **Location:** `public/properties.js:917-961` (`renderBinTypes`, `saveBinTypeEdit`, `saveNewBinType`, `doDeleteBinType`)
- **Description:** These handlers refresh `_binTypes` and re-render only `#bin-types-section`, leaving the property accordions showing the previous switch set. Flagging a type makes the "has no effect" banner vanish while no switch appears anywhere — visibly contradictory. In the *un*flagging direction, the stale checkbox stays in the DOM still checked; the next property Save computes `turnedOff` from the refreshed `flagged` list, which no longer contains that type, so the opt-in row is dropped **without a confirmation modal**. (Consequence is bounded: a type that is no longer flagged is no longer withheld by sync, so no external events are deleted — which is why this is Major and not Critical.)
- **Recommendation:** `await renderPropertyAccordions()` after every successful bin-type mutation.
- **Outcome:** **Fixed** (`13dd276`) — `saveBinTypeEdit`/`saveNewBinType`/`doDeleteBinType` now re-render property accordions from the already-fetched property cache after every bin-type mutation. 2 regression tests.

### Minor (nice to fix)

#### m1 — Latent opt-in intent is discarded by the backfill
- **Category:** Correctness
- **Location:** `src/migrations/009.sql:25-29`
- **Description:** The backfill CROSS JOINs opted-in properties against *flagged* bin types. **Verified empirically:** a property with `garden_waste_opted_in = 1` while no bin type is flagged produces zero opt-in rows. Pre-009 that stored `1` would have taken effect the moment an admin flagged a type; post-009 the property is opted out. Only bites if the live NAS database is in that state — in which case nothing syncs as garden waste today anyway, so it is lost *intent*, not lost current behaviour.
- **Recommendation:** Before deploying, check `SELECT count(*) FROM bin_types WHERE is_garden_waste = 1;` on the NAS. If ≥ 1 (the expected state), the backfill is exact and nothing needs changing.
- **Outcome:** **Confirmed healthy (2026-10-29).** Checked against the real NAS database: `{ n: 1 }` — exactly one bin type is flagged, the expected state. The backfill is exact for this data; nothing to change.

#### m2 — Skipped-sync detection string-matches server prose
- **Category:** Code Quality
- **Location:** `public/properties.js:449`
- **Description:** `result.message.startsWith('Skipped')` couples the UI to `src/sync.js:55`'s exact copy. Reword that message and the UI silently falls through to the success branch — precisely the false success the adjacent comment promises to prevent.
- **Recommendation:** Have `runSync` return `overallStatus: 'skipped'` and branch on that instead.
- **Outcome:** **Fixed** (`7b5b85f`) — `runSync`'s skip response now carries `overallStatus: 'skipped'`; `triggerScopedSync` branches on that instead of matching `message` prose. As a side effect, `dashboard.js`'s existing `overallStatus === 'skipped'` branch (previously unreachable - that field never existed on the skip response before) now correctly engages too. 2 new/updated tests.

#### m3 — A scoped-sync 429 silently defers the user's opt-in change
- **Category:** Reliability
- **Location:** `src/sync.js:21-28`, `public/properties.js:457`
- **Description:** Toggling two properties in quick succession makes the second scoped sync 429. The save persisted, but the withheld events stay on the real calendar until the next monthly run, and the toast only says a sync is already in progress — it does not tell the user their change has not yet taken effect on the calendar.
- **Recommendation:** Word the toast to say the change will apply on the next sync, or have the client retry once after a short delay.
- **Outcome:** **Fixed** (`929bd37`) — the 429 toast now says "<label> saved — a sync is already in progress, so this change will take effect on the next sync" instead of reading like the save itself failed. 1 updated test.

#### m4 — No 404 for an unknown property on the scoped-sync endpoint
- **Category:** Code Quality
- **Location:** `src/server.js:453-461`
- **Description:** `POST /api/properties/999/sync` returns `200 {message: "Skipped — no properties configured"}` — **verified**. Not a false success, so AC 15 holds, but it is indistinguishable from "this property exists but has no credentials".
- **Recommendation:** Check existence first; 404 for unknown, and a property-specific message for not-connected.
- **Outcome:** **Fixed** (`bb1b6b0`) — the scoped-sync route now checks property existence first and returns a distinct 404 before `runSync` (and its concurrency lock) is touched. Verified against a running server plus 2 new tests.

#### m5 — Summary normalization leak between the external calendar and the app's own UI
- **Category:** Correctness (cosmetic)
- **Location:** `src/sync.js:205, 230` vs `:341`
- **Description:** `targetSummary` is always a rejoin of split segments, so a feed summary using `" AND "` or doubled whitespace is rewritten as `" and "` when pushed, while `cacheEvents` stores the untouched `event.summary`. The external calendar and the app's own calendar view can therefore show slightly different text for the same event.
- **Recommendation:** Keep the original when stripping removed nothing, or compare segment-wise.
- **Outcome:** **Fixed** (`070e66d`) — equal segment counts before/after stripping means nothing was actually removed, so that case now pushes the untouched original summary verbatim instead of the rejoined/renormalized result. 1 regression test.

#### m6 — Display and sync gating can disagree on one edge
- **Category:** Correctness
- **Location:** `src/server.js:217` (`excludeParenthesesOnlyMatches`) vs `src/bin-types.js` (`matchesAnySegment`)
- **Description:** The display layer matches `summary_match` against the whole summary; sync matches per segment. A `summary_match` spanning an `" and "` boundary is therefore hidden in the UI but still pushed to the real calendar — the one place the two gates diverge.
- **Recommendation:** Share one matching primitive between both paths.
- **Outcome:** **Fixed** (`a2b5161`) — rather than unifying the two independently-reasoned matching algorithms (higher blast radius, and the display layer's whole-summary fan-out exists for a different purpose), a Match text containing "and" is now rejected at the API boundary, since it could never match correctly under either algorithm. 2 new tests.

#### m7 — `overallStatus: 'partial'` falls into the success branch
- **Category:** Reliability
- **Location:** `public/properties.js:451-456`
- **Description:** Unreachable today for a single property (`sync.js:72-74` can only yield `success` or `failed` for one property), but the `else` is a silent catch-all that would report a future `partial` as success.
- **Recommendation:** Make the success branch explicit (`=== 'success'`) and treat anything else as a warning.
- **Outcome:** **Fixed** (`7b5b85f`) — the success toast now requires an explicit `overallStatus === 'success'`; any other value (including a future `'partial'`) falls through to an explicit warning branch instead of a catch-all `else`. 1 new test.

#### m8 — Modal focus is never restored, and there is no focus trap
- **Category:** Accessibility
- **Location:** `public/properties.js:496-521`
- **Description:** The inherited a11y contract is **intact and verified** — `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape, backdrop click, focus-to-Cancel, listener removal on *both* close paths, and Cancel restoring *all* affected checkboxes. Two gaps remain: focus is not returned to the Save button on close (keyboard users land on `<body>`), and Tab can escape behind the overlay. Also `properties.js:366`'s bare `<label>Opt-in collections</label>` has no `for` and so names nothing.
- **Recommendation:** Store and restore the previously focused element; add a Tab cycle; use `<fieldset><legend>` or `role="group" aria-labelledby` for the switch group.
- **Outcome:** **Fixed** (`929bd37`) — focus is restored to the previously-focused element on Cancel; Tab/Shift+Tab now trap focus between the modal's two buttons; the switches are now grouped in a `<fieldset>/<legend>` (visually unchanged, verified via Playwright screenshot) instead of a bare `<label>`. 4 new tests.

#### m9 — Test gaps and two weak assertions
- **Category:** Test Coverage
- **Location:** `tests/unit/properties-frontend.test.js`
- **Description:** No XSS regression test anywhere, despite CLAUDE.md making escaping a standing rule — a bin type labelled `<img src=x onerror=...>` reaching the modal title/body and the switch label is the obvious test (the escaping is correct today; nothing guards it). No test for C1 or M6. `:285` and `:362` invoke `.onclick()` directly rather than `.click()`, asserting handler assignment rather than behaviour. `:238`'s `expect(modal.textContent).toMatch(/2/)` is near-tautological — match `/2 collections/`.
- **Recommendation:** Add the XSS test and regression tests for C1/M6; tighten the two assertions.
- **Outcome:** **Fixed** (`593ca81`) — 2 new XSS regression tests (escaping was already correct; these guard it going forward); the two `.onclick()` calls switched to `.click()` + the existing `flush()` helper; the near-tautological `/2/` match tightened to `/2 collections/`.

#### m10 — Dead code and a stale comment
- **Category:** Code Quality
- **Location:** `public/style.css:506`, `public/properties.js:370`, `src/server.js:110`, `src/sync.js:140-144`, `src/icloud.js:43-46`
- **Description:** `.badge-paid` has zero remaining usages (its only consumer was the removed Garden Waste block). `data-bin-type-id` is written but never read. `server.js:110`'s comment still names `garden_waste_opted_in`. `sync.js:140-144` is a dangling `#33:` comment block attached to no statement, describing a loop 30 lines below. `listEventUids` is exported from `icloud.js` but has **no callers anywhere in `src/`** — verified.
- **Recommendation:** Delete each.
- **Outcome:** **Fixed** (`6cc9ff3`) — `listEventUids` and its dedicated tests removed (zero callers in `src/`); `.badge-paid` and `data-bin-type-id` removed; the dangling comment moved to sit above the code it actually describes; the stale column-name reference reworded.

### Suggestions (optional)

#### S1 — iCloud SUMMARY line folding may prevent compare-before-write from ever converging
- **Category:** Performance / Correctness — **pre-existing from #34, widened here**
- **Location:** `src/icloud.js:55` (write) and `:130` (read), consumed at `src/sync.js:208`
- **Description:** **Code facts verified:** `buildVCalendarString` emits `SUMMARY:${event.summary}` with no RFC 5545 folding, `extractSummary` matches `/^SUMMARY:(.+)$/m` with no unfolding, and the real EA combined summary is **78 octets** — over the 75-octet limit. If a CalDAV server normalises by folding on storage, the read-back returns only the first physical line, `currentRemoteSummary(...) === targetSummary` is permanently false, and every flagged combined-day event is rewritten on every run, bumping etags on the user's devices. **Not verified against a live iCloud server** — whether a given server folds is unconfirmed, which is why this is a Suggestion rather than a finding. All integration tests mock `extractSummary` (`sync.test.js:44`) so they cannot detect it either way. This PR routes strictly more events through that comparison (every event touching any flagged type, opted-in included), so exposure grows.
- **Recommendation:** Fold on write and unfold on read (strip `\r\n[ \t]`), or compare unfolded values. Worth confirming against the real calendar before investing.
- **Outcome:** **Fixed** (`ee7da1b`) — new `foldLine()`/`unfoldLines()` helpers fold on write (byte-exact, never splits a multi-octet UTF-8 sequence) and unfold on read, applied to `extractSummary` and the UID-extraction regex. 5 new tests, including a round-trip test against what `insertEvent` actually produces for a long summary.

#### S2 — No direct end-to-end test for AC 7 (behaviour preservation across the migration)
- **Category:** Test Coverage
- **Location:** `tests/unit/db.test.js`, `tests/integration/sync.test.js`
- **Description:** AC 7 is satisfied by composition — the backfill preserves state (`db.test.js:326-371`) and sync behaves correctly on that state (`sync.test.js`) — but no single test migrates a pre-009 database and then asserts a sync makes identical push/skip/delete decisions. `seedPre009Database` is used only by the three backfill tests. The composition is strong, so this is a Suggestion, not a gap that blocks.
- **Recommendation:** One test reusing `seedPre009Database` plus the existing sync mocks would close it directly.
- **Outcome:** **Fixed** (`55ff4de`) — new suite seeds a database at the exact pre-009 schema, upgrades it via the real `initDb()`, and runs the real `runSync()` against the result, covering both the previously-opted-in and previously-opted-out directions. 2 new tests.

#### S3 — Legacy `%`/`_` wildcards in existing `bin_types.summary_match` rows
- **Category:** Correctness
- **Location:** `src/server.js:555` vs `src/migrations/009.sql`
- **Description:** `sanitiseBinTypeInput` strips LIKE wildcards going forward, but 009 does not clean rows already stored, and `BIN_TYPE_JOIN_SQL`'s `LIKE` still honours them — over-matching in the display layer. Sync's `includes()` is unaffected.
- **Recommendation:** A one-line `UPDATE` in a future migration.
- **Outcome:** **Not needed (2026-10-29).** Checked against the real NAS database — no `bin_types.summary_match` row contains `%` or `_`. No cleanup migration required; nothing to fix.
- **Outcome:** **Not fixed — flagged to the user.** A blind cleanup migration risks a `UNIQUE` constraint failure on deploy if any two existing rows happen to strip to the same text, and this session has no visibility into the real NAS data's actual shape to judge that risk. Recommend checking which `bin_types.summary_match` rows (if any) contain `%` or `_` on the live database before deciding whether a cleanup migration is safe to write.

#### S4 — Back up the NAS database before deploying
- **Category:** Operational
- **Description:** 009 is the project's first irreversible migration (two `DROP COLUMN`s). `cp /volume1/docker/bin-calendar/data/bin-calendar.db{,.pre-009}` with the container stopped is cheap insurance no amount of design review can substitute for. Also consider `CREATE INDEX ... ON property_bin_type_opt_ins(bin_type_id)` eventually — the composite PK cannot serve the cascade lookup from `bin_types`, so that path full-scans (irrelevant at current scale).
- **Outcome:** **Not fixed — flagged to the user.** Backing up the real NAS database requires access this session doesn't have; flagged as a manual pre-deploy step.

---

## Positive Observations

- **The hardest part is right.** The two-check gating design (`targetSummary` for opt-in-dependent content, `touchesAnyFlaggedType` for opt-in-independent detection) is subtle and survives all 27 cells of the truth table. The commit message for Task 5 records that strict TDD caught a regression here when the checks were briefly collapsed into one — the tests earned their keep.
- **Migration quality is high.** Statement ordering is deliberate and documented, the backfill is exact in both directions (verified empirically against seeded pre-009 data), and extracting `applyMigration` to wrap DDL plus the `schema_version` insert in one transaction is a real robustness improvement over `main` — appropriate care for the project's first destructive migration.
- **No N+1.** Flagged bin types and opt-in rows are fetched once per run, not per property, with a test pinning that invariant.
- **Security discipline held.** All SQL parameterised, placeholders generated rather than interpolated, and every user-data interpolation in the new frontend templates correctly escaped.
- **The drive-by NUL-byte fix was handled correctly** — isolated in its own commit, clearly labelled, with its pre-existing origin verifiable (and verified).
- **Task discipline:** seven commits mapping one-to-one onto the Design's work breakdown, each with tests, each leaving the suite green.

---

## Action Items

### Immediate Fixes (block merge)
- [x] **C1:** Distinguish "bin types unavailable" from "no flagged bin types"; omit `opted_in_bin_type_ids` from the PUT when unloaded; add a regression test — `13dd276`
- [x] **M1:** Require `touchesAnyFlaggedType` before treating an empty `targetSummary` as fully withheld — `77a1fb5`
- [x] **M2:** Move the events prune inside the `try`; scope it and `purgeOldRecords` for scoped runs — `77a1fb5`
- [x] **M3:** Validate/dedupe `opted_in_bin_type_ids` at the boundary; 404 the PUT for an unknown property; stop leaking raw SQLite messages — `bb1b6b0`
- [x] **M4:** Give `.toast-info` an opaque background — `5f31a2c`
- [x] **M5:** Stack concurrent toasts (or suppress the redundant 'Property updated') — `5f31a2c`
- [x] **M6:** Re-render property accordions after bin-type mutations — `13dd276`

### Post-merge improvements
- [x] m1: Confirm `bin_types.is_garden_waste` count on the NAS before deploying — **checked (2026-10-29): `{ n: 1 }`, expected state, backfill is exact**
- [x] m2, m7: Branch on `overallStatus: 'skipped'`/`'success'` rather than prose matching and a catch-all `else` — `7b5b85f`
- [x] m3, m4: Clearer messaging for deferred scoped syncs and unknown properties — `929bd37`, `bb1b6b0`
- [x] m5, m6: Stop renormalizing untouched summary text; reject bin-type Match text that spans an "and" boundary — `070e66d`, `a2b5161`
- [x] m8: Focus restoration and focus trap on the modal; accessible name for the switch group — `929bd37`
- [x] m9: XSS regression test; tests for C1/M6; tighten two assertions — `593ca81`
- [x] m10: Delete dead code and the stale comment — `6cc9ff3`
- [x] S1: iCloud SUMMARY folding — implemented defensively (fold-on-write/unfold-on-read, fully testable without a live server) rather than deferred — `ee7da1b`
- [x] S2: End-to-end migration-behaviour test — `55ff4de`
- [x] S3: Wildcard cleanup migration — **not needed (2026-10-29): checked the real NAS database, no `bin_types.summary_match` row contains `%` or `_`**
- [ ] S4: NAS backup before deploy — **operational, still outstanding; back up `/volume1/docker/bin-calendar/data/bin-calendar.db` before this is deployed, since migration 009 is the first irreversible one (two `DROP COLUMN`s)**

---

## Checklist

- [x] All acceptance criteria from the full issue hierarchy verified by reading actual code
- [x] Every changed file read and audited
- [x] Tests cover happy path, error paths, and edge cases — error-path gaps (C1, M6, XSS) now covered
- [x] Lint run — zero errors introduced by this PR
- [x] No security vulnerabilities introduced — SQL parameterised, frontend escaping correct (now regression-tested)
- [x] No performance regressions — N+1 eliminated and pinned by test
- [x] Error handling complete and consistent — M3 (raw SQLite 500s), M2 (orphaned lock), C1 (swallowed fetch error) all fixed
- [x] Logging adequate for debugging production issues
- [x] Code follows existing codebase conventions
- [x] No unnecessary changes outside scope of the issue — the one out-of-scope fix is correctly isolated and justified
