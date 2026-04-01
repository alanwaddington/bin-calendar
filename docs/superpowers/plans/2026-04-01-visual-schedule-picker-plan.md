# Implementation Plan: Visual Schedule Picker

**Spec:** docs/superpowers/specs/2026-03-31-visual-schedule-picker-design.md
**Date:** 2026-04-01
**Status:** Ready

---

## Overview

Replaces the raw cron expression text input in the Sync Schedule accordion with a sentence-builder UI. The user selects from dropdowns that form a natural-language sentence ("Sync every week on Monday at midnight"). The dropdowns are converted to a 5-field cron string by `buildCronExpression()` before being sent to the unchanged backend API. On open, the stored cron is reverse-parsed by `parseCronToSelection()` to pre-select the correct dropdown values. No backend changes. No new files.

---

## Steps

### Step 1: Add `.schedule-token` CSS

**What:** Replace the existing `.sync-schedule-examples` class with new classes for the sentence builder. Keep `.sync-schedule-next` unchanged. Add `.schedule-sentence`, `.schedule-connector`, and `.schedule-token`.

**File:** `public/style.css` (modify)

**Change:** Replace the `/* ── Sync Schedule ── */` section (lines 802–816):

```css
/* ── Sync Schedule ───────────────────────────────────────────── */
.schedule-sentence {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 14px;
  margin-bottom: var(--space-md);
}

.schedule-connector {
  color: var(--text-3);
}

.schedule-token {
  background: var(--surface-2);
  border: 1px solid var(--primary);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-weight: 600;
  padding: 3px 8px;
  cursor: pointer;
  font-size: inherit;
  font-family: var(--font-body);
  transition: var(--t-fast);
  outline: none;
  width: auto;
}

.schedule-token:focus {
  box-shadow: 0 0 0 3px var(--primary-glow);
  border-color: var(--primary-bright);
}

.sync-schedule-next {
  margin-top: var(--space-sm);
  font-size: 12px;
  color: var(--text-3);
}
```

**Verify:** Open `public/style.css` and confirm `.sync-schedule-examples` no longer exists and `.schedule-token` is present.

**Depends on:** none

---

### Step 2: Add `buildCronExpression()` and `parseCronToSelection()` pure functions

**What:** Insert two pure functions immediately before `async function renderSyncSchedule()` in `public/properties.js`. These have no side effects and no DOM dependencies.

**File:** `public/properties.js` (modify)

**Change:** Insert before the line `// ── Sync Schedule ──────────────────────────────────────────────`:

```js
// ── Schedule builder helpers ───────────────────────────────────
function buildCronExpression(frequency, param, hour) {
  const h = parseInt(hour, 10);
  if (frequency === 'weekly')      return `0 ${h} * * ${param}`;
  if (frequency === 'fortnightly') return `0 ${h} ${param} * *`;
  if (frequency === 'quarterly')   return `0 ${h} ${param} */3 *`;
  return `0 ${h} ${param} * *`; // monthly
}

function parseCronToSelection(cronExpr) {
  try {
    const fields = (cronExpr || '').trim().split(/\s+/);
    if (fields.length !== 5) throw new Error('invalid');
    const [, hour, dom, month, dow] = fields;
    const h = parseInt(hour, 10);
    if (dow !== '*')          return { frequency: 'weekly',      param: dow,              hour: h };
    if (dom.includes(','))    return { frequency: 'fortnightly', param: dom,              hour: h };
    if (month === '*/3')      return { frequency: 'quarterly',   param: parseInt(dom, 10), hour: h };
                              return { frequency: 'monthly',     param: parseInt(dom, 10), hour: h };
  } catch {
    return { frequency: 'monthly', param: 1, hour: 0 };
  }
}

function scheduleDescription(cronExpr) {
  const sel = parseCronToSelection(cronExpr);
  const timeLabel = { 0: 'midnight', 6: '6am', 12: 'noon', 18: '6pm' }[sel.hour] || `${sel.hour}:00`;
  if (sel.frequency === 'weekly') {
    const dayLabel = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][parseInt(sel.param, 10)];
    return `Every ${dayLabel} at ${timeLabel}`;
  }
  const n = parseInt(sel.param, 10);
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  if (sel.frequency === 'fortnightly') {
    const pairLabel = sel.param === '1,15' ? '1st & 15th' : '8th & 22nd';
    return `Every 2 weeks \u00b7 ${pairLabel} at ${timeLabel}`;
  }
  if (sel.frequency === 'quarterly') return `Every 3 months \u00b7 ${n}${suffix} at ${timeLabel}`;
  return `Every month \u00b7 ${n}${suffix} at ${timeLabel}`;
}

function buildScheduleSentenceHTML(sel) {
  const { frequency, param, hour } = sel;

  const freqOptions = [
    ['weekly',      'every week'],
    ['fortnightly', 'every 2 weeks'],
    ['monthly',     'every month'],
    ['quarterly',   'every 3 months'],
  ].map(([v, l]) => `<option value="${v}"${v === frequency ? ' selected' : ''}>${l}</option>`).join('');

  let midConnector, midOptions;
  if (frequency === 'weekly') {
    midConnector = 'on';
    midOptions = [
      ['1','Monday'],['2','Tuesday'],['3','Wednesday'],['4','Thursday'],
      ['5','Friday'],['6','Saturday'],['0','Sunday'],
    ].map(([v, l]) => `<option value="${v}"${String(v) === String(param) ? ' selected' : ''}>${l}</option>`).join('');
  } else if (frequency === 'fortnightly') {
    midConnector = 'on the';
    midOptions = [
      ['1,15', '1st &amp; 15th'],
      ['8,22', '8th &amp; 22nd'],
    ].map(([v, l]) => `<option value="${v}"${v === param ? ' selected' : ''}>${l}</option>`).join('');
  } else {
    midConnector = 'on the';
    midOptions = Array.from({ length: 28 }, (_, i) => {
      const n = i + 1;
      const s = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
      return `<option value="${n}"${n === parseInt(param, 10) ? ' selected' : ''}>${n}${s}</option>`;
    }).join('');
  }

  const timeOptions = [
    ['0','midnight'],['6','6am'],['12','noon'],['18','6pm'],
  ].map(([v, l]) => `<option value="${v}"${parseInt(v, 10) === parseInt(hour, 10) ? ' selected' : ''}>${l}</option>`).join('');

  return `<div class="schedule-sentence">
      <span class="schedule-connector">Sync</span>
      <select class="schedule-token" id="sch-frequency" onchange="onFrequencyChange(this)">${freqOptions}</select>
      <span class="schedule-connector" id="sch-mid-connector">${midConnector}</span>
      <select class="schedule-token" id="sch-param">${midOptions}</select>
      <span class="schedule-connector">at</span>
      <select class="schedule-token" id="sch-time">${timeOptions}</select>
    </div>`;
}
```

