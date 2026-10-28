# PR #31 Review — Correctly render multi-uplift days (multi-day spans and combined summaries)

**Date:** 2026-10-28
**Author:** alanwaddington
**Branch:** `fix/expand-multiday-span-events-across-calendar` → `main`
**State:** Open

---

## Findings Resolution (post-review)

**S1 fixed** at the user's explicit request; **M1, M2, S2 not yet addressed** — the user asked specifically for S1, not "fix all findings," so those remain open.

| Finding | Outcome | Commit |
|---|---|---|
| S1 (duplicated full summary on every fan-out marker) | **Fixed** — added `splitSummarySegments()`/`attributeSummarySegment()` (`src/server.js:115-138`); each fan-out row's label is now computed from just its own segment of an "X and Y"-combined summary, not the whole string. Both `SELECT`s now also fetch `bt.summary_match` so each row knows which segment it owns (`:195`, `:376`) | `e2a7098` |
| M1 (byte-for-byte duplicate markers, same-label rules) | Not addressed | — |
| M2 (unbounded `end_date` → 355k-row expansion) | Not addressed | — |
| S2 (no test for compound span × fan-out) | Not addressed | — |

**Verified against the real feed, not just the recommendation's hypothetical:** confirmed the "X and Y" summary is always a literal concatenation of two complete standalone summaries with `" and "` — both halves of the real example appear verbatim elsewhere in the same feed as their own single-day entries, and the `+food only after transition week` qualifier never appears near a standalone `Garden waste` entry. That let the fix be exact rather than heuristic. Confirmed live: `GET /api/properties/:id/events` now returns `label: "Garden Waste"` (no qualifier) and `label: "general waste+food (+food only after transition week)"` (keeps its own qualifier) as two separate rows for the real Nov 26 event, and a real Chromium screenshot of the Calendar page shows the same.

The implemented fix goes slightly beyond S1's own recommendation text (which suggested showing just each match's bare `bin_types.label`, dropping the caveat entirely) — segment-attribution keeps the caveat on the half it actually belongs to instead of discarding it, which better satisfies the "never lose information" principle S1 itself flagged as being in tension with the simpler recommendation.

Re-verified after the fix: 249/249 tests passing (was 241/241 — 8 new), 0 lint errors/warnings, same coverage profile.

---

## Summary

| Item | Result |
|------|--------|
| Overall Assessment | Pass with comments ⚠️ |
| Risk Level | Medium |
| Test Coverage | Gaps identified (see M1, M2) |
| Acceptance Criteria | 6 Met / 6 Total — derived criteria, see note |
| Lint | 0 errors / 0 warnings (0 in diff, 0 pre-existing) |
| Tests | 241 passed / 241 total, 16 suites |
| CI | `test` SUCCESS, `build` skipped (non-main) |
| Mergeable | MERGEABLE / CLEAN |

Both stated fixes work correctly and are well-evidenced. Two **Major** findings are regressions/risks introduced *alongside* the correct behaviour, not failures of it — both have cheap fixes and both were reproduced live against a running server.

---

## Issues Reviewed

### Issue Hierarchy

**None of record for this PR.** `#23` and `#27` appear in commit bodies, but as historical references, not as issues this PR implements:

- **#23** — "Add per-property calendar view page" — a real, **CLOSED** issue (the original `/analyse`→`/design`→`/develop` lifecycle feature). Cited only in the context "already a deliberate, tested design from #23/PR24".
- **#27** — a **MERGED PR**, not an issue. Cited because this PR deliberately reverses the mechanism its M2 finding introduced.

This is an ad-hoc `fix/*` branch under CLAUDE.md's documented exception (added in PR #27, first exercised in PR #29). Criteria below are therefore *derived* from the PR's own claims and the user's reported symptom, which — as that exception's own text warns — is a weaker check than requirements agreed up front. Findings below are weighted accordingly toward what the PR *didn't* say.

---

## Changed Files Audit

### `src/server.js` (+68 / -16 lines)

