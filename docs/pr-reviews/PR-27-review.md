# PR #27 Review — Fix: matched bin-type label drops extra feed info beyond the match

**Date:** 2026-10-27
**Author:** alanwaddington
**Branch:** `fix/bin-type-label-drops-qualifier` → `main`
**State:** Open

---

## Summary

| Item | Result |
|------|--------|
| Overall Assessment | Pass with comments ⚠️ |
| Risk Level | Low |
| Test Coverage | Adequate for the function; gaps at the UI consumers |
| Acceptance Criteria | 5 Met / 6 Total (1 Partially Met) — derived criteria, see note |
| Lint | 0 errors / 0 warnings (0 in diff, 0 pre-existing) |
| Tests | 222 passed / 222 total, 15 suites |
| CI | `test` SUCCESS, `build` skipped (non-main) |
| Mergeable | MERGEABLE / CLEAN |

---

## Issues Reviewed

### Issue Hierarchy

**None.** No `#NNN` reference appears in the PR title, body, branch name, or the single commit message. Verified:

```
gh pr view 27 --json title,body,headRefName | grep -o "#[0-9]\+"   → no matches
git log origin/main..origin/fix/bin-type-label-drops-qualifier      → no matches
```

This was an ad-hoc bug-fix branch raised directly from a user report, not an `/analyse` → `/design` → `/develop` lifecycle issue, so there are no published acceptance criteria to traverse. The same was true of PRs #25 and #26.

**Consequence for this review:** the criteria in the verification section below are *derived* — from the user's original bug report and from the explicit claims the PR body makes about its own behaviour. They are not authoritative project ACs. The honest reading is that this PR has **no acceptance criteria of record**, which is itself noted as finding **m3**.

**Original bug report (verbatim, from the session):**
> "the waste calendar url for my address is `https://api.eu.recollect.net/.../events.en-GB.ics?...` — for today the calendar is showing 'Trolley+Food', what we've downloaded is just showing 'Trolley' so we're missing the 'Food' part, can you investigate"

**User's real `bin_types` row** (supplied as a screenshot of the Settings table):

| Match | Label | Colour |
|---|---|---|
| `Trolley` | `Trolley` | `#6b7280` |

---

## Changed Files Audit

### `src/server.js` (+16 / -3)

| Property | Detail |
|----------|--------|
| Purpose | Adds `formatMatchedLabel(label, summary)` and routes both display endpoints through it, so a matched `bin_types.label` no longer fully replaces the raw ICS summary. |
| Issues | None linked |
| Criteria covered | D1, D2, D3, D4, D6 |
| Quality | Pure function, no DB/IO, single responsibility, correctly exported for direct test. The 8-line comment above it records *why* the naive splice approach was rejected — genuinely useful, and the kind of thing that is normally lost. Both call sites use the identical `r.label ? … : r.summary` guard, so the function is never passed a null `label`. `summary` is `TEXT NOT NULL` (`003.sql:5`), so the unguarded `summary.trim()` cannot throw from DB data. |
| Test coverage | `tests/unit/format-matched-label.test.js` (5 direct cases) + `tests/unit/calendar-events.test.js` (3 real-DB cases) + 3 updated Supertest assertions in `tests/api/server.test.js`. Both call sites are covered. |

Observations on the two call sites:

