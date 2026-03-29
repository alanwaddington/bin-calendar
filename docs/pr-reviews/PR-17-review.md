# PR #17 Review — Remove getaddress.io integration (#16)

**Date:** 2026-03-29
**Author:** alanwaddington
**Branch:** feature/16-remove-getaddress-integration -> main
**State:** Open

---

## Summary

| Item | Result |
|------|--------|
| Overall Assessment | Pass ✅ |
| Risk Level | Low |
| Test Coverage | Adequate |
| Acceptance Criteria | 12/12 Met |

---

## Issues Reviewed

### Issue Hierarchy
- #16 — Replace getaddress.io address lookup (service permanently closed) (standalone — no parent or sub-issues)

---

## Changed Files Audit

### `src/uprn.js` (+0 / -48 lines) — DELETED

| Property | Detail |
|----------|--------|
| Purpose | Remove dead getaddress.io integration module |
| Issues | #16 (M1) |
| Criteria covered | AC1: `src/uprn.js` is deleted |
| Quality | No issues — clean removal of dead code |
| Test coverage | `tests/unit/uprn.test.js` also deleted (tests for removed module) |

### `src/server.js` (+0 / -29 lines)

| Property | Detail |
|----------|--------|
| Purpose | Remove `require('./uprn')` import, remove `addressLookupConfigured` from `/api/config`, remove 2 UPRN endpoints |
| Issues | #16 (M2, M3) |
| Criteria covered | AC2: `/api/uprn/lookup` removed, AC3: `/api/uprn/detail` removed, AC4: `addressLookupConfigured` removed from config |
| Quality | No issues — clean surgical removal, no orphaned code |
| Test coverage | `server.test.js:134` asserts `not.toHaveProperty('addressLookupConfigured')` |

### `public/properties.js` (+1 / -36 lines)

| Property | Detail |
|----------|--------|
| Purpose | Remove postcode search UI block, `hasLookup` variable, `addPropLookup()` function; add UPRN hint text |
| Issues | #16 (M4, M5, S1) |
| Criteria covered | AC5: postcode search absent, AC6: UPRN input present, AC7: hint text added |
| Quality | No issues — hint text follows existing inline style convention (`font-size:12px;color:var(--text-3)`) |
| Test coverage | UI — no automated tests (manual verification) |

### `tests/unit/uprn.test.js` (+0 / -105 lines) — DELETED

| Property | Detail |
|----------|--------|
| Purpose | Remove unit tests for deleted `uprn.js` module |
| Issues | #16 (M6) |
| Criteria covered | AC8: `tests/unit/uprn.test.js` deleted |
| Quality | No issues |
| Test coverage | N/A — test file itself |

### `tests/api/server.test.js` (+1 / -72 lines)

| Property | Detail |
|----------|--------|
| Purpose | Remove `jest.mock` and `require` for `uprn`, remove 8 UPRN endpoint tests, update config test assertion |
| Issues | #16 (M7) |
| Criteria covered | AC9: 8 UPRN endpoint tests removed |
| Quality | No issues — mock/require cleanly removed, config assertion correctly updated to `not.toHaveProperty` |
| Test coverage | N/A — test file itself |

### `docker-compose.yml` (+0 / -1 lines)

| Property | Detail |
|----------|--------|
| Purpose | Remove `GETADDRESS_API_KEY` environment variable |
| Issues | #16 (M8) |
| Criteria covered | AC10: `GETADDRESS_API_KEY` removed from `docker-compose.yml` |
| Quality | No issues |
| Test coverage | N/A — config file |

### `.env.example` (+0 / -3 lines)

| Property | Detail |
|----------|--------|
| Purpose | Remove `GETADDRESS_API_KEY` and its comment |
| Issues | #16 (M8 — extended cleanup) |
| Criteria covered | AC12 (codebase-wide: no remaining references) |
| Quality | No issues |
| Test coverage | N/A — config file |

### `README.md` (+1 / -5 lines)

| Property | Detail |
|----------|--------|
| Purpose | Remove `GETADDRESS_API_KEY` from env var table and Docker Compose example; remove UPRN API endpoints from API table; remove `uprn.test.js` from file tree |
| Issues | #16 (M8 — extended cleanup) |
| Criteria covered | AC12 (codebase-wide: no remaining references) |
| Quality | ✅ Extra blank line fixed in follow-up commit |
| Test coverage | N/A — documentation |