| Property | Detail |
|----------|--------|
| Purpose | (1) Adds `expandDateRange()` and wires it into both read endpoints so a multi-day ICS span renders on every day it covers; widens `/api/next-collection`'s `WHERE` clause and offsets its SQL-computed `days_until` per expanded day. (2) Reverts `BIN_TYPE_JOIN_SQL` from a lowest-id-wins correlated subquery to a plain fan-out join, so a summary matching several `bin_types` rules yields one row per match. |
| Issues | None linked |
| Criteria covered | D1–D6 |
| Quality | Mostly strong — see below. Two Major findings (M1, M2) both originate here. |
| Test coverage | 6 new real-DB tests + 5 new API tests; gaps at the same-label fan-out case (M1) and unbounded spans (M2). |

Specific observations:

- **`expandDateRange` defensive fallbacks are genuinely solid.** `!endDate` → `[startDate]`; `end <= start` → `[startDate]`. I drove all three malformed shapes (null, equal, backwards) through the live API — each returned exactly one row, no crash, no loop. The `end <= start` guard in particular is what stops a backwards date from looping forever.
- **The `days_until` offsetting is a good call.** Rather than reimplementing day-diffing in JS, it keeps SQL's `julianday` computation for day 0 and adds the array index. Correct by construction (`date = start + i`, so `days_until = (start − today) + i = date − today`), and it leaves the pre-existing `getNextCollection_daysUntilSql_usesDateNowNotNow` test valid and untouched.
- **`bt.id ASC` added to both `ORDER BY` clauses** makes fan-out marker order deterministic rather than join-order-dependent. Correct, and necessary once fan-out returns >1 row. No NULL-ordering concern: a LEFT JOIN yields either one all-NULL row or N non-NULL rows for a given event, never a mix.
- **Both endpoints kept consistent** — which was PR #27 M2's actual concern. That concern still holds under the reversal: they now both fan out rather than both deduplicating.

### `tests/unit/calendar-events.test.js` (+107 / -5 lines)

| Property | Detail |
|----------|--------|
| Purpose | 4 span-expansion tests (expansion, no-op on normal/null-end-date, sort-correctness when a span overlaps a later single-day event), plus rewriting the `"Grey/Blue Mixed Bin"` test from 1 row to 2 and adding a real-DB test using the literal combined-summary feed text. |
| Issues | None linked |
| Criteria covered | D1, D2, D4, D5 |
| Quality | ✅ Real-DB tests against `createTestDb()` and real seeded `bin_types` — exercising the actual SQL, not a mock's idea of it. The sort-correctness test (span overlapping a later single-day event) targets a genuinely non-obvious failure mode that a naive flatMap would have shipped. |
| Test coverage | N/A (is the test) |

⚠️ The rewritten `"Grey/Blue Mixed Bin"` fixture remains synthetic (it appears in neither real feed fetched this session) — pre-existing, flagged previously in PR #29's review, not introduced here. Both fan-out tests use rules with **different** labels; none covers the same-label case (M1).

### `tests/api/server.test.js` (+87 / -10 lines)

| Property | Detail |
|----------|--------|
| Purpose | 3 next-collection span tests (day-zero, already-in-progress, WHERE-clause SQL assertion) plus renaming/rewriting the two SQL-shape assertions that checked for the old dedup subquery. |
| Issues | None linked |
| Criteria covered | D3, D6 |
| Quality | ✅ The already-in-progress test is the important one and it asserts the right thing (date *and* daysUntil both relocated to today, not just presence). Renaming `getPropertyEvents_withMultipleBinTypeMatches_returnsSingleMarkerPerEvent` → `..._withMatchedSummaryMoreSpecificThanLabel_returnsRawSummaryAlone` is a genuine improvement — the old name never described what that mocked test actually asserted. |
| Test coverage | N/A (is the test) |

---

## Acceptance Criteria Verification

