# PR #29 Review — Remove redundant Property settings button from calendar page

**Date:** 2026-10-28
**Author:** alanwaddington
**Branch:** `fix/remove-redundant-property-settings-button` → `main`
**State:** Open

---

## Summary

| Item | Result |
|------|--------|
| Overall Assessment | Pass with comments ⚠️ |
| Risk Level | Low |
| Test Coverage | Gap identified (see m2) — note coverage tooling does not measure `public/**` at all |
| Acceptance Criteria | 4 Met / 4 Total — derived criteria, see note |
| Lint | 0 errors / 0 warnings (0 in diff, 0 pre-existing) — but see m1, which lint *cannot* catch by construction |
| Tests | 232 passed / 232 total, 16 suites |
| CI | `test` SUCCESS, `build` skipped (non-main) — run predates PR #30's merge to main, see Findings |
| Mergeable | MERGEABLE / CLEAN (branch is 2 commits behind `main`; no file overlap) |

---

## Issues Reviewed

### Issue Hierarchy

**None.** No `#NNN` reference appears in the PR title, body, branch name, or the single commit (message headline or body). Verified:

```
gh pr view 29 --json title,body,headRefName,commits | grep -o "#[0-9]\+"   → no matches
```

This is an ad-hoc bug-fix/cleanup branch raised directly from a user request, which is now an explicitly documented path: CLAUDE.md's "Exception — small, ad-hoc bug fixes" (added in PR #27) permits a `fix/<short-description>` branch with no tracked issue. **This PR is the first to use that exception since it was written, and it conforms to it** — correct branch prefix, strict scope, `/pr-reviewer` run before merge.

**Consequence for this review:** the criteria below are *derived* from the user's request, not authoritative project ACs. The request, verbatim:

> "we probably don't need the 'property settings' button on the calendar page as 'Settings' is already available in the header. The only thing the property settings button adds is landing on the settings page with the current property section expanded, which in real terms adds no real value"

As CLAUDE.md's own exception text warns, self-derived criteria are a weaker check than requirements agreed up front — so findings below are weighted toward what the request *didn't* say rather than confirming what it did.

---

## Changed Files Audit

### `public/calendar.js` (+8 / -18 lines)

| Property | Detail |
|----------|--------|
| Purpose | Removes the "Property settings" button (markup + inline SVG icon) from the calendar header, removes the `goToPropertySettings()` handler, and removes `_calSelectedId` — the module state that existed only to feed that handler. Makes the `.cal-header` wrapper conditional on there being >1 property, since the switcher is now its only child. |
| Issues | None linked |
| Criteria covered | D1, D3, D4 |
| Quality | ✅ Clean removal. `_calSelectedId` was genuinely write-only once the handler went (verified: `grep` across `public/` shows the only remaining references were the declaration and a single assignment — both removed). The ternary relocation from wrapping the switcher to wrapping the whole header is the right call: the old `: '<div></div>'` empty-spacer branch existed solely to hold `justify-content: space-between` apart, and is now meaningless. The explanatory comment on lines 49–52 documents *why* the button is absent — consistent with this codebase's established convention of recording non-obvious decisions inline (cf. `formatMatchedLabel`'s rationale block, `eslint.config.js`'s globals rationale). |
| Test coverage | ⚠️ Partially — existing `calendarSwitcher_withSinglePropertyOnly_isEntirelyAbsentFromDom` and `calendarSwitcher_withMultipleProperties_isPresentAndReflectsSelection` still pass and cover the switcher, but nothing covers the **new** conditional `.cal-header` behaviour. See **m2**. |

### `public/properties.js` (+0 / -6 lines)

