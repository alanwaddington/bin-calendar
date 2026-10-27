# PR #24 Review — Add per-property calendar view page (#23)

**Date:** 2026-10-27
**Author:** alanwaddington
**Branch:** `feature/23-property-calendar-view` → `main`
**State:** Open

---

## Summary

| Item | Result |
|------|--------|
| Overall Assessment | Pass with comments ⚠️ |
| Risk Level | Low–Medium |
| Test Coverage | Gaps identified (backend good; frontend uncovered; endpoint SQL untested) |
| Acceptance Criteria | 71 Met / 72 Total (1 Partially Met) |
| Lint | 5 errors / 0 warnings (0 in diff, 5 pre-existing) |

---

## Issues Reviewed

### Issue Hierarchy

- [#23](https://github.com/alanwaddington/bin-calendar/issues/23) — Add per-property calendar view page (root; contains both `## Analysis` and `## Design` sections inline)
  - No sub-issues (`subIssues` query returned empty — this project appends Analysis/Design to a single issue rather than creating children)
  - No parent issue

> Note: a `#6` reference appears in the PR body but is a false positive — it matched the hex colour `#6b7a99`. Issue #6 (*S2: UI authentication via UI_PASSWORD env var*) is unrelated, though relevant as context: **the app currently has no authentication on any endpoint**, so the new endpoint's lack of auth is consistent with existing architecture, not a regression.

---

## Changed Files Audit

### `src/server.js` (+51 / -9)

| Property | Detail |
|----------|--------|
| Purpose | Adds `GET /api/properties/:id/events`; wraps bin-types POST/PUT in try/catch (carried-in bug fix) |
| Issues | #23 (endpoint); bug fix has no issue |
| Criteria covered | AC9, AC10, AC11, AC25, AC26 |
| Quality | ⚠️ New endpoint has **no try/catch** (see M1). SQL is parameterised; explicit column list excludes credentials; correlated subquery correctly guarantees one `bin_types` row per event |
| Test coverage | 5 new tests in `tests/api/server.test.js` — but all mock the DB, so the SQL never executes (see M2) |

### `public/calendar.js` (+286 / -0, new)

| Property | Detail |
|----------|--------|
| Purpose | The entire calendar view — routing, switcher, grid + agenda renderers, month navigation, empty/error states |
| Issues | #23 |
| Criteria covered | AC1–AC8, AC12–AC24 |
| Quality | Clean separation; `buildMonthMatrix` is pure; date handling is string-based throughout (timezone-safe); `escCalHtml`/`escCalAttr` correctly avoid the global-collision hazard — verified no name collisions against any other `public/*.js` global. ⚠️ Stale-response race (m1); `escCalAttr` into a `style` attribute (m2) |
| Test coverage | ❌ **None.** No frontend test harness exists in the repo; `jest.config.js` `collectCoverageFrom: ['src/**/*.js']` excludes `public/` entirely (see M3) |

### `public/style.css` (+156 / -0)

| Property | Detail |
|----------|--------|
| Purpose | `.cal-*` namespaced styles; grid/agenda visibility toggle at the existing 639/640px breakpoint |
| Issues | #23 |
| Criteria covered | AC14, AC15, AC16, AC17, AC19 |
| Quality | ✅ All selectors namespaced `.cal-*`; no `!important` anywhere; no existing rules modified; reuses the breakpoint already used by `.tile-grid` rather than inventing a third. Adds `.cal-monthnav .btn:disabled` because `.btn-secondary` had no disabled state |
| Test coverage | ⚠️ No automated test (CSS); verified by real-browser computed-style checks during `/verify` |

### `public/index.html` (+3 / -0)

| Property | Detail |
|----------|--------|
| Purpose | Calendar nav link, `#view-calendar` container, `calendar.js` script tag |
| Issues | #23 |
| Criteria covered | AC1, AC2, AC5 |
| Quality | ✅ Script order is safe — `calendar.js` loads after `app.js`, and all cross-file calls happen post-`DOMContentLoaded` regardless |
| Test coverage | ⚠️ No test (markup) |

### `public/app.js` (+1 / -1)

| Property | Detail |
|----------|--------|
| Purpose | Adds `'calendar'` to the `navigate()` view whitelist |
| Issues | #23 |
| Criteria covered | AC1 |
| Quality | ✅ Minimal, correct. This was the design's flagged silent-failure risk (R1) — omitting it would redirect to dashboard with no error |
| Test coverage | ⚠️ No test |

### `public/dashboard.js` (+2 / -2)

| Property | Detail |
|----------|--------|
| Purpose | `navigateToProperty()` now targets the calendar instead of Settings |
| Issues | #23 |
| Criteria covered | AC3 |
| Quality | ✅ Function name/signature preserved, so the inline `onclick` at line 116 keeps working. Pre-existing `escHtml`/`escAttr` duplication correctly left untouched (out of scope) |
| Test coverage | ⚠️ No test |

### `tests/api/server.test.js` (+111 / -0)

| Property | Detail |
|----------|--------|
| Purpose | 5 endpoint tests + 2 tests for the carried-in bin-types duplicate fix |
| Issues | #23 |
| Criteria covered | AC26 |
| Quality | ⚠️ Follows `MethodName_Scenario_ExpectedResult` and AAA correctly, but the de-dup test asserts on **SQL text** (`toMatch(/LIMIT 1/i)`) rather than behaviour (see M2) |
| Test coverage | N/A (is the test) |

### `tests/unit/sync-cache.test.js` (+2 / -2)

| Property | Detail |
|----------|--------|
| Purpose | Replaces a hardcoded absolute date with the file's own relative `getFutureDate(30)` helper |
| Issues | None (pre-existing failure, unrelated to #23) |
| Criteria covered | AC27 |
| Quality | ✅ Correct root-cause fix — the hardcoded `2026-06-15` had aged past `cacheEvents()`'s today→+6mo window, inserting zero rows. Now immune to date drift |
| Test coverage | N/A (is the test) |

### `eslint.config.js` (+86 / -0, new) · `package.json` (+4 / -1) · `package-lock.json` (+909 / -0)

| Property | Detail |
|----------|--------|
| Purpose | Introduces ESLint (flat config) and a `lint` script; no linter previously existed |
| Issues | None (tooling) |
| Criteria covered | AC28 (confirms devDependencies only — no runtime deps) |
| Quality | ⚠️ Lint script exits non-zero out of the box (m3); `no-undef` + `no-unused-vars` disabled for `public/**` (m4) |
| Test coverage | N/A (config) |

### `README.md` (+2 / -0)

| Property | Detail |
|----------|--------|
| Purpose | Feature bullet + new endpoint row in the API table |
| Issues | #23 |
| Criteria covered | "README reflects the new view" |
| Quality | ✅ Accurate. ⚠️ Adjacent row still says *"Update label and UPRN"* for `PUT /api/properties/:id` — stale since #21/#22 replaced UPRN with `ics_url` (S2, pre-existing) |
| Test coverage | N/A (docs) |

---

## Acceptance Criteria Verification

Verified independently by reading code — **checkbox state in the issue was not trusted**. Note AC15–AC17 are currently *unticked* in the issue but are in fact met: they were confirmed in a real headless-Chromium run (computed `display` values and `scrollWidth === clientWidth` at 1280px and 375px). The checkboxes are simply stale.

### #23 — Original issue criteria

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| 1 | Calendar page accessible via SPA router, switching between properties | `app.js:19`, `calendar.js:1,46-75` | Manual/browser | ✅ Met |
| 2 | Displays uplift days per property, colour-coded | `calendar.js:215-247`, `server.js:96-105` | `server.test.js:440` | ✅ Met |
| 3 | Clicking a property box opens that property's calendar | `dashboard.js:201-204`, `calendar.js:30-35` | Manual/browser | ✅ Met |
| 4 | All DB-sourced data escaped, no unescaped `innerHTML` | `calendar.js:280-286` + all call sites | Manual (code read) | ✅ Met |
| 5 | `navigateToProperty` → Settings preserved or deliberately replaced | `dashboard.js:201-204` (replaced) + `calendar.js:111-114` (route back) | Manual/browser | ✅ Met |
| 6 | New endpoints covered by tests, coverage ≥80% | `server.test.js:440-517` | 182/182 pass, 96.81% | ✅ Met |

### #23 — `## Analysis` criteria (AC1–AC28)

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| AC1 | Reachable at `#calendar`, doesn't fall back to dashboard | `app.js:19` | Browser-verified | ✅ Met |
| AC2 | Top-nav link works, incl. zero properties | `index.html:24`, `calendar.js:25-28` | Browser-verified (route-intercepted) | ✅ Met |
| AC3 | Tile click preselects that property | `dashboard.js:202`, `calendar.js:30-32` | Browser-verified | ✅ Met |
| AC4 | "Property settings" opens that property's settings | `calendar.js:111-114`, consumed `properties.js:30-33` | Browser-verified | ✅ Met |
| AC5 | Active nav link highlighted consistently | `app.js:20-22` (generic), `index.html:24` | Browser-verified | ✅ Met |
| AC6 | Switcher lists all properties, one shown at a time | `calendar.js:51-57` | Browser-verified | ✅ Met |
| AC7 | Property change re-renders without reload | `calendar.js:77-109` | Browser-verified (hash unchanged) | ✅ Met |
| AC8 | Switcher hidden with exactly one property | `calendar.js:47,51,57` (omitted from DOM) | Browser-verified | ✅ Met |
| AC9 | Exactly one marker per collection, no duplicates | `server.js:88-93` (correlated subquery) | `server.test.js:478` ⚠️ SQL-text only | ✅ Met (impl) |
| AC10 | Marker shows lowest-`id` rule's label and colour | `server.js:89-93`, `calendar.js:215-223` | `server.test.js:478` ⚠️ | ✅ Met |
| AC11 | No match → raw summary + `#6b7a99` | `server.js:101-103` | `server.test.js:500` | ✅ Met |
| AC12 | Bin type identifiable from text, not colour alone | `calendar.js:216-222` (label always rendered) | Browser-verified | ✅ Met |
| AC13 | `YYYY-MM-DD` lands on exactly that day, no off-by-one | `calendar.js:122-124,236-237` (pure string/int) | Browser-verified (day-1 cell) | ✅ Met |
| AC14 | Past days de-emphasised | `calendar.js:241,269`; `style.css` `--past` rules | Browser-verified | ✅ Met |
| AC15 | Month grid at desktop widths | `style.css` `.cal-grid`; media query | Browser-verified (`display:grid` @1280) | ✅ Met |
| AC16 | Agenda list at narrow widths | `style.css` `@media (max-width:639px)` | Browser-verified (`display:block` @375) | ✅ Met |
| AC17 | No horizontal scroll; existing views unaffected | `.cal-*` namespacing; no existing rules touched | Browser-verified (`scrollWidth===clientWidth` both widths) | ✅ Met |
| AC18 | Opens on current month | `calendar.js:104-106` | Browser-verified | ✅ Met |
| AC19 | Prev/next enabled only with data; disabled not hidden | `calendar.js:187-190` (real `disabled` prop) | Browser-verified | ✅ Met |
| AC20 | Month nav triggers no extra fetch | `calendar.js:170-176` (no `api()` call) | Browser-verified (0 requests over 3 steps) | ✅ Met |
| AC21 | Zero-events empty state, distinguishable from failure | `calendar.js:195-199` | Browser-verified | ✅ Met |
| AC22 | Zero properties → prompt to add one | `calendar.js:25-28,38-44` | Browser-verified | ✅ Met |
| AC23 | Failed fetch surfaces error, never blank | `calendar.js:17-21,92-98` (toast + inline) | Browser-verified | ✅ Met |
| AC24 | All DB strings escaped | `calendar.js:55,217-221,280-286` | Code read | ✅ Met |
| AC25 | Parameterised SQL, no credential fields | `server.js:86,95` (`?` bound), explicit column list | Code read | ✅ Met |
| AC26 | API tests: happy, unknown id, no events, **multi-match de-dup**, ordering | `server.test.js:440-517` | De-dup asserted via SQL regex, not execution | ⚠️ **Partially Met** |
| AC27 | Coverage ≥80%, suite passes | — | 182/182 pass, 96.81% (verified this review) | ✅ Met |
| AC28 | No new runtime deps, no build step | `package.json` (devDeps only) | Verified | ✅ Met |

### #23 — `## Design` per-task criteria

All 38 remaining task-level checkboxes map onto AC1–AC28 above and carry the same verdicts. Specifically verified additionally:

| Criterion | Implementation | Verdict |
|---|---|---|
| Stepping never lands on an empty month while data exists further out (AD8) | `calendar.js:156-176` | ✅ Met (browser: Oct → **Dec**, skipping empty Nov) |
| Property with events in only one month shows both controls disabled | `calendar.js:189-190` | ✅ Met |
| Arriving via nav link (no target) selects first property | `calendar.js:32` (`|| properties[0]`) | ✅ Met |
| Dashboard widget/tiles/sync-health otherwise unchanged (W3) | `dashboard.js` diff is 2 lines, one function | ✅ Met |
| Dashboard, Settings, Logs verified unregressed | No shared CSS/JS modified; suite green | ✅ Met |
| README reflects the new view | `README.md` diff | ✅ Met |

**Summary: 71/72 criteria met. 1 Partially Met (AC26). 0 Not Met.**

---

## Findings

### Critical (must fix before merge)

None.

### Major (should fix)

#### M1 — New endpoint lacks the very error handling this PR adds elsewhere
- **Category:** Reliability
- **Location:** `src/server.js:82-108`
- **Description:** `GET /api/properties/:id/events` has no `try/catch`. If `getDb()` throws, or the query throws (`SQLITE_BUSY` is plausible — the scheduled sync writes to `events` while a user may be viewing the calendar), the exception reaches Express's default handler and returns an **HTML** error page. The frontend's `api()` helper (`public/app.js:10`) calls `res.json()` unconditionally, so the user sees `Unexpected token '<' ...` — precisely the bug commit `c56bf74` in *this same PR* fixes for `/api/bin-types`. The fix was applied to the bin-types routes but not to the new route introduced alongside it.
- **Recommendation:** Wrap the query and mapping in `try/catch` returning `res.status(500).json({ error: err.message })`, matching the pattern now used at `server.js:252-266` and `server.js:292-301`.

#### M2 — The de-duplication test doesn't execute the de-duplication logic
- **Category:** Code Quality / Test Coverage
- **Location:** `tests/api/server.test.js:478-498`
- **Description:** The endpoint's central guarantee — one `bin_types` row per event, lowest `id` wins — lives entirely in SQL. Because `src/db` is fully mocked, that SQL never runs in any test. The test feeds one pre-resolved row, asserts one row comes back (which tests the JS `.map`, not the join), and backstops it with `expect(eventsSql).toMatch(/LIMIT 1/i)` — a string match that would still pass if the subquery were restructured incorrectly, as long as the literal `LIMIT 1` survived. The repo already has real-DB test infrastructure (`tests/helpers/testDb.js`, in-memory SQLite + migrations 001–003, used by `sync-cache.test.js`), so a genuine integration test is readily achievable.
- **Recommendation:** Add an integration test using `createTestDb()`: insert an event whose summary matches two `bin_types` rows, run the endpoint's query, assert exactly one row returns with the lower-`id` rule's label. This is the single highest-value test to add.

#### M3 — No automated coverage for the largest new file; coverage gate cannot see it
- **Category:** Test Coverage
- **Location:** `public/calendar.js` (286 lines), `jest.config.js:4`
- **Description:** There is no frontend test harness in this repo, and `collectCoverageFrom: ['src/**/*.js']` excludes `public/` entirely. The headline "96.81% coverage" is backend-only and would be unchanged if `calendar.js` were deleted. ~17 of the 28 acceptance criteria rest on behaviour that has zero automated regression protection — verified manually (including a real-browser pass), but nothing prevents a future change silently breaking month-stepping, the timezone-safe date handling, or the empty states. The design doc acknowledged this as risk R7; it remains unaddressed.
- **Recommendation:** Not a merge blocker, but worth a follow-up issue. The pure functions (`buildMonthMatrix`, `findNearestMonthWithData`, `getCalendarMonthsWithData`) are trivially unit-testable if extracted or loaded via `jsdom`, and would cover the highest-risk logic cheaply.

### Minor (nice to fix)

#### m1 — Stale-response race when switching properties quickly
- **Category:** Reliability
- **Location:** `public/calendar.js:81-109`
- **Description:** `selectCalendarProperty()` awaits the fetch then assigns `_calEvents = events` with no check that the response still corresponds to the current selection. Switching A → B quickly means two in-flight requests; if A's response lands after B's, the calendar renders A's events while the switcher shows B. The window is small (local network, ~40 rows) but the guard is absent.
- **Recommendation:** Capture a request generation counter (or compare `id !== _calSelectedId` after the `await`) and discard stale responses.

#### m2 — `escCalAttr` is quote-only, and `colour` is interpolated into a `style` attribute
- **Category:** Security (defence in depth)
- **Location:** `public/calendar.js:221,284-286`
- **Description:** `escCalAttr` escapes only `"` and `'` (matching the existing `escAttr`), then the value is injected into `style="background:…"`. Today this is safe because `sanitiseBinTypeInput` (`server.js:244-250`) enforces `/^#[0-9a-fA-F]{6}$/` on every API write, and migration seeds are hardcoded. But the frontend is trusting an invariant enforced elsewhere; any future write path that skips that validation turns this into CSS injection.
- **Recommendation:** Validate client-side before interpolating — e.g. `const safe = /^#[0-9a-f]{6}$/i.test(ev.colour) ? ev.colour : '#6b7a99';`.

#### m3 — The new lint script fails out of the box
- **Category:** Code Quality
- **Location:** `package.json:9`, `eslint.config.js`
- **Description:** ESLint was not previously configured (itself a gap worth noting). Introducing it is a clear improvement, but `npm run lint` immediately exits non-zero with 5 errors — all pre-existing, all in files untouched by this PR (`public/properties.js:139,140`, `tests/unit/db.test.js:22,67`, `tests/unit/google-credentials.test.js:31`). Anyone wiring lint into CI inherits a red gate on day one.
- **Recommendation:** Either fix the 5 pre-existing errors in a separate small PR, or note them explicitly so the first CI integration isn't a surprise.

#### m4 — Lint rules are disabled for exactly the directory that most needs them
- **Category:** Code Quality
- **Location:** `eslint.config.js:77-87`
- **Description:** `no-undef` and `no-unused-vars` are both off for `public/**/*.js`. The reasoning is sound and documented (functions are shared across `<script>` tags and called from inline `onclick=""`, which ESLint can't trace), but the practical result is that the 286-line `calendar.js` gets almost no lint signal — typos in global names, for instance, won't be caught.
- **Recommendation:** Consider declaring the known cross-file globals explicitly in the config's `globals` block instead of disabling `no-undef` wholesale, so genuine typos are still caught.

### Suggestions (optional)

#### S1 — Unbounded events query
- **Category:** Performance / Scalability
- **Location:** `src/server.js:85-95`
- **Description:** No `LIMIT` or pagination, and `events` is never purged (`purgeOldRecords()` trims only `sync_runs`). Growth is ~70 rows/property/year, so a few hundred rows after several years — genuinely fine at household scale, and the single-fetch design is what makes AC20 (no fetch per month) work. Flagged only so it's a conscious choice.

#### S2 — Stale adjacent README row
- **Category:** Documentation
- **Location:** `README.md:167`
- **Description:** `PUT /api/properties/:id | Update label and UPRN` — UPRN was replaced by `ics_url` in #21/#22. Pre-existing, but it sits directly adjacent to a line this PR edited.

#### S3 — Empty-month messaging differs between variants
- **Category:** Code Quality (UX consistency)
- **Location:** `public/calendar.js:258-261` vs `226-247`
- **Description:** When the viewed month has no collections, the agenda renders "No collections this month." while the grid renders silently-empty cells. Defensible (an empty grid is self-explanatory; an empty agenda would look broken), but worth a conscious decision.

---

## Positive Observations

- **The correlated-subquery approach is the right call.** Rather than copying `/api/next-collection`'s `LEFT JOIN ... LIKE` (which fans out into duplicate rows on multi-match), the new endpoint resolves the winning `bin_types.id` in a subquery and joins on equality — making "one marker per event" a structural guarantee rather than a convention. The pre-existing fan-out bug was correctly left for a separate issue rather than scope-crept into this PR.
- **Timezone handling is genuinely careful.** Dates are matched by exact `YYYY-MM-DD` string equality end to end; grid cells are built from integer y/m/d via `calDateStr()`, and `new Date()` is only ever called with numeric arguments — never parsing an ISO string. This avoids the UTC-midnight off-by-one that is the classic failure in calendar code, and it's documented at the point of use.
- **The `escCalHtml`/`escCalAttr` naming avoids a real hazard.** `escHtml`/`escAttr` are already declared twice globally (`dashboard.js`, `properties.js`); a third declaration would silently win or lose by script order. Verified by scan: no new global in `calendar.js` collides with any existing one.
- **CSS is well-contained.** Every selector is `.cal-*` namespaced, no `!important` anywhere in the file, no existing rule modified, and the responsive toggle reuses the 639/640px breakpoint already used by `.tile-grid` rather than inventing a third. The dual-render + CSS-toggle approach means no resize listener is needed — consistent with a codebase that has none.
- **Real runtime verification was performed**, including headless-browser computed-style checks at both breakpoints and a confirmed gap-month skip (Oct → Dec) — unusually strong evidence for a frontend change in a repo with no frontend tests.
- **Two unrelated pre-existing bugs were fixed properly rather than worked around**: the bin-types duplicate-match HTML-error leak (with tests), and the stale hardcoded date in `sync-cache.test.js` (root-caused to date drift, fixed using the file's own relative helper).
- **ESLint introduced** where no linter previously existed.

---

## Action Items

### Immediate Fixes (block merge)

None — no Critical findings.

### Should fix before merge

- [ ] M1: Add `try/catch` to `GET /api/properties/:id/events` so DB errors return JSON, not an HTML 500
- [ ] M2: Add a real-DB integration test for the multi-match de-duplication using `tests/helpers/testDb.js`

### Post-merge improvements

- [ ] M3: Frontend test harness / unit tests for `calendar.js` pure functions — create issue via `/analyse`
- [ ] m1: Guard against stale responses when switching properties
- [ ] m2: Client-side hex validation before interpolating `colour` into `style`
- [ ] m3: Fix the 5 pre-existing lint errors (separate PR)
- [ ] m4: Declare `public/` globals explicitly rather than disabling `no-undef`
- [ ] S2: Correct the stale `PUT /api/properties/:id` README row

---

## Checklist

- [x] All acceptance criteria from the full issue hierarchy verified by reading actual code
- [x] Every changed file read and audited
- [ ] Tests cover happy path, error paths, and edge cases — **backend endpoint yes; SQL de-dup and all frontend behaviour no** (M2, M3)
- [x] Lint run — zero errors introduced by this PR (5 pre-existing, outside the diff)
- [x] No security vulnerabilities introduced (m2 noted as defence-in-depth only)
- [x] No performance regressions
- [ ] Error handling complete and consistent — **M1: new endpoint missing try/catch applied elsewhere in this PR**
- [x] Logging adequate for debugging production issues
- [x] Code follows existing codebase conventions
- [x] No unnecessary changes outside scope of the issue (ESLint and the two bug fixes are justified and separately committed)