### Derived criteria (no issue of record — see Issues Reviewed)

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| D1 | A multi-day span event renders on every day it covers, not just its start date | `src/server.js:128-142`, `:153-155` | `calendar-events.test.js` multi-day span test; verified live (5 real days rendered in Chromium) | ✅ Met |
| D2 | A normal single-day event (`end_date = start_date + 1`) is unaffected | `src/server.js:129,135` guards | `..._withNormalSingleDayEvent_returnsExactlyOneRowNotExpanded`, `..._withNullEndDate_...` | ✅ Met |
| D3 | A span already in progress still surfaces in next-collection, dated/days-until'd for today | `src/server.js:322-323` (WHERE), `:333` (offset) | `getNextCollection_withMultiDaySpanEventAlreadyInProgress_...`; verified live (`daysUntil: 0` for a span started 2 days prior) | ✅ Met |
| D4 | A summary matching multiple `bin_types` rules yields one marker per match | `src/server.js:111` (fan-out join) | `..._withMultipleBinTypeMatches_returnsOneRowPerMatch`, `..._withRealWorldAndCombinedSummary_...`; verified live (2 markers, 2 colours) | ✅ Met |
| D5 | Expansion and fan-out compose (days × matches) | `src/server.js:153-155` flatMap over fanned-out rows | ⚠️ No test — verified live only (3-day span × 2 matches → 6 rows). See S2. | ✅ Met |
| D6 | Both endpoints agree on rows-per-event | Shared `BIN_TYPE_JOIN_SQL` at `:111`, used at `:148` and `:321` | `getPropertyEvents_sqlUsesFanOutJoinNotSingleMatchSubquery`, `getNextCollection_sqlUsesSameFanOutJoinAsPropertyEvents` | ✅ Met |

**Summary:** 6/6 derived criteria met.

**Stated plainly so it can be challenged:** every criterion the PR sets for itself is met, and I verified each at runtime rather than by reading. The two Major findings below are *new problems introduced alongside* that correct behaviour — they do not make any criterion unmet, which is why this is "Pass with comments" rather than "Fail". A reviewer who considers an introduced user-visible duplicate disqualifying would reasonably downgrade this to Fail.

---

## Findings

### Critical (must fix before merge)

None.

### Major (should fix)

#### M1 — Fan-out renders byte-for-byte duplicate markers when two `bin_types` rules share a label

- **Category:** Reliability / UX regression
- **Location:** `src/server.js:111` (`BIN_TYPE_JOIN_SQL`)
- **Description:** The removed correlated subquery made it *structurally impossible* for one event to produce two identical markers. The fan-out join removes that guarantee: any event whose summary contains the `summary_match` of **two rules that share a label and colour** now yields two indistinguishable rows.

  This is not hypothetical. Reproduced live against a running server using the user's **real** feed text and a plausible config:

  ```
  bin_types: {summary_match: "Trolley", label: "General Waste", colour: "#6b7280"}
             {summary_match: "food",    label: "General Waste", colour: "#6b7280"}
  event:     summary "Trolley+food"
  ```
  ```json
  GET /api/properties/1/events
  [ { "uid": "dup-risk", "date": "2026-10-29", "label": "General Waste (Trolley+food)", "colour": "#6b7280" },
    { "uid": "dup-risk", "date": "2026-10-29", "label": "General Waste (Trolley+food)", "colour": "#6b7280" } ]
  ```

  Confirmed user-visible in real Chromium — the Calendar cell for Oct 29 renders the same marker twice:
  ```
  Calendar Oct 29 markers: ["General Waste (Trolley+food)", "General Waste (Trolley+food)"]
  ```

  **And the two surfaces now disagree.** The Dashboard de-dups by `rawLabel` (`dashboard.js:71-76`), so the hero card shows **one** chip for the same data:
  ```
  Dashboard hero chips: ["General Waste (Trolley+food)"]
  ```
  So the app simultaneously tells the user there are two collections (Calendar) and one (Dashboard). That `rawLabel` de-dup was added in PR #27 for an unrelated purpose (collapsing the same bin type across *different properties*) and is now incidentally masking this bug on one surface only.

  **How likely is such a config?** Realistic. The user's own draft `006.sql` (written earlier this session) mapped **two different `summary_match` values to the same label** — `('Trolley', 'General Waste')` and `('waste+food', 'General Waste')`. Those two particular strings don't co-occur in one summary, so that exact pair is safe; but it demonstrates the config shape, and rules are added incrementally through the Settings UI with nothing warning about overlap.