| Property | Detail |
|----------|--------|
| Purpose | Removes the `_settingsTargetPropertyId` consumption block from `loadSettings()` — the receiving half of the calendar→settings handoff, which pre-expanded the target property's accordion. |
| Issues | None linked |
| Criteria covered | D3 |
| Quality | ✅ Correct and complete. With `goToPropertySettings()` gone there is no remaining producer of `window._settingsTargetPropertyId` anywhere in the repo (verified by repo-wide grep), so this block was unreachable — removing it is the right call, not scope creep. Critically, `toggleAccordion` is **not** orphaned by this: it retains two live call sites (`properties.js:302`, `:573`) for normal user-initiated accordion toggling. `loadSettings()` is now a clean render with no post-render side effects. |
| Test coverage | ✅ No test existed for this block before or after (there is no `properties.js` frontend test file at all) — not a regression introduced here, and the removed code was provably dead. |

### `tests/unit/calendar-frontend.test.js` (+1 / -16 lines)

| Property | Detail |
|----------|--------|
| Purpose | Deletes `goToPropertySettings_setsSettingsTargetToCurrentlySelectedPropertyAndNavigates` (the test for the removed behaviour) and updates one comment that named `_calSelectedId` by symbol. |
| Issues | None linked |
| Criteria covered | D4 |
| Quality | ✅ The test deletion is legitimate — the behaviour it covered was deliberately removed, so this is not a test weakened to make code pass. The comment fix is a genuine catch: it referenced a symbol that no longer exists, and was correctly generalised rather than left to rot. The sibling `navigateToProperty_...` test (dashboard→calendar, the *opposite* handoff) is correctly left untouched. |
| Test coverage | N/A (is the test) |

**Not changed, and should have been:** `eslint.config.js` — see **m1**.

---

## Acceptance Criteria Verification

### Derived criteria (no issue of record — see Issues Reviewed)

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| D1 | The "Property settings" button no longer appears on the calendar page | `public/calendar.js:53-62` (button markup deleted) | No automated test, but verified at runtime: real Chromium, both 1-property and 2-property states, `querySelectorAll('button')` → no match for "Property settings" | ✅ Met |
| D2 | Settings remains reachable without it | `public/app.js:19` nav whitelist and `public/index.html` top nav both unchanged by this PR | Verified at runtime — "Settings" present in top nav in both captured screenshots | ✅ Met |
| D3 | The handler and its handoff state are removed, leaving no orphaned references in application code | `calendar.js` (handler + `_calSelectedId` deleted), `properties.js:24-29` (consumer deleted) | Repo-wide grep: zero remaining references to `goToPropertySettings`, `_calSelectedId`, or `_settingsTargetPropertyId` in any `public/**` or `src/**` file | ✅ Met |
| D4 | The test for the removed behaviour is removed, and the rest of the suite still passes | `tests/unit/calendar-frontend.test.js:356-371` deleted | 232/232 passing, 16 suites, 0 lint errors | ✅ Met |

**Summary:** 4/4 derived criteria met.

**Scoping note, stated explicitly so it can be challenged:** D3 is deliberately scoped to *application code*. `eslint.config.js` does still reference both deleted symbols — I judged that tooling configuration rather than application code, and report it as its own finding (**m1**) rather than failing D3. A reviewer who considers build/lint config part of "no orphaned references" would mark D3 **Partially Met**, which under this command's rules would escalate m1 to Major. I did not take that reading because the stale entries cannot cause a runtime defect; the reasoning is laid out in m1 so the call is visible rather than buried.

---

## Findings

### Critical (must fix before merge)

None.

### Major (should fix)

None.

### Minor (nice to fix)

#### m1 — `eslint.config.js` still declares two globals this PR deleted, silently disabling `no-undef` for them

