registerView('calendar', loadCalendar);

let _calProperties = [];
let _calEvents = [];
let _calMonthsWithData = [];
let _calViewYear = null;
let _calViewMonth = null; // 0-indexed
let _calRequestToken = 0; // guards against out-of-order responses when switching property quickly

async function loadCalendar() {
  const el = document.getElementById('view-calendar');
  el.innerHTML = '<div class="hero-card-empty" style="opacity:0.4">Loading…</div>';

  let properties;
  try {
    properties = await api('GET', '/api/properties');
  } catch (err) {
    showToast(err.message, 'error');
    el.innerHTML = `<p style="color:var(--text-3)">Could not load properties: ${escCalHtml(err.message)}</p>`;
    return;
  }

  _calProperties = properties;

  if (properties.length === 0) {
    renderCalendarNoProperties(el);
    return;
  }

  const targetId = window._calendarTargetPropertyId;
  window._calendarTargetPropertyId = null;
  const initial = properties.find(p => p.id === targetId) || properties[0];

  renderCalendarShell(el);
  await selectCalendarProperty(initial.id);
}

function renderCalendarNoProperties(el) {
  el.innerHTML = `
    <div style="text-align:center;padding:var(--space-xl) 0">
      <p style="color:var(--text-3);margin-bottom:var(--space-md)">No properties configured yet.</p>
      <button class="tile-add" onclick="navigate('settings')" style="display:inline-flex;width:auto;padding:var(--space-md) var(--space-lg)">+ Add property</button>
    </div>`;
}

function renderCalendarShell(el) {
  const showSwitcher = _calProperties.length > 1;

  // No "Property settings" action here - Settings is already one click away
  // via the top nav, and the only thing this button ever added was landing
  // there with the current property's accordion pre-expanded, which isn't
  // worth a dedicated button.
  el.innerHTML = `
    ${showSwitcher ? `
      <div class="cal-header">
        <div class="cal-switcher">
          <label for="cal-property-select">Property</label>
          <select id="cal-property-select" onchange="onCalendarPropertyChange(this.value)">
            ${_calProperties.map(p => `<option value="${p.id}">${escCalHtml(p.label)}</option>`).join('')}
          </select>
        </div>
      </div>` : ''}
    <div class="cal-monthnav">
      <button class="btn btn-secondary btn-sm" id="cal-prev-btn" onclick="stepCalendarMonth(-1)" aria-label="Previous month">‹</button>
      <div class="cal-month-heading" id="cal-month-heading"></div>
      <button class="btn btn-secondary btn-sm" id="cal-next-btn" onclick="stepCalendarMonth(1)" aria-label="Next month">›</button>
    </div>
    <div id="cal-schedule">
      <div class="cal-grid" id="cal-grid"></div>
      <div class="cal-agenda" id="cal-agenda"></div>
    </div>`;
}

function onCalendarPropertyChange(value) {
  selectCalendarProperty(Number(value));
}

async function selectCalendarProperty(id) {
  const token = ++_calRequestToken;
  const select = document.getElementById('cal-property-select');
  if (select) select.value = String(id);

  const scheduleEl = document.getElementById('cal-schedule');
  if (scheduleEl) scheduleEl.innerHTML = '<div class="hero-card-empty" style="opacity:0.4">Loading…</div>';

  let events;
  try {
    ({ events } = await api('GET', `/api/properties/${id}/events`));
  } catch (err) {
    if (token !== _calRequestToken) return; // a newer selection has since started; drop this stale error
    showToast(err.message, 'error');
    if (scheduleEl) {
      scheduleEl.innerHTML = `<p style="color:var(--text-3)">Could not load this property's schedule: ${escCalHtml(err.message)}</p>`;
    }
    return;
  }

  if (token !== _calRequestToken) return; // a newer selection has since started; drop this stale response

  _calEvents = events;

  // restore the two schedule containers (may have been replaced by a prior error/empty state)
  if (scheduleEl) scheduleEl.innerHTML = '<div class="cal-grid" id="cal-grid"></div><div class="cal-agenda" id="cal-agenda"></div>';

  _calMonthsWithData = getCalendarMonthsWithData(_calEvents);
  const now = new Date();
  _calViewYear = now.getFullYear();
  _calViewMonth = now.getMonth();

  renderCalendarMonth();
}

// ── Pure date helpers (never parse ISO date strings with `new Date()`) ────

function pad2(n) {
  return String(n).padStart(2, '0');
}

