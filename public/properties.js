registerView('settings', loadSettings);

// ── State ──────────────────────────────────────────────────────
let _settingsProperties = [];
let _binTypes = [];

// ── Load ───────────────────────────────────────────────────────
async function loadSettings() {
  const el = document.getElementById('view-settings');
  el.innerHTML = `
    <div class="settings-section">
      <div class="section-label">PROPERTIES</div>
      <div id="property-accordions"></div>
    </div>
    <div class="settings-section">
      <div class="section-label">BIN TYPES</div>
      <div id="bin-types-section"></div>
    </div>`;

  await Promise.all([
    renderPropertyAccordions(),
    renderBinTypes(),
  ]);

  if (window._settingsTargetPropertyId) {
    const id = window._settingsTargetPropertyId;
    window._settingsTargetPropertyId = null;
    toggleAccordion(`acc-prop-${id}`);
  }
}

// ── Exclusive accordion toggle ─────────────────────────────────
function toggleAccordion(id) {
  const all = document.querySelectorAll('#property-accordions .accordion');
  let opened = false;
  all.forEach(acc => {
    const body = acc.querySelector('.accordion-body');
    if (acc.id === id) {
      const isOpen = acc.classList.contains('open');
      if (isOpen) {
        acc.classList.remove('open');
        if (body) body.classList.remove('open');
      } else {
        acc.classList.add('open');
        if (body) body.classList.add('open');
        opened = true;
      }
    } else {
      acc.classList.remove('open');
      if (body) body.classList.remove('open');
    }
  });
  // Lazy-load Google calendar picker when opening a property accordion
  if (opened && id.startsWith('acc-prop-')) {
    const propId = parseInt(id.replace('acc-prop-', ''), 10);
    const p = _settingsProperties.find(prop => prop.id === propId);
    if (p && p.connected && p.calendar_type === 'google') {
      loadGoogleCalendarsForProp(propId, p.calendar_id);
    }
  }
}

// ── Properties ─────────────────────────────────────────────────
async function renderPropertyAccordions() {
  try {
    _settingsProperties = await api('GET', '/api/properties');
  } catch (err) {
    const el = document.getElementById('property-accordions');
    if (el) el.innerHTML = `<p class="form-error">Failed to load properties: ${escHtml(err.message)}</p>`;
    return;
  }

  const el = document.getElementById('property-accordions');
  if (!el) return;

  const accordions = _settingsProperties.map(p => buildPropertyAccordion(p)).join('');
  el.innerHTML = accordions + buildAddPropertyAccordion();
}

function getStatusBadge(p) {
  if (!p.connected) return '<span class="badge badge-warning">Not connected</span>';
  if (p.credential_status === 'invalid') return '<span class="badge badge-error">Credentials expired</span>';
  if (p.credential_status === 'unknown') return '<span class="badge badge-warning">Needs attention</span>';
  return '<span class="badge badge-success">Connected</span>';
}

function buildPropertyAccordion(p) {
  const calType = p.calendar_type === 'google' ? 'Google Calendar' : 'iCloud';
  const needsReconnect = !p.connected || p.credential_status === 'invalid';
  const showCalPicker = p.connected && p.calendar_type === 'google';

  return `
    <div class="accordion" id="acc-prop-${p.id}">
      <div class="accordion-header" onclick="toggleAccordion('acc-prop-${p.id}')">
        <div class="accordion-header-left">
          <div>
            <div class="accordion-title">${escHtml(p.label)}</div>
            <div class="accordion-subtitle">${escHtml(calType)} &middot; ${getStatusBadge(p)}</div>
          </div>
        </div>
        <svg class="accordion-chevron" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="accordion-body" id="acc-prop-body-${p.id}">
        <div class="form-group">
          <label>Label</label>
          <input id="prop-label-${p.id}" value="${escAttr(p.label)}">
        </div>
        <div class="form-group">
          <label>UPRN</label>
          <input id="prop-uprn-${p.id}" value="${escAttr(p.uprn)}">
        </div>
        <div class="form-group">
          <label>Calendar type</label>
          <input value="${escAttr(calType)}" disabled style="background:var(--surface);color:var(--text-3)">
        </div>
        ${showCalPicker ? `
        <div class="form-group">
          <label>Calendar</label>
          <select id="cal-select-${p.id}" style="width:100%">
            <option value="">Loading calendars\u2026</option>
          </select>
        </div>` : ''}
        <div id="prop-save-error-${p.id}" class="form-error"></div>
        <div class="form-actions" style="flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="savePropertyEdit(${p.id})">Save</button>
          ${needsReconnect ? (p.calendar_type === 'google'
            ? `<button class="btn btn-secondary btn-sm" onclick="showGoogleReconnect(${p.id})">Reconnect Google</button>`
            : `<button class="btn btn-secondary btn-sm" onclick="showIcloudReconnect(${p.id})">Reconnect iCloud</button>`
          ) : ''}
          <button class="btn btn-danger btn-sm" id="del-btn-${p.id}" onclick="confirmDeleteProperty(${p.id})">Delete</button>
        </div>
        <div id="prop-reconnect-${p.id}"></div>
      </div>
    </div>`;
}