- **Category:** Code Quality / tooling correctness
- **Location:** `eslint.config.js:65` (`_calSelectedId: 'writable'`), `eslint.config.js:97` (`goToPropertySettings: 'writable'`)
- **Description:** The `publicSharedGlobals` list carries an explicitly documented invariant (`eslint.config.js:49-57`):

  > "every identifier declared anywhere across public/\*.js is listed here — this lets no-undef still catch real typos (any name NOT in this list) while not flagging legitimate cross-file/inline-handler calls. **Regenerate by grepping top-level `function`/`let`/`const` declarations across public/\*.js if a new one is added.**"

  This PR deleted the `_calSelectedId` declaration and the `goToPropertySettings` function but left both entries in the list, so the invariant no longer holds. Because `no-unused-vars` is deliberately **off** for `public/**` (lines 183) and `no-undef` is the only remaining net, the practical effect is that ESLint now actively vouches for two symbols that do not exist.

  This is not theoretical — I verified it by appending a function calling both to `public/dashboard.js` and running ESLint on it:

  ```
  function __probeRemovedSymbols() {
    goToPropertySettings();      // deleted by this PR
    return _calSelectedId;       // deleted by this PR
  }
  ```
  ```
  $ npx eslint public/dashboard.js
  (no output — clean pass)
  ```

  So a future call to either symbol — exactly the mistake this config was written to catch — would ship as a latent `ReferenceError` with a green lint. (Probe reverted; working tree confirmed clean afterwards.)

  **Why Minor and not Major:** it cannot cause a defect in the code as it stands today, and the trigger requires someone to write a fresh reference to a symbol that no longer appears anywhere in the codebase. It is a weakened safety net, not a live fault. It is nonetheless squarely attributable to this PR and is a two-line fix.
- **Recommendation:** Delete both lines from `publicSharedGlobals`. Given this list has now drifted twice (see Suggestions for the other direction), consider the config's own "regenerate by grepping" note as a candidate for a small script or a CI check that diffs the list against actual top-level declarations in `public/*.js` — a hand-maintained mirror of the codebase will keep drifting silently, because by design nothing fails when it is wrong.

#### m2 — The new conditional `.cal-header` rendering has no test

- **Category:** Code Quality / test coverage
- **Location:** `public/calendar.js:53-62`
- **Description:** This PR is mostly deletion, but one part is genuinely *new logic*: `.cal-header` used to be rendered unconditionally and is now conditional on `_calProperties.length > 1`. No test asserts it. Confirmed conclusively:

  ```
  $ grep -rn "cal-header" tests/
  (no hits)
  ```

  The nearest existing test, `calendarSwitcher_withSinglePropertyOnly_isEntirelyAbsentFromDom`, asserts only `expect(window.document.getElementById('cal-property-select')).toBeNull()` — which would still pass if an empty `<div class="cal-header"></div>` wrapper were reintroduced, since the `<select>` would remain absent. So nothing locks in the behaviour this PR introduced, and nothing would fail if the button or its wrapper came back.

  CLAUDE.md mandates strict TDD ("Never write production code without a failing test first"). The deletions are reasonably exempt — you do not write a test to delete a feature — but the conditional-wrapper change is added behaviour and falls squarely inside that rule.
- **Recommendation:** One assertion line on the existing single-property test closes it:
  ```js
  expect(window.document.querySelector('.cal-header')).toBeNull();
  ```
  Optionally add the inverse (`not.toBeNull()`) to `calendarSwitcher_withMultipleProperties_isPresentAndReflectsSelection`, plus an assertion that no button labelled "Property settings" renders, to make the removal itself regression-proof.

### Suggestions (optional)

#### S1 — `.cal-header` CSS still describes a two-child layout that no longer exists

- **Category:** Code Quality
- **Location:** `public/style.css:1001-1008`
- **Description:** `.cal-header` retains `justify-content: space-between` and `gap: var(--space-md)`, both of which were there to push the switcher and the (now removed) button to opposite ends. With a single child they are inert — no visual effect, no bug — but they describe an intent that is no longer true, and the next person to touch this rule has to work out which declarations are load-bearing. `margin-bottom`, `display: flex`, `align-items` and `flex-wrap` all remain genuinely useful. The rule is still referenced (`calendar.js:55`), so it should not be deleted.
- **Recommendation:** Optional tidy-up; dropping `justify-content` and `gap` would make the rule say what it now means. Not worth a round-trip on its own — fold it in if m1/m2 are addressed.

#### S2 — Pre-existing: README's first Features bullet still describes UPRN lookup