- `getPropertyEventsRows` (line ~109) joins via the **de-duplicating correlated subquery** (lowest-id rule wins), so exactly one row per event.
- `/api/next-collection` (line ~266) still joins via the **fan-out** `LEFT JOIN bin_types bt ON e.summary LIKE '%' || bt.summary_match || '%'`, so an event matching two rules yields two rows. This divergence is **pre-existing** (introduced in #24, which fixed only the first query) and is not attributable to this PR — but this change makes its symptom more visible. See **M2**.

### `tests/api/server.test.js` (+4 / -4)

| Property | Detail |
|----------|--------|
| Purpose | Updates 4 assertions that encoded the old behaviour (bare `'General Waste'`). |
| Issues | None linked |
| Criteria covered | D5 |
| Quality | ✅ Correctly updated rather than deleted — the surrounding assertions (de-dup `LIMIT 1` SQL check, row shape) are left intact, so the tests still guard what they were written to guard. No test was weakened or skipped to accommodate the change. |
| Test coverage | N/A (is the test) |

### `tests/unit/calendar-events.test.js` (+27 / -1)

| Property | Detail |
|----------|--------|
| Purpose | Adds a real-DB reproduction of the reported bug and a case-insensitive no-duplication guard; updates one pre-existing assertion. |
| Issues | None linked |
| Criteria covered | D1, D3 |
| Quality | ✅ Uses the real `createTestDb()` + real seeded `bin_types` from `003.sql` rather than mocks, so it exercises the actual SQL join and not a stand-in. The comment on the new test names the real-world feed value that motivated it. |
| Test coverage | N/A (is the test) |

⚠️ One accuracy point: the test named `…whenSummaryHasExtraInfoBeyondTheMatch…` carries a comment describing the `"Trolley+food"` / `"General Waste"` scenario, but the data it actually inserts is `'Grey Bin Plus Food'`. It is a valid test of the same code path, but it is not the scenario the comment describes, and nothing in the suite uses the literal reported string against the user's literal config. See **m1**.

### `tests/unit/format-matched-label.test.js` (+24 / -0, new)

| Property | Detail |
|----------|--------|
| Purpose | Direct unit tests for the new function. |
| Issues | None linked |
| Criteria covered | D2, D3, D4, D6 |
| Quality | ✅ Follows `MethodName_Scenario_ExpectedResult` convention exactly. Covers identical / case-differs / whitespace-differs / extra-info / parenthetical-caveat. |
| Test coverage | N/A (is the test) |

**Not changed, and arguably should have been considered:** `public/dashboard.js` and `public/calendar.js` both consume `.label` and are affected by the change in its shape and length (see **M1** and **m2**). No frontend file or frontend test was touched.

---

## Acceptance Criteria Verification

### Derived criteria (no issue of record — see Issues Reviewed)

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| D1 | A matched event whose summary carries extra information beyond the match no longer displays that information stripped | `src/server.js:88-91`, `:109`, `:277` | `calendar-events.test.js:34`, `format-matched-label.test.js:4` | ✅ Met |
| D2 | No information from the raw feed is lost | `src/server.js:90` — appends the **full, unmodified** summary | `format-matched-label.test.js:20` (caveat string survives verbatim) | ✅ Met |
| D3 | No information is fabricated or algorithmically spliced | `src/server.js:88-91` — no substring surgery anywhere | `format-matched-label.test.js:20` | ✅ Met |
| D4 | When the label already fully describes the summary, it is left unchanged (no `X (X)` stutter) | `src/server.js:89` — case- and whitespace-insensitive equality | `format-matched-label.test.js:8,12,16`; `calendar-events.test.js:47` | ⚠️ **Partially Met** — guards only *exact* equality. The user's own config (`Trolley`/`Trolley`) is not an exact match against `Trolley+food` and so renders as **`Trolley (Trolley+food)`**. See **M1**. |
| D5 | Fix applies to every bin type at once, not per-row label maintenance | `src/server.js:109`, `:277` — single function, both display endpoints | `server.test.js:448,503,597` | ✅ Met |
| D6 | Both display surfaces behave consistently | `src/server.js:109` (`/api/properties/:id/events`) and `:277` (`/api/next-collection`) | `calendar-events.test.js` + `server.test.js:597` | ✅ Met |

**Summary:** 5/6 derived criteria met, 1 partially met.

---

## Findings

### Critical (must fix before merge)

None.

### Major (should fix)

#### M1 — The user's actual reported case now renders as a stutter: `Trolley (Trolley+food)`

- **Category:** Code Quality / UX correctness
- **Location:** `src/server.js:88-91`
- **Description:** The no-duplication guard tests **exact** equality after trim/lowercase:
  ```js
  if (label.trim().toLowerCase() === summary.trim().toLowerCase()) return label;
  return `${label} (${summary})`;
  ```
  The user's real configuration is `Match: Trolley` / `Label: Trolley`. Against the feed summary `Trolley+food`, `'trolley' !== 'trolley+food'`, so the guard does not fire and the output is **`Trolley (Trolley+food)`**.

  This is not hypothetical — it is what the deployed app will show this user for the exact event they reported. It was observed directly during verification of this branch: a live headless-browser capture of the Calendar page rendered `Trolley (Trolley+food)` in today's cell, and `/api/next-collection` returned the same string.

  The behaviour is defensible (nothing is lost, and it is strictly better than the bug it replaces) but it is a visibly redundant rendering of the one case that prompted the PR. The user asked to see `Trolley+food`; they will see `Trolley (Trolley+food)`.
- **Recommendation:** Widen the guard from *equality* to *containment*. When the summary already contains the label, the summary wholly supersedes the label and should be shown alone:
  ```js
  function formatMatchedLabel(label, summary) {
    const l = label.trim().toLowerCase();
    const s = summary.trim().toLowerCase();
    if (s === l) return label;             // keep the configured label's casing
    if (s.includes(l)) return summary.trim();  // feed is strictly more specific
    return `${label} (${summary})`;
  }
  ```
  The equality branch must be kept *ahead* of the containment branch: equality is a special case of containment, and collapsing the two would make the exact-match case return the feed's casing instead of the configured label's — breaking `format-matched-label.test.js:12` (`'FOO COLLECTION'` / `'foo collection'` → expects `'FOO COLLECTION'`).

  Check this against the cases the PR body already worked through:
  - `Trolley` / `Trolley+food` → not equal, contained → **`Trolley+food`** ✅ (exactly what was reported as expected)
  - `Garden Waste` / `Garden waste` → equal → `Garden Waste` ✅ (no `Garden Waste waste` splice, configured casing preserved)
  - `FOO COLLECTION` / `foo collection` → equal → `FOO COLLECTION` ✅ (unchanged)
  - `General Waste` / `Trolley+food` → not contained → `General Waste (Trolley+food)` ✅ (unchanged)
  - `General Waste` / `General waste+food (+food only after transition week)` → contained → returns the full caveat string verbatim ✅ (still no fabrication, and clearer than today's doubled-parens output)

  Note what this changes in principle: where the feed is *more specific* than the configured label, the feed wins and the label is suppressed entirely. That is the right call for a feed-driven display, but it is a deliberate inversion of precedence and deserves a conscious yes/no rather than arriving incidentally.

  Test impact — measured by running the proposed function against every existing expectation in the suite, not estimated:

  | Expectation | Under proposal | |
  |---|---|---|
  | `format-matched-label.test.js:4,8,12,16` | unchanged | ✅ |
  | `format-matched-label.test.js:20` (transitional caveat) | → `General waste+food (+food only after transition week)` | ⚠️ needs updating |
  | `calendar-events.test.js:20,34,47` | unchanged | ✅ |
  | `server.test.js:448,597` | unchanged | ✅ |
  | `server.test.js:503` (transitional caveat) | → `General waste+food (+food only after transition week)` | ⚠️ needs updating |

  So the change costs exactly **two** test-expectation updates, both the transitional-caveat case, and both arguably becoming *more* correct — the doubled parens go away while the caveat text still survives verbatim.

#### M2 — `/api/next-collection` can now emit several near-identical long labels for one event, and the dashboard's de-duplication no longer collapses them

- **Category:** Reliability / Code Quality
- **Location:** `src/server.js:266` (query), consumed at `public/dashboard.js:71-76`
- **Description:** Two interacting problems, one pre-existing and one introduced:

  1. *(Pre-existing, from #24)* `/api/next-collection` still uses the fan-out join `LEFT JOIN bin_types bt ON e.summary LIKE '%' || bt.summary_match || '%'`, so an event matching two rules produces two rows. `getPropertyEventsRows` was fixed to use a de-duplicating correlated subquery; this query was not.
  2. *(Introduced by this PR)* `dashboard.js` de-duplicates the hero bin chips **by label string**:
     ```js
     const seenLabels = new Set();
     const uniqueBins = collections.filter(c => { if (seenLabels.has(c.label)) return false; … });
     ```
     That de-duplication previously worked *because* labels were canonical. Two properties collecting on the same date with summaries `Trolley` and `Trolley+food`, both matching one `Trolley` → `General Waste` rule, used to produce `['General Waste', 'General Waste']` → **one** chip. They now produce `['General Waste', 'General Waste (Trolley+food)']` → **two** chips for what the user sees as one bin type.

     The trigger is concrete: the hero filters to all rows sharing `rows[0].date` **across every property** (`src/server.js:272`), so any two properties with a shared collection date and differently-worded summaries hit it. The user runs multiple properties.
- **Recommendation:** Two independent fixes, both small:
  - De-duplicate the hero chips by a stable key rather than the display string — `c.colour` or, better, have the API return the raw matched label alongside the formatted one and key on that. (Adopting **M1** also happens to reduce, but does not eliminate, this case.)
  - Separately, bring `/api/next-collection` onto the same de-duplicating correlated subquery `getPropertyEventsRows` uses, so the two endpoints stop disagreeing about how many rows an event has. Worth its own issue rather than folding into this PR.
- **Note:** neither surface has a test covering the multi-property shared-date case, which is why this passed CI.

### Minor (nice to fix)

#### m1 — Test comment describes a scenario the test does not exercise

- **Category:** Code Quality
- **Location:** `tests/unit/calendar-events.test.js:34-45`
- **Description:** The test `getPropertyEventsRows_whenSummaryHasExtraInfoBeyondTheMatch_appendsRawSummaryInParens` is commented *"East Ayrshire's feed sends 'Trolley+food', but the bin_types label for the 'Trolley' match is just 'General Waste'"* — but it inserts `'Grey Bin Plus Food'` and asserts `'General Waste (Grey Bin Plus Food)'`. It is a correct test of the code path, just not of the documented scenario, and the comment will mislead whoever next reads it. Relatedly, no test in the suite pairs the literal reported summary `Trolley+food` with the user's literal `Trolley`/`Trolley` config — which is precisely the configuration that exposes **M1**. A test at that exact combination would have caught it.
- **Recommendation:** Either seed a `('Trolley', 'General Waste', …)` bin type and use the real `'Trolley+food'` summary so code and comment agree, or reword the comment to describe `'Grey Bin Plus Food'`. Then add a case for `Trolley`/`Trolley` + `Trolley+food` asserting whatever behaviour is settled on in **M1**.

#### m2 — Label length is now unbounded at the UI, and untested there

- **Category:** Code Quality / UX
- **Location:** `public/style.css:1104-1108` (`.cal-marker-label`), `:259-270` (`.hero-bin-chip`)
- **Description:** Labels grow from the length of a configured label to the length of label + summary. The PR's own test asserts a 69-character output as correct:
  `General Waste (General waste+food (+food only after transition week))`.
  Where that lands:
  - **Calendar grid cell** — `.cal-marker-label` has `overflow-wrap: anywhere`, so it wraps rather than overflowing (good, and a pre-existing credit to #24). But a 69-char string in a one-seventh-width grid cell wraps to many lines, making that week's row several times taller than its neighbours. Degraded, not broken.
  - **Dashboard hero chip** — `.hero-bin-chip` is an `inline-flex` pill with no `max-width` and no wrap handling of its own, inside a `flex-wrap: wrap` container. A long chip becomes a very wide pill.

  No frontend test and no visual check covers the long-label case, even though `tests/helpers/browserDom.js` (added in #24) makes jsdom assertions on `calendar.js` straightforward.
- **Recommendation:** Treat as a follow-up, not a merge blocker. Either cap the rendered label at the UI (`max-width` + `text-overflow: ellipsis`, with the full text in a `title` attribute) or cap the appended summary server-side. Add one jsdom case asserting a long label renders without blowing out the cell. Adopting **M1** shortens the common cases but does not bound the worst case.

#### m3 — No issue of record, so no acceptance criteria to verify against

- **Category:** Code Quality / process
- **Location:** N/A
- **Description:** CLAUDE.md mandates the `/analyse` → `/design` → `/develop` → `/pr-reviewer` → `/merge` lifecycle "for all features", and expects branches named `feature/<issue-number>-<description>` referencing an issue number in commits. This branch is `fix/bin-type-label-drops-qualifier` with no issue and no `#NNN` in its commit. Every criterion in this review had to be reverse-engineered from the PR's own description, which means the PR is being graded against its own claims — a materially weaker check than grading it against requirements agreed beforehand. **M1** is a direct symptom: the PR satisfies every claim it makes about itself while still not rendering the reported case the way the reporter expected.
- **Recommendation:** No change to this PR. Worth deciding explicitly whether small user-reported bug fixes are exempt from the lifecycle, and recording that exemption in CLAUDE.md so the gap is intentional rather than incidental. (PRs #25, #26 and #27 have all now bypassed it.)

### Suggestions (optional)

#### S1 — The app and the synced calendars now disagree about event titles

- **Category:** Code Quality
- **Location:** `src/sync.js:143-152`
- **Description:** `sync.js` writes `event.summary` straight through to Google/iCloud — it never consults `bin_types`. So after this change the app shows `General Waste (Trolley+food)` while the user's phone calendar shows `Trolley+food` for the same collection. Not a regression (the two already differed, as the app showed `General Waste`), and the raw feed text in the calendar is arguably the better behaviour. Noting it because the labelling logic now lives in exactly one of the two surfaces, and the natural next request is "make my phone show the nice labels too."
- **Recommendation:** None for this PR. If label consistency across surfaces is wanted later, `formatMatchedLabel` is already a pure, exported function that `sync.js` could reuse.

#### S2 — `formatMatchedLabel` is defined among the route handlers

- **Category:** Code Quality
- **Location:** `src/server.js:88`
- **Description:** The function sits between the `/api/properties/:id/credential-status` handler and `getPropertyEventsRows`, inside the route-definition flow. It is pure display formatting with no Express dependency. Consistent enough with `getPropertyEventsRows` and `sanitiseBinTypeInput`, which are also inline, so this is a pre-existing file-organisation pattern rather than a deviation.
- **Recommendation:** None now. If `server.js` is ever split, the pure formatters/validators are the natural first extraction.

---

## Positive Observations

- **The rejected alternative is documented in the code.** The 8-line comment above `formatMatchedLabel` records why substring splicing was *not* chosen, with the two concrete counter-examples (`Garden waste` double-wording, the transitional parenthetical caveat) that killed it. This is exactly the reasoning that normally evaporates and gets rediscovered the hard way.
- **Correctness over cosmetics on the hard case.** The transitional summary `General waste+food (+food only after transition week)` is the one input where a clever fix would have produced actively misleading output — wrongly implying food was collected that week. The chosen approach yields something verbose (and doubled-parens ugly) but never wrong. That is the right priority order for a bin-collection calendar, where a wrong label means a missed collection.
- **The bug was reproduced before it was fixed.** `getPropertyEventsRows_whenSummaryHasExtraInfoBeyondTheMatch_appendsRawSummaryInParens` was confirmed red against pre-fix code — genuine TDD, not tests retrofitted to passing code.
- **Pre-existing tests were updated, not weakened.** All 4 touched assertions had their expectations corrected while keeping their original guards (the `LIMIT 1` de-dup SQL check, the full row-shape `toEqual`) intact. Nothing was skipped or loosened to make the suite green.
- **Real DB over mocks where it counts.** `calendar-events.test.js` runs against `createTestDb()` with the real `003.sql` seed data, so the SQL join itself is under test, not a mock's idea of it.
- **Both call sites fixed together.** It would have been easy to fix only the calendar endpoint that was reported and leave `/api/next-collection` inconsistent. Both went through one function.
- **Clean gates:** 222/222 tests, 15 suites, 0 lint errors, 0 lint warnings, CI `test` green, MERGEABLE/CLEAN.

---

## Action Items

### Immediate Fixes (block merge)

None block merge — the PR is a strict improvement on the bug it replaces, with clean gates.

### Recommended before merge (one decision needed)

- [ ] **M1:** Decide whether `Trolley (Trolley+food)` is acceptable output for the reported case, or widen the guard from equality to containment so it renders `Trolley+food`. This is a one-line change plus two test-expectation updates, and it is the difference between the reporter getting what they asked for and getting something merely not-wrong. **This is a product decision, not a defect — it needs the user's call, not a unilateral fix.**

### Post-merge improvements

- [ ] **M2:** De-duplicate dashboard hero chips by a stable key rather than the display string — create issue via `/analyse`
- [ ] **M2:** Bring `/api/next-collection` onto the de-duplicating correlated subquery used by `getPropertyEventsRows` — create issue via `/analyse`
- [ ] **m1:** Align the test comment with its data; add a case at the user's literal `Trolley`/`Trolley` config
- [ ] **m2:** Bound rendered label length in the calendar cell and hero chip; add a long-label jsdom case
- [ ] **m3:** Record whether small bug-fix PRs are exempt from the `/analyse` lifecycle in CLAUDE.md

---

## Checklist

- [x] All acceptance criteria from the full issue hierarchy verified by reading actual code — *hierarchy is empty; derived criteria verified against code instead, see m3*
- [x] Every changed file read and audited (4 of 4)
- [x] Tests cover happy path, error paths, and edge cases — *for the function; gaps at the UI consumers (M2, m2)*
- [x] Lint run — zero errors, zero warnings, none introduced by this PR
- [x] No security vulnerabilities introduced — pure string formatting, no new input path, no SQL change, output escaped at both consumers (`escHtml`, `escCalHtml`)
- [x] No performance regressions — one `trim().toLowerCase()` per row, no new queries
- [x] Error handling complete and consistent — `label` guarded at both call sites; `summary` is `TEXT NOT NULL` (`003.sql:5`) so `.trim()` cannot throw on DB data
- [x] Logging adequate for debugging production issues — no new failure mode to log
- [x] Code follows existing codebase conventions — test naming, AAA, CommonJS export, inline-helper placement all consistent
- [x] No unnecessary changes outside scope — 4 files, all on the one code path