**Verify:** Open the browser console on the Settings page and run:
```js
buildCronExpression('weekly', '1', 0)   // → "0 0 * * 1"
buildCronExpression('monthly', 1, 0)    // → "0 0 1 * *"
buildCronExpression('quarterly', 1, 6)  // → "0 6 1 */3 *"
parseCronToSelection('0 0 1 * *')       // → {frequency:"monthly", param:1, hour:0}
parseCronToSelection('0 0 * * 1')       // → {frequency:"weekly", param:"1", hour:0}
parseCronToSelection('0 0 1,15 * *')    // → {frequency:"fortnightly", param:"1,15", hour:0}
parseCronToSelection('0 6 1 */3 *')     // → {frequency:"quarterly", param:1, hour:6}
```

**Depends on:** none

---

### Step 3: Rewrite `renderSyncSchedule()`

**What:** Replace the function body to use the sentence builder instead of the text input. The subtitle changes from showing raw cron to a human-readable description. Remove the cron examples list.

**File:** `public/properties.js` (modify)

**Change:** Replace the entire `async function renderSyncSchedule()` body (lines 38–87) with:

```js
async function renderSyncSchedule() {
  const el = document.getElementById('sync-schedule-section');
  if (!el) return;

  let cronExpression = '0 0 1 * *';
  let nextSync = '';

  try {
    const data = await api('GET', '/api/settings/sync-schedule');
    cronExpression = data.cronExpression;
    nextSync = data.nextSync ? new Date(data.nextSync).toLocaleString() : '';
  } catch (err) {
    el.innerHTML = `<p class="form-error">Failed to load sync schedule: ${escHtml(err.message)}</p>`;
    return;
  }

  const sel = parseCronToSelection(cronExpression);
  const subtitle = scheduleDescription(cronExpression);

  el.innerHTML = `
    <div class="accordion open" id="acc-sync-schedule">
      <div class="accordion-header" onclick="toggleSyncScheduleAccordion()">
        <div class="accordion-header-left">
          <span class="accordion-title">Sync Schedule</span>
          <span class="accordion-subtitle" id="sync-schedule-subtitle">${escHtml(subtitle)}</span>
        </div>
        <svg class="accordion-chevron" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/>
        </svg>
      </div>
      <div class="accordion-body open" id="sync-schedule-body">
        ${buildScheduleSentenceHTML(sel)}
        <div class="form-actions">
          <button class="btn btn-primary btn-sm" onclick="saveSyncSchedule()">Save schedule</button>
        </div>
        <p class="sync-schedule-next" id="sync-schedule-next">
          Next sync: <strong>${escHtml(nextSync)}</strong>
        </p>
      </div>
    </div>`;
}
```

**Verify:** Open Settings → Sync Schedule accordion. Confirm: the cron text input is gone; the sentence builder is shown; the accordion subtitle reads something like "Every month · 1st at midnight" (not a raw cron string); the next-sync date is shown.