- **Category:** Documentation
- **Location:** `README.md` — "Fetches ICS files from East Ayrshire Council by UPRN"
- **Description:** **Not attributable to this PR** — noted only because it surfaced while checking whether any documentation described the removed button (none does; the Features entry for the calendar view mentions only the month grid, agenda list, month navigation and property switcher, all still accurate). The UPRN approach was replaced by direct ICS URL entry in PR #22, so this bullet is stale. Out of scope here.
- **Recommendation:** Fix opportunistically in a future docs pass; no action for this PR.

---

## Positive Observations

- **The dead code was chased all the way down, not just to the obvious stopping point.** Removing the button alone would have left `goToPropertySettings()`, `_calSelectedId`, and the entire receiving half of the handoff in `properties.js` as unreachable code. All three went, and the PR description explains why each was safe. Verified independently: zero remaining references repo-wide.
- **The removal was correctly bounded.** The *reverse* handoff (dashboard property-tile → calendar, via `_calendarTargetPropertyId` / `navigateToProperty`) is a separate feature that looks superficially similar and would have been easy to delete by association. It is untouched, and its test is intact.
- **`toggleAccordion` was correctly left alone** — it loses one caller but retains two live ones, so it is not orphaned. Easy thing to over-delete; wasn't.
- **The stale test comment was caught.** The deleted `_calSelectedId` was named in an unrelated test's explanatory comment; that comment was generalised rather than left referencing a symbol that no longer exists. That is the exact class of rot most deletions leave behind — and makes the one that *was* missed (m1) more conspicuous rather than less.
- **Runtime-verified before review.** Both the single- and multi-property states were driven in real Chromium with screenshots, including a probe that the dashboard→calendar handoff still selects the *clicked* property (id=2, not a default-to-first bug) — so D1/D2 rest on observed behaviour, not inference from the diff.
- **Conforms to the lifecycle exception it is the first to use.** Correct `fix/` branch prefix, tightly scoped single commit, `/pr-reviewer` run before merge — exactly the path CLAUDE.md now documents for ad-hoc work.

---

## Action Items

### Immediate Fixes (block merge)

None — no Critical or Major findings. The PR is a correct, well-bounded removal with clean gates.

### Recommended before merge (cheap, same-file)

- [ ] **m1:** Delete `_calSelectedId` and `goToPropertySettings` from `publicSharedGlobals` in `eslint.config.js` (2 lines) — restores the `no-undef` net this PR silently removed
- [ ] **m2:** Add `expect(window.document.querySelector('.cal-header')).toBeNull();` to the single-property test (1 line) — locks in the new conditional-header behaviour

### Post-merge improvements

- [ ] **m1 (follow-up):** Automate or CI-check the `publicSharedGlobals` list against actual `public/*.js` declarations — create issue via `/analyse`
- [ ] **S1:** Drop the now-inert `justify-content` / `gap` from `.cal-header`
- [ ] **S2:** Pre-existing — refresh the stale UPRN line in README's Features list

---

## Checklist

- [x] All acceptance criteria from the full issue hierarchy verified by reading actual code — *hierarchy is empty (permitted ad-hoc exception); 4 derived criteria verified against code and runtime instead*
- [x] Every changed file read and audited (3 of 3, read in full, not just the diff)
- [x] Tests cover happy path, error paths, and edge cases — *gap at the new conditional-header behaviour (m2); deletions otherwise correctly covered*
- [x] Lint run — 0 errors, 0 warnings, none introduced. *Caveat: m1 is a defect lint cannot detect by construction, since it lives in the lint config itself*
- [x] No security vulnerabilities introduced — pure markup/code removal; no new input path, no new interpolation, no change to escaping
- [x] No performance regressions — strictly less markup generated and less module state retained
- [x] Error handling complete and consistent — no error paths touched; `selectCalendarProperty`'s stale-response guard and error branches are unchanged
- [x] Logging adequate for debugging production issues — no failure mode added or removed
- [x] Code follows existing codebase conventions — inline rationale comment, template-literal rendering, `escCalHtml` escaping, test naming all consistent
- [x] No unnecessary changes outside scope — 3 files, all on the single code path; the adjacent reverse handoff deliberately untouched