### `CLAUDE.md` (+1 / -1 lines)

| Property | Detail |
|----------|--------|
| Purpose | Replace `/frontend-design` with `/product-designer` in Frontend Rules section |
| Issues | Not related to #16 — separate housekeeping change |
| Criteria covered | N/A |
| Quality | No issues |
| Test coverage | N/A — project config |

---

## Acceptance Criteria Verification

### #16 — Replace getaddress.io address lookup (service permanently closed)

#### Analysis Section ACs

| # | Criterion | Implementation | Test | Verdict |
|---|-----------|----------------|------|---------|
| AC1 | `src/uprn.js` is deleted | File does not exist on disk | N/A | Met |
| AC2 | `GET /api/uprn/lookup` endpoint removed from `src/server.js` | `server.js` — no UPRN routes present | 8 UPRN tests removed; no route = Express 404 | Met |
| AC3 | `GET /api/uprn/detail` endpoint removed from `src/server.js` | `server.js` — no UPRN routes present | Same as AC2 | Met |
| AC4 | `addressLookupConfigured` removed from `GET /api/config` response | `server.js:28-32` — only `googleConfigured` in response | `server.test.js:134` `not.toHaveProperty('addressLookupConfigured')` | Met |
| AC5 | Postcode search input, Search button, address dropdown absent from Add Property | `properties.js:371-392` — no postcode elements | Manual (UI) | Met |
| AC6 | UPRN input field present in Add Property accordion, accepts manual entry | `properties.js:377-378` — `id="add-uprn"` with placeholder | Manual (UI) | Met |
| AC7 | UPRN input has helpful placeholder and hint text | `properties.js:378-379` — placeholder `e.g. 127053058`, hint `<p>` below | Manual (UI) | Met |
| AC8 | `tests/unit/uprn.test.js` is deleted | File does not exist on disk | N/A | Met |
| AC9 | All 8 UPRN endpoint tests removed from `tests/api/server.test.js` | `server.test.js` — no UPRN test blocks remain | Verified by reading file | Met |
| AC10 | `GETADDRESS_API_KEY` removed from `docker-compose.yml` | `docker-compose.yml` — no reference | grep confirms | Met |
| AC11 | Full test suite passes with >= 80% coverage | 144 tests pass, 97%+ coverage | `npm test` output | Met |
| AC12 | No references to `getaddress`, `GETADDRESS_API_KEY`, or `addressLookupConfigured` remain (excl. docs/history) | grep returns only the intentional `not.toHaveProperty` assertion in test | grep confirmed | Met |

**Summary:** 12/12 criteria met.

---

## Findings

### Critical (must fix before merge)

None.

### Major (should fix)

None.

### Minor (nice to fix)

#### m1 — Extra blank line in README API table ✅ Fixed

- **Category:** Code Quality
- **Location:** `README.md:178`
- **Description:** After removing the two UPRN API rows from the endpoint table, an extra blank line was left between the last table row and the `## Data` heading (two consecutive blank lines instead of one).
- **Resolution:** Fixed in commit `57cb42f` — extra blank line removed.

#### m2 — Out-of-scope change bundled in PR ✅ Acknowledged

- **Category:** Code Quality
- **Location:** `CLAUDE.md:61`
- **Description:** The `CLAUDE.md` change (replacing `/frontend-design` with `/product-designer`) is unrelated to issue #16. It was committed on the feature branch before the #16 work began.
- **Resolution:** Change is correct and no functional impact. Content is appropriate for the codebase; no revert required. Noted for process improvement.

### Suggestions (optional)

None.

---

## Positive Observations

- Clean, surgical removal — every trace of the dead integration was found and removed across backend, frontend, tests, config, and documentation
- TDD approach followed: config test updated to assert absence before code was removed
- UPRN hint text uses the existing inline style convention (`font-size:12px;color:var(--text-3)`) — consistent with the rest of the codebase
- Test suite remains healthy: 144 tests, 97%+ coverage across all metrics
- Commit messages are well-structured with issue references and clear descriptions

---

## Action Items

### Immediate Fixes (block merge)

None.

### Post-merge improvements

None.

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
- [x] No unnecessary changes outside scope of the issue (minor: CLAUDE.md change noted)