async function loadGoogleCalendarsForProp(propertyId, currentCalendarId) {
  const sel = document.getElementById(`cal-select-${propertyId}`);
  if (!sel) return;
  try {
    const cals = await api('GET', `/api/google/calendars/${propertyId}`);
    sel.innerHTML = cals.map(c =>
      `<option value="${escAttr(c.id)}"${c.id === currentCalendarId ? ' selected' : ''}>${escHtml(c.summary)}${c.primary ? ' (default)' : ''}</option>`
    ).join('');
  } catch (err) {
    sel.outerHTML = `<span class="form-error">Could not load calendars: ${escHtml(err.message)}</span>`;
  }
}

async function savePropertyEdit(id) {
  const label = document.getElementById(`prop-label-${id}`)?.value.trim();
  const uprn = document.getElementById(`prop-uprn-${id}`)?.value.trim();
  const errorEl = document.getElementById(`prop-save-error-${id}`);
  if (!label || !uprn) { errorEl.textContent = 'Label and UPRN are required'; return; }
  errorEl.textContent = '';
  try {
    await api('PUT', `/api/properties/${id}`, { label, uprn });
    const p = _settingsProperties.find(prop => prop.id === id);
    if (p && p.connected && p.calendar_type === 'google') {
      const calSel = document.getElementById(`cal-select-${id}`);
      if (calSel?.value) {
        await api('PUT', `/api/properties/${id}/calendar`, { calendar_id: calSel.value });
      }
    }
    showToast('Property updated');
    await renderPropertyAccordions();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

function confirmDeleteProperty(id) {
  const btn = document.getElementById(`del-btn-${id}`);
  if (!btn) return;
  btn.outerHTML = `
    <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--danger)">
      Confirm delete?
      <button class="btn btn-danger btn-sm" onclick="doDeleteProperty(${id})">Yes</button>
      <button class="btn btn-secondary btn-sm" onclick="renderPropertyAccordions()">Cancel</button>
    </span>`;
}

async function doDeleteProperty(id) {
  try {
    await api('DELETE', `/api/properties/${id}`);
    showToast('Property deleted');
    await renderPropertyAccordions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ── Google reconnect (inline) ──────────────────────────────────
async function showGoogleReconnect(id) {
  const el = document.getElementById(`prop-reconnect-${id}`);
  if (!el) return;
  el.innerHTML = `
    <div style="border-top:1px solid var(--border);margin-top:var(--space-md);padding-top:var(--space-md)">
      <div id="grecon-step1-${id}">
        <p style="font-size:12px;color:var(--text-3);margin-bottom:var(--space-sm)">
          Click below to get a Google authorisation link.
        </p>
        <button class="btn btn-secondary btn-sm" onclick="startGoogleReconnect(${id})">Get Auth Link</button>
      </div>
      <div id="grecon-step2-${id}" style="display:none">
        <p style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text)">Step 1 \u2014 Authorise Google Calendar</p>
        <p style="font-size:12px;color:var(--text-3);margin-bottom:8px">
          Open the link below in a new tab. After approving, Google redirects to a page that won&rsquo;t load &mdash; that&rsquo;s expected.
        </p>
        <a id="grecon-auth-link-${id}" href="#" target="_blank" rel="noopener"
           style="display:inline-block;margin-bottom:var(--space-md);font-size:13px">
          Open Google authorisation &rarr;
        </a>
        <p style="font-size:12px;font-weight:600;margin-bottom:4px;color:var(--text)">Step 2 \u2014 Paste the URL</p>
        <p style="font-size:12px;color:var(--text-3);margin-bottom:8px">
          Copy the full URL from your browser&rsquo;s address bar and paste it below.
        </p>
        <div class="form-group">
          <input id="grecon-url-${id}" placeholder="http://localhost:3000/auth/google/callback?code=\u2026">
        </div>
        <div id="grecon-step2-error-${id}" class="form-error"></div>
        <button class="btn btn-primary btn-sm" onclick="completeGoogleReconnect(${id})">Complete Connection</button>
      </div>
      <div id="grecon-step3-${id}" style="display:none">
        <p style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text)">Step 3 \u2014 Select Calendar</p>
        <div class="form-group">
          <select id="grecon-cal-${id}" style="width:100%">
            <option value="">Loading calendars\u2026</option>
          </select>
        </div>
        <div id="grecon-step3-error-${id}" class="form-error"></div>
        <button class="btn btn-primary btn-sm" onclick="saveGoogleReconnectCalendar(${id})">Save</button>
      </div>
    </div>`;
}

async function startGoogleReconnect(id) {
  try {
    const { authUrl } = await api('GET', `/api/google/auth-url/${id}`);
    document.getElementById(`grecon-auth-link-${id}`).href = authUrl;
    document.getElementById(`grecon-step1-${id}`).style.display = 'none';
    document.getElementById(`grecon-step2-${id}`).style.display = 'block';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function completeGoogleReconnect(id) {
  const pastedUrl = document.getElementById(`grecon-url-${id}`)?.value.trim();
  const errorEl = document.getElementById(`grecon-step2-error-${id}`);
  if (!pastedUrl) { errorEl.textContent = 'Paste the URL from your browser first'; return; }
  errorEl.textContent = '';
  try {
    await api('POST', '/api/google/complete', { pastedUrl });
    document.getElementById(`grecon-step2-${id}`).style.display = 'none';
    document.getElementById(`grecon-step3-${id}`).style.display = 'block';
    const cals = await api('GET', `/api/google/calendars/${id}`);
    const sel = document.getElementById(`grecon-cal-${id}`);
    sel.innerHTML = cals.map(c =>
      `<option value="${escAttr(c.id)}"${c.primary ? ' selected' : ''}>${escHtml(c.summary)}${c.primary ? ' (default)' : ''}</option>`
    ).join('');
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function saveGoogleReconnectCalendar(id) {
  const calId = document.getElementById(`grecon-cal-${id}`)?.value;
  const errorEl = document.getElementById(`grecon-step3-error-${id}`);
  if (!calId) { errorEl.textContent = 'Select a calendar'; return; }
  errorEl.textContent = '';
  try {
    await api('PUT', `/api/properties/${id}/calendar`, { calendar_id: calId });
    showToast('Google Calendar reconnected');
    await renderPropertyAccordions();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

// ── iCloud reconnect (inline) ──────────────────────────────────
function showIcloudReconnect(id) {
  const el = document.getElementById(`prop-reconnect-${id}`);
  if (!el) return;
  el.innerHTML = `
    <div style="border-top:1px solid var(--border);margin-top:var(--space-md);padding-top:var(--space-md)">
      <div class="form-group">
        <label>Apple ID</label>
        <input id="irc-apple-id-${id}" type="email" placeholder="you@example.com">
      </div>
      <div class="form-group">
        <label>App-specific password
          <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noopener"
             style="font-weight:normal;font-size:11px;margin-left:6px">Generate at appleid.apple.com</a>
        </label>
        <input id="irc-apple-pass-${id}" type="password" placeholder="xxxx-xxxx-xxxx-xxxx">
      </div>
      <div class="form-group">
        <button class="btn btn-secondary btn-sm" type="button" onclick="fetchIrcCalendars(${id})">Fetch Calendars</button>
        <div id="irc-cal-select-${id}" style="margin-top:8px"></div>
      </div>
      <div id="irc-error-${id}" class="form-error"></div>
      <button class="btn btn-primary btn-sm" onclick="saveIcloudReconnect(${id})">Save</button>
    </div>`;
}

async function fetchIrcCalendars(id) {
  const appleId = document.getElementById(`irc-apple-id-${id}`)?.value.trim();
  const pass = document.getElementById(`irc-apple-pass-${id}`)?.value.trim();
  const el = document.getElementById(`irc-cal-select-${id}`);
  if (!appleId || !pass) {
    el.innerHTML = '<span style="color:var(--danger);font-size:12px">Enter Apple ID and password first</span>';
    return;
  }
  el.innerHTML = '<span style="font-size:12px;color:var(--text-3)">Fetching calendars\u2026</span>';
  try {
    const cals = await api('POST', '/api/icloud/calendars', { apple_id: appleId, app_specific_password: pass });
    if (cals.length === 0) {
      el.innerHTML = '<span style="font-size:12px;color:var(--danger)">No calendars found</span>';
      return;
    }
    el.innerHTML = `<label style="margin-top:8px">Select calendar</label>
      <select id="irc-cal-url-${id}" style="width:100%;margin-top:4px">
        <option value="">Select\u2026</option>
        ${cals.map(c => `<option value="${escAttr(c.url)}">${escHtml(c.displayName)}</option>`).join('')}
      </select>`;
  } catch (err) {
    el.innerHTML = `<span style="color:var(--danger);font-size:12px">Error: ${escHtml(err.message)}</span>`;
  }
}

async function saveIcloudReconnect(id) {
  const appleId = document.getElementById(`irc-apple-id-${id}`)?.value.trim();
  const pass = document.getElementById(`irc-apple-pass-${id}`)?.value.trim();
  const calUrl = document.getElementById(`irc-cal-url-${id}`)?.value;
  const errorEl = document.getElementById(`irc-error-${id}`);
  if (!appleId || !pass || !calUrl) {
    errorEl.textContent = 'All fields are required \u2014 make sure you have fetched and selected a calendar';
    return;
  }
  errorEl.textContent = '';
  try {
    await api('POST', `/api/properties/${id}/icloud`, {
      apple_id: appleId, app_specific_password: pass, calendar_url: calUrl,
    });
    showToast('iCloud calendar reconnected');
    await renderPropertyAccordions();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

// ── Add Property accordion ─────────────────────────────────────
function buildAddPropertyAccordion() {
  const hasGoogle = CONFIG.googleConfigured;
  return `
    <div class="accordion" id="acc-add-prop">
      <div class="accordion-header" onclick="toggleAccordion('acc-add-prop')">
        <div class="accordion-header-left">
          <div>
            <div class="accordion-title" style="color:var(--primary)">+ Add Property</div>
            <div class="accordion-subtitle">Connect a new property to bin-calendar</div>
          </div>
        </div>
        <svg class="accordion-chevron" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="accordion-body" id="acc-add-prop-body">
        <div class="form-group">
          <label>Label</label>
          <input id="add-label" placeholder="e.g. Home">
        </div>
        <div class="form-group">
          <label>UPRN</label>
          <input id="add-uprn" placeholder="e.g. 127053058">
          <p style="font-size:12px;color:var(--text-3);margin-top:4px">Find your UPRN on your council&rsquo;s website or council tax letter.</p>
        </div>
        <div class="form-group">
          <label>Calendar type</label>
          <select id="add-cal-type" onchange="renderAddCalendarFields()">
            <option value="">Select\u2026</option>
            <option value="google"${!hasGoogle ? ' disabled' : ''}>Google Calendar${!hasGoogle ? ' (not configured \u2014 set GOOGLE_CLIENT_ID/SECRET)' : ''}</option>
            <option value="icloud">iCloud</option>
          </select>
        </div>
        <div id="add-calendar-fields"></div>
        <div id="add-form-error" class="form-error"></div>
      </div>
    </div>`;
}

function renderAddCalendarFields() {
  const type = document.getElementById('add-cal-type').value;
  const el = document.getElementById('add-calendar-fields');
  document.getElementById('add-form-error').textContent = '';

  if (type === 'google') {
    el.innerHTML = `
      <div id="add-google-step1">
        <p style="font-size:12px;color:var(--text-3);margin-bottom:var(--space-sm)">
          Save your property first, then authorise Google Calendar access in a new tab.
        </p>
        <div class="form-actions">
          <button class="btn btn-primary btn-sm" onclick="addSaveAndGetGoogleUrl()">Save &amp; Get Auth Link</button>
        </div>
      </div>
      <div id="add-google-step2" style="display:none">
        <p style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text)">Step 1 \u2014 Authorise Google Calendar</p>
        <p style="font-size:12px;color:var(--text-3);margin-bottom:8px">
          Click the link below. After approving, paste the redirect URL from your browser.
        </p>
        <a id="add-google-auth-link" href="#" target="_blank" rel="noopener"
           style="display:inline-block;margin-bottom:var(--space-md);font-size:13px">
          Open Google authorisation &rarr;
        </a>
        <p style="font-size:12px;font-weight:600;margin-bottom:4px;color:var(--text)">Step 2 \u2014 Paste the URL</p>
        <div class="form-group">
          <input id="add-google-callback-url" placeholder="http://localhost:3000/auth/google/callback?code=\u2026">
        </div>
        <div id="add-google-step2-error" class="form-error"></div>
        <button class="btn btn-primary btn-sm" onclick="addCompleteGoogleAuth()">Complete Connection</button>
      </div>
      <div id="add-google-step3" style="display:none">
        <p style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text)">Step 3 \u2014 Select Calendar</p>
        <div class="form-group">
          <select id="add-google-cal-select" style="width:100%">
            <option value="">Loading calendars\u2026</option>
          </select>
        </div>
        <div id="add-google-step3-error" class="form-error"></div>
        <button class="btn btn-primary btn-sm" onclick="addSaveGoogleCalendar()">Save</button>
      </div>`;
  } else if (type === 'icloud') {
    el.innerHTML = `
      <div class="form-group">
        <label>Apple ID</label>
        <input id="add-apple-id" type="email" placeholder="you@example.com">
      </div>
      <div class="form-group">
        <label>App-specific password
          <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noopener"
             style="font-weight:normal;font-size:11px;margin-left:6px">Generate at appleid.apple.com</a>
        </label>
        <input id="add-apple-pass" type="password" placeholder="xxxx-xxxx-xxxx-xxxx">
      </div>
      <div class="form-group">
        <button class="btn btn-secondary btn-sm" type="button" onclick="addFetchIcloudCalendars()">Fetch Calendars</button>
        <div id="add-cal-select" style="margin-top:8px"></div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary btn-sm" onclick="addSaveIcloud()">Save</button>
      </div>`;
  } else {
    el.innerHTML = '';
  }
}

async function addSaveAndGetGoogleUrl() {
  const label = document.getElementById('add-label')?.value.trim();
  const uprn = document.getElementById('add-uprn')?.value.trim();
  const errorEl = document.getElementById('add-form-error');
  if (!label || !uprn) { errorEl.textContent = 'Label and UPRN are required'; return; }
  errorEl.textContent = '';
  try {
    const { id } = await api('POST', '/api/properties', { label, uprn, calendar_type: 'google' });
    const { authUrl } = await api('GET', `/api/google/auth-url/${id}`);
    document.getElementById('add-google-auth-link').href = authUrl;
    document.getElementById('add-google-step1').style.display = 'none';
    document.getElementById('add-google-step2').style.display = 'block';
    document.getElementById('add-google-step2').dataset.propertyId = id;
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function addCompleteGoogleAuth() {
  const pastedUrl = document.getElementById('add-google-callback-url')?.value.trim();
  const errorEl = document.getElementById('add-google-step2-error');
  if (!pastedUrl) { errorEl.textContent = 'Paste the URL from your browser first'; return; }
  errorEl.textContent = '';
  try {
    await api('POST', '/api/google/complete', { pastedUrl });
    const propertyId = document.getElementById('add-google-step2').dataset.propertyId;
    document.getElementById('add-google-step2').style.display = 'none';
    document.getElementById('add-google-step3').style.display = 'block';
    document.getElementById('add-google-step3').dataset.propertyId = propertyId;
    const cals = await api('GET', `/api/google/calendars/${propertyId}`);
    const sel = document.getElementById('add-google-cal-select');
    sel.innerHTML = cals.map(c =>
      `<option value="${escAttr(c.id)}"${c.primary ? ' selected' : ''}>${escHtml(c.summary)}${c.primary ? ' (default)' : ''}</option>`
    ).join('');
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function addSaveGoogleCalendar() {
  const propertyId = document.getElementById('add-google-step3').dataset.propertyId;
  const calendarId = document.getElementById('add-google-cal-select').value;
  const errorEl = document.getElementById('add-google-step3-error');
  if (!calendarId) { errorEl.textContent = 'Select a calendar'; return; }
  errorEl.textContent = '';
  try {
    await api('PUT', `/api/properties/${propertyId}/calendar`, { calendar_id: calendarId });
    showToast('Google Calendar connected');
    await renderPropertyAccordions();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function addFetchIcloudCalendars() {
  const appleId = document.getElementById('add-apple-id')?.value.trim();
  const pass = document.getElementById('add-apple-pass')?.value.trim();
  const el = document.getElementById('add-cal-select');
  if (!appleId || !pass) {
    el.innerHTML = '<span style="color:var(--danger);font-size:12px">Enter Apple ID and password first</span>';
    return;
  }
  el.innerHTML = '<span style="font-size:12px;color:var(--text-3)">Fetching calendars\u2026</span>';
  try {
    const cals = await api('POST', '/api/icloud/calendars', { apple_id: appleId, app_specific_password: pass });
    if (cals.length === 0) {
      el.innerHTML = '<span style="font-size:12px;color:var(--danger)">No calendars found</span>';
      return;
    }
    el.innerHTML = `<label style="margin-top:8px">Select calendar</label>
      <select id="add-cal-url" style="width:100%;margin-top:4px">
        <option value="">Select\u2026</option>
        ${cals.map(c => `<option value="${escAttr(c.url)}">${escHtml(c.displayName)}</option>`).join('')}
      </select>`;
  } catch (err) {
    el.innerHTML = `<span style="color:var(--danger);font-size:12px">Error: ${escHtml(err.message)}</span>`;
  }
}

async function addSaveIcloud() {
  const label = document.getElementById('add-label')?.value.trim();
  const uprn = document.getElementById('add-uprn')?.value.trim();
  const appleId = document.getElementById('add-apple-id')?.value.trim();
  const pass = document.getElementById('add-apple-pass')?.value.trim();
  const calUrl = document.getElementById('add-cal-url')?.value;
  const errorEl = document.getElementById('add-form-error');
  if (!label || !uprn || !appleId || !pass || !calUrl) {
    errorEl.textContent = 'All fields are required \u2014 make sure you have fetched and selected a calendar';
    return;
  }
  errorEl.textContent = '';
  try {
    const { id } = await api('POST', '/api/properties', { label, uprn, calendar_type: 'icloud' });
    await api('POST', `/api/properties/${id}/icloud`, {
      apple_id: appleId, app_specific_password: pass, calendar_url: calUrl,
    });
    showToast('iCloud calendar connected');
    await renderPropertyAccordions();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

// ── Bin Types ──────────────────────────────────────────────────
async function renderBinTypes() {
  try {
    _binTypes = await api('GET', '/api/bin-types');
  } catch (err) {
    const el = document.getElementById('bin-types-section');
    if (el) el.innerHTML = `<p class="form-error">Failed to load bin types: ${escHtml(err.message)}</p>`;
    return;
  }

  const el = document.getElementById('bin-types-section');
  if (!el) return;

  el.innerHTML = `
    <table class="bin-types-table">
      <thead>
        <tr>
          <th>Match</th>
          <th>Label</th>
          <th>Colour</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="bin-types-tbody">
        ${_binTypes.map(bt => buildBinTypeRow(bt)).join('')}
      </tbody>
    </table>
    <div id="bin-type-add-row"></div>
    <button class="btn btn-secondary btn-sm" id="add-bin-type-btn" onclick="showAddBinTypeForm()" style="margin-top:var(--space-sm)">+ Add bin type</button>`;
}

function buildBinTypeRow(bt) {
  return `
    <tr id="bin-type-row-${bt.id}">
      <td><code>${escHtml(bt.summary_match)}</code></td>
      <td>${escHtml(bt.label)}</td>
      <td>
        <span class="bin-type-colour-swatch">
          <span class="bin-type-colour-dot" style="background:${escAttr(bt.colour)}"></span>
          ${escHtml(bt.colour)}
        </span>
      </td>
      <td style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-secondary btn-sm" onclick="editBinTypeRow(${bt.id})">Edit</button>
        <button class="btn btn-danger btn-sm" id="bt-del-btn-${bt.id}" onclick="confirmDeleteBinType(${bt.id})">Delete</button>
      </td>
    </tr>`;
}

function editBinTypeRow(id) {
  const bt = _binTypes.find(b => b.id === id);
  if (!bt) return;
  const row = document.getElementById(`bin-type-row-${id}`);
  if (!row) return;
  row.innerHTML = `
    <td><input id="bt-match-${id}" value="${escAttr(bt.summary_match)}" style="min-width:80px"></td>
    <td><input id="bt-label-${id}" value="${escAttr(bt.label)}" style="min-width:80px"></td>
    <td><input id="bt-colour-${id}" type="color" value="${escAttr(bt.colour)}" style="width:60px"></td>
    <td style="display:flex;gap:6px;align-items:center">
      <button class="btn btn-primary btn-sm" onclick="saveBinTypeEdit(${id})">Save</button>
      <button class="btn btn-secondary btn-sm" onclick="renderBinTypes()">Cancel</button>
    </td>`;
}

async function saveBinTypeEdit(id) {
  const match = document.getElementById(`bt-match-${id}`)?.value.trim();
  const label = document.getElementById(`bt-label-${id}`)?.value.trim();
  const colour = document.getElementById(`bt-colour-${id}`)?.value;
  if (!match || !label || !colour) { showToast('All fields are required', 'error'); return; }
  try {
    await api('PUT', `/api/bin-types/${id}`, { summary_match: match, label, colour });
    showToast('Bin type updated');
    await renderBinTypes();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function confirmDeleteBinType(id) {
  const btn = document.getElementById(`bt-del-btn-${id}`);
  if (!btn) return;
  btn.outerHTML = `
    <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--danger)">
      Delete?
      <button class="btn btn-danger btn-sm" onclick="doDeleteBinType(${id})">Yes</button>
      <button class="btn btn-secondary btn-sm" onclick="renderBinTypes()">No</button>
    </span>`;
}

async function doDeleteBinType(id) {
  try {
    await api('DELETE', `/api/bin-types/${id}`);
    showToast('Bin type deleted');
    await renderBinTypes();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function showAddBinTypeForm() {
  const btn = document.getElementById('add-bin-type-btn');
  if (btn) btn.style.display = 'none';
  document.getElementById('bin-type-add-row').innerHTML = `
    <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-md);margin-top:var(--space-sm)">
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:var(--space-sm);align-items:end;margin-bottom:var(--space-sm)">
        <div class="form-group" style="margin-bottom:0">
          <label>Match text</label>
          <input id="new-bt-match" placeholder="e.g. Grey">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label>Label</label>
          <input id="new-bt-label" placeholder="e.g. General Waste">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label>Colour</label>
          <input id="new-bt-colour" type="color" value="#6b7280" style="width:60px">
        </div>
      </div>
      <div id="new-bt-error" class="form-error" style="margin-bottom:var(--space-sm)"></div>
      <div style="display:flex;gap:var(--space-sm)">
        <button class="btn btn-primary btn-sm" onclick="saveNewBinType()">Add</button>
        <button class="btn btn-secondary btn-sm" onclick="cancelAddBinType()">Cancel</button>
      </div>
    </div>`;
}

function cancelAddBinType() {
  document.getElementById('bin-type-add-row').innerHTML = '';
  const btn = document.getElementById('add-bin-type-btn');
  if (btn) btn.style.display = '';
}

async function saveNewBinType() {
  const match = document.getElementById('new-bt-match')?.value.trim();
  const label = document.getElementById('new-bt-label')?.value.trim();
  const colour = document.getElementById('new-bt-colour')?.value;
  const errorEl = document.getElementById('new-bt-error');
  if (!match || !label || !colour) { errorEl.textContent = 'All fields are required'; return; }
  errorEl.textContent = '';
  try {
    await api('POST', '/api/bin-types', { summary_match: match, label, colour });
    showToast('Bin type added');
    await renderBinTypes();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

// ── XSS helpers ────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