- **Recommendation:** De-duplicate identical matches after the fan-out, keeping distinct ones. Minimal change, in both endpoints' expansion step — collapse rows that are identical in the fields that reach the UI:
  ```js
  const seen = new Set();
  const deduped = expanded.filter(r => {
    const key = `${r.uid}|${r.date}|${r.label}|${r.colour}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  ```
  This preserves the PR's intent exactly (two *different* bin types still produce two markers) while restoring the guarantee that one event never renders the same marker twice. Add a test with two same-label rules — none of the current fan-out tests use one (both use distinct labels), which is precisely why this shipped green.

#### M2 — `end_date` is unvalidated third-party input, and this PR makes it load-bearing: one malformed event → 355,077 rows / 47 MB

- **Category:** Reliability / resource exhaustion
- **Location:** `src/server.js:128-142` (`expandDateRange`), reachable via `src/sync.js:149-152`
- **Description:** `cacheEvents` bounds **`start_date`** to a 6-month window but stores **`end_date` completely unvalidated**, straight from the feed:
  ```js
  if (start < today || start > sixMonthsAhead) continue;   // start_date bounded
  const endDate = event.end ? new Date(event.end).toISOString().slice(0, 10) : null;  // end_date NOT bounded
  ```
  Before this PR that was harmless — `end_date` was written but never read back. **This PR turns it into the loop bound of an unbounded expansion.**

  Reproduced live. A single event with an in-window `DTSTART` and a bogus `DTEND`:
  ```
  start_date 2026-11-01, end_date 2999-01-01
  → GET /api/properties/1/events: 355,077 rows, 47 MB response
  ```
  `/api/next-collection` keeps a *small response* (it filters to one date) but still **allocates and sorts the full 355k-element array on every dashboard load**, because `.flatMap()` materialises everything before `.filter()`/`.sort()` run.

  **Characterised honestly:** I expected this to hang the browser and it did not. `calendar.js` only renders the visible month, so the Calendar page still loaded in ~1.5s. So this is degradation and unbounded memory/bandwidth growth from untrusted input, **not** a crash — real, but Major rather than Critical. Reachability requires a malformed or unusually long `DTEND` from the council's feed, which neither real feed exhibits today; the app does not control that input, and `src/ics.js` passes `entry.end` through with no validation.
- **Recommendation:** Clamp the expansion. One line in `expandDateRange` bounds the blast radius regardless of what the feed sends:
  ```js
  const MAX_SPAN_DAYS = 31;  // generous: the real transition-week span is 5
  for (let t = start, n = 0; t < end && n < MAX_SPAN_DAYS; t += MS_PER_DAY, n++) { … }
  ```
  Better still, also validate `end_date` at ingestion in `cacheEvents` (same place `start_date` is already bounded), so bad data never reaches the database. Worth a test asserting a 10-year span yields a bounded row count.

### Minor (nice to fix)

None beyond the Majors — the edge-case handling I probed (null / equal / backwards `end_date`, compound span×fan-out, fully-past span exclusion, cross-property isolation, complex interleaved sort ordering) all held correctly.

### Suggestions (optional)

#### S1 — Both fan-out markers display the identical full summary text

- **Category:** UX
- **Location:** `src/server.js:159`, rendered at `public/calendar.js:224-234`
- **Description:** For the real combined summary, both markers show the same verbose string under differently-coloured dots:
  ```
  ● Garden waste and general waste+food (+food only after transition week)    (brown)
  ● Garden waste and general waste+food (+food only after transition week)    (grey)
  ```
  This falls out of applying `formatMatchedLabel` per row with the same summary — both labels are *contained* in the summary, so each returns the full text. No information is lost (consistent with the principle established in PR #27), and the colour dots do convey "two bin types", but the duplicated text is visually noisy in a narrow grid cell. Already raised with the user in conversation; recorded here so it isn't lost.
- **Recommendation:** Optional. When a row is one of several matches for the same event, showing just that match's own `bin_types.label` ("Garden Waste" / "General Waste") would read better — but it would drop the `(+food only after transition week)` caveat entirely, which is exactly the information-loss PR #27 was written to prevent. Worth a deliberate decision rather than a drive-by change.

#### S2 — The compound span × fan-out case has no test

- **Category:** Test coverage
- **Location:** `tests/unit/calendar-events.test.js`
- **Description:** Spans and fan-out are each tested in isolation, but no test covers an event that is *both* a multi-day span *and* a multi-rule match. I verified it live (3 days × 2 matches → 6 correctly-ordered rows), but nothing locks that composition in. It's the interaction most likely to break under future refactoring of either half.
- **Recommendation:** One real-DB test asserting `days × matches` row count and ordering.

---

## Positive Observations

- **Both fixes were verified at runtime against two different real council feeds**, not just synthetic fixtures — including a screenshot of the actual rendered calendar. That is why the claims in the PR description hold up under independent re-running.
- **The defensive fallbacks in `expandDateRange` are real, not decorative.** Null, zero-length and backwards date ranges all degrade to a single row. I specifically tried to break them and couldn't — the `end <= start` guard is what prevents the backwards case from looping forever, and it's there deliberately with a comment saying why.
- **The sort-after-expansion problem was spotted and tested.** Flattening expanded days in place would have silently mis-ordered a span that starts before, and extends past, a later single-day event. There's an explicit test for exactly that, which suggests the failure mode was reasoned about rather than stumbled into.
- **`days_until` offsetting preserves the existing SQL computation** instead of reimplementing date arithmetic in JS — smaller change, one less place to get timezone handling wrong, and it keeps an existing test valid untouched.
- **The reversal of PR #27's M2 mechanism was raised and confirmed before implementing**, rather than quietly changing tested behaviour. The commit message explains both what was reversed and why M2's *actual* concern (endpoint consistency) still holds. That is the right way to undo a prior deliberate decision.
- **UTC-based date arithmetic with a stated rationale** — avoids the `new Date('YYYY-MM-DD')` off-by-one trap this codebase has a standing rule about, and the comment explains why UTC is correct server-side (dates originate from `toISOString()` in sync.js) as distinct from `calendar.js`'s local-time convention.
- Clean gates: 241/241 tests, 0 lint errors, 0 warnings, CI green, MERGEABLE/CLEAN.

---

## Action Items

### Immediate Fixes (block merge)

None strictly blocking — but see M1 below, which I would fix before merging.

### Recommended before merge

- [ ] **M1:** De-duplicate identical fan-out rows (same uid/date/label/colour) in both endpoints, and add a test using two same-label `bin_types` rules. This is a user-visible duplicate with a realistic trigger that was impossible before this PR. **Quick way to check your own exposure:** in Settings → Bin Types, look for two rules sharing a Label whose Match strings could both appear in one summary.
- [ ] **M2:** Clamp `expandDateRange` to a maximum span (and ideally validate `end_date` in `cacheEvents` alongside the existing `start_date` bound). One line; removes an unbounded-growth path from untrusted feed input.

### Post-merge improvements

- [ ] **S2:** Add a compound span × fan-out test — create issue via `/analyse`
- [ ] **S1:** Decide deliberately whether multi-match markers should show per-match labels instead of the repeated full summary

---

## Checklist

- [x] All acceptance criteria from the full issue hierarchy verified by reading actual code — *no issue of record (permitted ad-hoc exception); 6 derived criteria verified at runtime, not just by reading*
- [x] Every changed file read and audited (3 of 3, read in full)
- [x] Tests cover happy path, error paths, and edge cases — *gaps at same-label fan-out (M1), unbounded spans (M2), compound composition (S2)*
- [x] Lint run — 0 errors, 0 warnings, none introduced
- [x] No security vulnerabilities introduced — no new input path, parameterised queries throughout, output still escaped at both consumers. M2 is resource exhaustion from malformed upstream data, not an injection or authz issue
- [ ] No performance regressions — **M2 is one**: unbounded expansion allocates per-day rows with no cap; `next-collection` sorts the full array on every dashboard load
- [x] Error handling complete and consistent — malformed date ranges degrade gracefully to a single row (verified for null, equal, backwards)
- [x] Logging adequate for debugging production issues — no new failure mode that warrants logging
- [x] Code follows existing codebase conventions — SQL-fragment constant, comment-the-why style, test naming, UTC/local date rules all consistent
- [x] No unnecessary changes outside scope — 3 files, both commits on the one code path
