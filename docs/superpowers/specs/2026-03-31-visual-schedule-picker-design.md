---
title: Visual Schedule Picker
date: 2026-03-31
status: approved
---

# Visual Schedule Picker — Design Spec

## Problem

The Sync Schedule accordion in the Settings UI currently exposes a raw cron expression text input with example strings. Non-technical users (household members) cannot interpret or compose cron syntax. The input needs to be replaced with a visual control that produces the same cron output without exposing the syntax.

## Scope

Frontend-only change. The backend API (`PUT /api/settings/sync-schedule`, `GET /api/settings/sync-schedule`) is unchanged. The stored value remains a standard 5-field cron string.

---

## Design: Sentence Builder

The control reads as a natural-language sentence with inline dropdown "tokens". Each token is a `<select>` styled as a pill with a teal border. The sentence structure adapts contextually when frequency changes.

### Sentence patterns

| Frequency | Sentence |
|-----------|----------|
| Weekly | Sync **[every week]** on **[Monday]** at **[midnight]** |
| Fortnightly | Sync **[every 2 weeks]** on the **[1st & 15th]** at **[midnight]** |
| Monthly | Sync **[every month]** on the **[1st]** at **[midnight]** |
| Quarterly | Sync **[every 3 months]** on the **[1st]** at **[midnight]** |

### Dropdown options

**Frequency (`[every week]` etc.)**
- every week
- every 2 weeks
- every month
- every 3 months

**Day of week — weekly only**
- Monday through Sunday (values 1–7, mapped to cron `0`–`6` where Sunday = 0)

**Date pair — fortnightly only**
- 1st & 15th → dom `1,15`
- 8th & 22nd → dom `8,22`

**Day of month — monthly and quarterly**
- 1st through 28th (capped at 28 to avoid month-length edge cases)

**Time**
- midnight → hour `0`
- 6am → hour `6`
- noon → hour `12`
- 6pm → hour `18`

---

## Cron Mappings

### Build (UI → cron)

| Frequency | Parameters | Cron expression |
|-----------|-----------|-----------------|
| Weekly | dow=1, hour=0 | `0 0 * * 1` |
| Weekly | dow=5, hour=6 | `0 6 * * 5` |
| Fortnightly | pair=1,15, hour=0 | `0 0 1,15 * *` |
| Fortnightly | pair=8,22, hour=18 | `0 18 8,22 * *` |
| Monthly | dom=1, hour=0 | `0 0 1 * *` |
| Monthly | dom=15, hour=12 | `0 12 15 * *` |
| Quarterly | dom=1, hour=0 | `0 0 1 */3 *` |
| Quarterly | dom=1, hour=6 | `0 6 1 */3 *` |

`buildCronExpression(frequency, param, hour)` returns a 5-field string. `frequency` is one of `weekly | fortnightly | monthly | quarterly`. `param` is dow (0–6), dom (1–28), or date-pair string (`1,15` or `8,22`). `hour` is 0, 6, 12, or 18.

### Parse (cron → UI)

`parseCronToSelection(cronExpr)` detects frequency by inspecting the 5 fields:

1. Field 4 (dow) is not `*` → **weekly**; extract dow and hour
2. Field 2 (dom) contains `,` → **fortnightly**; extract pair and hour
3. Field 3 (month) is `*/3` → **quarterly**; extract dom and hour
4. Otherwise → **monthly**; extract dom and hour

Returns `{ frequency, param, hour }`. Falls back to `{ frequency: 'monthly', param: 1, hour: 0 }` for any unrecognised pattern (covers the existing default `0 0 1 * *`).

---

## Implementation

### Files changed

| File | Change |
|------|--------|
| `public/properties.js` | Replace text input with sentence builder; add `buildCronExpression()`, `parseCronToSelection()`, `renderSyncScheduleUI()`, `onFrequencyChange()` |
| `public/style.css` | Add `.schedule-token` pill styles (~15 lines) |

No backend changes. No new files.

### Functions

**`buildCronExpression(frequency, param, hour)`**
Pure function. Returns a 5-field cron string. No side effects.

**`parseCronToSelection(cronExpr)`**
Pure function. Splits on whitespace, applies detection rules above. Returns `{ frequency, param, hour }`.

**`renderSyncScheduleUI(selection)`**
Builds the sentence HTML from a `{ frequency, param, hour }` object. Called on accordion open (after GET) and on frequency change.

**`onFrequencyChange(selectEl)`**
Event handler wired to the frequency dropdown. Reads new value, re-renders only the contextual middle dropdown (no full re-render, no API call).

**`saveSyncSchedule()`**
Reads current dropdown values, calls `buildCronExpression()`, calls `PUT /api/settings/sync-schedule`, updates the next-sync label and subtitle with `escHtml()`, shows toast, re-enables Save button in `finally`.

### Interaction flow

1. User opens Sync Schedule accordion
2. `renderSyncScheduleUI()` fetches `GET /api/settings/sync-schedule`, calls `parseCronToSelection()`, renders sentence with correct selections
3. User changes frequency dropdown → `onFrequencyChange()` swaps the middle dropdown
4. User adjusts remaining dropdowns
5. User clicks Save → `saveSyncSchedule()` disables button, calls `buildCronExpression()`, calls `PUT`, updates UI, re-enables button

### CSS

Add `.schedule-token` class:
- `background: var(--surface-2)` (matches existing surface tokens)
- `border: 1px solid var(--primary)` (teal, matches accent)
- `border-radius: var(--radius-sm)`
- `color: var(--text)` with `font-weight: 600`
- `padding: 3px 8px`
- `cursor: pointer`
- `font-size: inherit`

The static connector words ("Sync", "on", "at") use `color: var(--text-muted)`.

---

## Error Handling

Dropdowns produce only valid combinations — invalid cron is structurally impossible. The server `PUT` endpoint still validates with `cron.validate()` as a safety net. If the `PUT` fails (network error, server error), the existing error display and `showToast()` mechanism is used, identical to the current implementation.

---

## XSS

No user-typed strings exist in this component — all values originate from hardcoded `<option>` elements. The next-sync ISO string returned from the API response is rendered via `escHtml()` before insertion into `innerHTML`, consistent with the codebase convention.

---

## Testing

No new test files. The frontend has no test framework (vanilla JS). Backend API is unchanged and already covered by existing tests in `tests/api/server.test.js`. Manual verification covers the happy path for each of the four frequencies and the load-from-saved-cron behaviour.

---

## Acceptance Criteria

- [ ] Frequency dropdown offers: every week / every 2 weeks / every month / every 3 months
- [ ] Changing frequency re-renders the contextual middle dropdown (day-of-week, date-pair, or day-of-month) without a page reload or API call
- [ ] Time dropdown offers: midnight / 6am / noon / 6pm
- [ ] Day-of-week dropdown (weekly) covers Monday–Sunday
- [ ] Date-pair dropdown (fortnightly) offers 1st & 15th and 8th & 22nd
- [ ] Day-of-month dropdown (monthly/quarterly) covers 1st–28th
- [ ] Save calls `PUT /api/settings/sync-schedule` with a valid 5-field cron string
- [ ] Next-sync label updates after successful save
- [ ] Save button is disabled during the API call and re-enabled in `finally`
- [ ] On accordion open, dropdowns pre-select to match the currently saved cron expression
- [ ] The existing default `0 0 1 * *` loads as: every month / 1st / midnight
- [ ] No raw cron syntax is visible anywhere in the UI
- [ ] All dynamic strings rendered into `innerHTML` use `escHtml()`