**Depends on:** Step 2

---

### Step 4: Add `onFrequencyChange()`

**What:** New function that fires when the frequency dropdown changes. It re-renders only the middle connector and param dropdown without a full re-render or API call.

**File:** `public/properties.js` (modify)

**Change:** Insert immediately after `function toggleSyncScheduleAccordion()` (after line 101):

```js
function onFrequencyChange(selectEl) {
  const frequency = selectEl.value;
  const connectorEl = document.getElementById('sch-mid-connector');
  const paramEl = document.getElementById('sch-param');
  if (!connectorEl || !paramEl) return;

  let connector, optionsHTML;

  if (frequency === 'weekly') {
    connector = 'on';
    optionsHTML = [
      ['1','Monday'],['2','Tuesday'],['3','Wednesday'],['4','Thursday'],
      ['5','Friday'],['6','Saturday'],['0','Sunday'],
    ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  } else if (frequency === 'fortnightly') {
    connector = 'on the';
    optionsHTML = `<option value="1,15">1st &amp; 15th</option><option value="8,22">8th &amp; 22nd</option>`;
  } else {
    connector = 'on the';
    optionsHTML = Array.from({ length: 28 }, (_, i) => {
      const n = i + 1;
      const s = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
      return `<option value="${n}"${n === 1 ? ' selected' : ''}>${n}${s}</option>`;
    }).join('');
  }

  connectorEl.textContent = connector;
  paramEl.innerHTML = optionsHTML;
}
```

**Verify:** Open Settings → Sync Schedule accordion. Change the frequency dropdown from "every month" to "every week". Confirm: the connector changes from "on the" to "on", and the param dropdown changes to show Monday–Sunday.

**Depends on:** Step 3

---

### Step 5: Rewrite `saveSyncSchedule()` and remove `clearSyncScheduleError()`

**What:** Replace `saveSyncSchedule()` to read values from the three dropdowns (`#sch-frequency`, `#sch-param`, `#sch-time`) instead of the text input. Remove `clearSyncScheduleError()` entirely — the `sync-schedule-error` element no longer exists, and the function is no longer referenced from any `oninput` handler.

**File:** `public/properties.js` (modify)

**Change:** Replace `function clearSyncScheduleError()` and `async function saveSyncSchedule()` (lines 103–146) with:

```js
async function saveSyncSchedule() {
  const freqEl = document.getElementById('sch-frequency');
  const paramEl = document.getElementById('sch-param');
  const timeEl = document.getElementById('sch-time');
  const nextEl = document.getElementById('sync-schedule-next');
  const subtitleEl = document.getElementById('sync-schedule-subtitle');
  const btn = document.querySelector('#acc-sync-schedule .btn-primary');

  if (!freqEl || !paramEl || !timeEl) return;

  const cronExpression = buildCronExpression(freqEl.value, paramEl.value, timeEl.value);

  if (btn) btn.disabled = true;
  try {
    const data = await api('PUT', '/api/settings/sync-schedule', { cronExpression });
    const nextSync = data.nextSync ? new Date(data.nextSync).toLocaleString() : '';
    if (nextEl) nextEl.innerHTML = `Next sync: <strong>${escHtml(nextSync)}</strong>`;
    if (subtitleEl) subtitleEl.innerHTML = escHtml(scheduleDescription(data.cronExpression));
    showToast('Sync schedule saved');
  } catch (err) {
    showToast(err.message || 'Failed to save sync schedule.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}
```

**Verify:**
1. Select "every week" / Thursday / 6am → click Save → confirm toast "Sync schedule saved" appears, subtitle updates to "Every Thursday at 6am", next-sync date updates.
2. Open browser DevTools Network tab → confirm the PUT body is `{"cronExpression":"0 6 * * 4"}`.
3. Reload the Settings page → confirm the dropdowns load back as "every week" / Thursday / 6am.

**Depends on:** Steps 2, 3, 4

---

### Step 6: Manual verification — all four frequencies

**What:** Confirm all four frequency paths work end-to-end.

**File:** none

**Verify:**

| Selection | Expected cron | Expected subtitle |
|-----------|---------------|-------------------|
| every week / Monday / midnight | `0 0 * * 1` | Every Monday at midnight |
| every 2 weeks / 8th & 22nd / 6pm | `0 18 8,22 * *` | Every 2 weeks · 8th & 22nd at 6pm |
| every month / 15th / noon | `0 12 15 * *` | Every month · 15th at noon |
| every 3 months / 1st / midnight | `0 0 1 */3 *` | Every 3 months · 1st at midnight |

For each: select → Save → verify subtitle → reload page → verify dropdowns restore correctly.

Also confirm: no raw cron expression string is visible anywhere in the UI at any point.

**Depends on:** Step 5