function calDateStr(year, month0, day) {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

function buildMonthMatrix(year, month0) {
  const firstWeekday = (new Date(year, month0, 1).getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function groupCalendarEventsByDate(events) {
  const map = new Map();
  for (const ev of events) {
    if (!map.has(ev.date)) map.set(ev.date, []);
    map.get(ev.date).push(ev);
  }
  return map;
}

function getCalendarMonthsWithData(events) {
  const idxSet = new Set();
  for (const ev of events) {
    const [y, m] = ev.date.split('-').map(Number);
    idxSet.add(y * 12 + (m - 1));
  }
  return Array.from(idxSet).sort((a, b) => a - b);
}

function findNearestMonthWithData(year, month0, direction, monthsWithData) {
  const currentIdx = year * 12 + month0;
  let best = null;
  for (const idx of monthsWithData) {
    if (direction < 0 && idx < currentIdx) {
      if (best === null || idx > best) best = idx;
    } else if (direction > 0 && idx > currentIdx) {
      if (best === null || idx < best) best = idx;
    }
  }
  if (best === null) return null;
  return { year: Math.floor(best / 12), month0: ((best % 12) + 12) % 12 };
}

function stepCalendarMonth(direction) {
  const target = findNearestMonthWithData(_calViewYear, _calViewMonth, direction, _calMonthsWithData);
  if (!target) return;
  _calViewYear = target.year;
  _calViewMonth = target.month0;
  renderCalendarMonth();
}

// ── Rendering ──────────────────────────────────────────────────────────────

function renderCalendarMonth() {
  const heading = document.getElementById('cal-month-heading');
  if (heading) {
    heading.textContent = new Date(_calViewYear, _calViewMonth, 1)
      .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  const prevBtn = document.getElementById('cal-prev-btn');
  const nextBtn = document.getElementById('cal-next-btn');
  if (prevBtn) prevBtn.disabled = !findNearestMonthWithData(_calViewYear, _calViewMonth, -1, _calMonthsWithData);
  if (nextBtn) nextBtn.disabled = !findNearestMonthWithData(_calViewYear, _calViewMonth, 1, _calMonthsWithData);

  const scheduleEl = document.getElementById('cal-schedule');
  if (!scheduleEl) return;

  if (_calEvents.length === 0) {
    scheduleEl.innerHTML =
      '<p style="color:var(--text-3)">No collections synced yet for this property — run a sync from the dashboard to populate the calendar.</p>';
    return;
  }

  if (!document.getElementById('cal-grid')) {
    scheduleEl.innerHTML = '<div class="cal-grid" id="cal-grid"></div><div class="cal-agenda" id="cal-agenda"></div>';
  }

  const byDate = groupCalendarEventsByDate(_calEvents);
  const todayStr = (() => {
    const n = new Date();
    return calDateStr(n.getFullYear(), n.getMonth(), n.getDate());
  })();

  renderCalendarGrid(_calViewYear, _calViewMonth, byDate, todayStr);
  renderCalendarAgenda(_calViewYear, _calViewMonth, byDate, todayStr);
}

function renderCalendarMarker(ev) {
  // Server-side validation already enforces this (sanitiseBinTypeInput), but
  // the colour is interpolated into a style attribute, so re-validate here
  // rather than trust an invariant enforced in a different layer.
  const safeColour = /^#[0-9a-f]{6}$/i.test(ev.colour) ? ev.colour : '#6b7a99';
  const labelText = ev.matched
    ? escCalHtml(ev.label)
    : `${escCalHtml(ev.label)} <span class="cal-marker-unmatched">(uncategorised)</span>`;
  // A matched label can now embed a full raw feed summary (formatMatchedLabel
  // on the server) and run considerably longer than a plain configured
  // label. CSS visually clamps .cal-marker-label, so `title` keeps the full
  // text recoverable on hover even when it's clipped.
  return `
    <div class="cal-marker">
      <span class="cal-marker-dot" style="background:${safeColour}"></span>
      <span class="cal-marker-label" title="${escCalAttr(ev.label)}">${labelText}</span>
    </div>`;
}

function renderCalendarGrid(year, month0, byDate, todayStr) {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;

  const weekdayHeads = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
    .map(d => `<div class="cal-grid-head">${d}</div>`).join('');

  const weeks = buildMonthMatrix(year, month0);
  const weekRows = weeks.map(week => week.map(day => {
    if (day === null) return '<div class="cal-grid-cell cal-grid-cell--empty"></div>';
    const dateStr = calDateStr(year, month0, day);
    const isPast = dateStr < todayStr;
    const markers = (byDate.get(dateStr) || []).map(renderCalendarMarker).join('');
    return `
      <div class="cal-grid-cell">
        <div class="cal-grid-date${isPast ? ' cal-grid-date--past' : ''}">${day}</div>
        ${markers}
      </div>`;
  }).join('')).join('');

  grid.innerHTML = weekdayHeads + weekRows;
}

function renderCalendarAgenda(year, month0, byDate, todayStr) {
  const agenda = document.getElementById('cal-agenda');
  if (!agenda) return;

  const monthPrefix = `${year}-${pad2(month0 + 1)}-`;
  const datesInMonth = Array.from(byDate.keys())
    .filter(d => d.startsWith(monthPrefix))
    .sort();

  if (datesInMonth.length === 0) {
    agenda.innerHTML = '<p style="color:var(--text-3)">No collections this month.</p>';
    return;
  }

  agenda.innerHTML = datesInMonth.map(dateStr => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const isPast = dateStr < todayStr;
    const weekdayLabel = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' });
    const markers = byDate.get(dateStr).map(renderCalendarMarker).join('');
    return `
      <div class="cal-agenda-row${isPast ? ' cal-agenda-row--past' : ''}">
        <div class="cal-agenda-date${isPast ? ' cal-grid-date--past' : ''}">${weekdayLabel} ${d}</div>
        <div class="cal-agenda-markers">${markers}</div>
      </div>`;
  }).join('');
}

// ── XSS helpers (named distinctly — escHtml/escAttr already exist
// globally in dashboard.js and properties.js; a third declaration of the
// same name would silently collide depending on script load order) ───────

function escCalHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escCalAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
