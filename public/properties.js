registerView('properties', loadProperties);


async function loadProperties() {
  const el = document.getElementById('view-properties');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>Properties</h1>
      <button class="btn btn-primary" onclick="openPropertyModal()">+ Add Property</button>
    </div>
    <div id="properties-table"></div>
    <div class="modal-overlay hidden" id="property-modal" onclick="handleModalClick(event)">
      <div class="modal">
        <div class="modal-title" id="modal-title">Add Property</div>
        <div id="modal-body"></div>
      </div>
    </div>`;
  await renderPropertiesTable();
}

async function renderPropertiesTable() {
  const properties = await api('GET', '/api/properties');
  const el = document.getElementById('properties-table');
  if (!el) return;

  if (properties.length === 0) {
    el.innerHTML = '<p style="color:#64748b;padding:16px 0">No properties yet. Click "+ Add Property" to get started.</p>';
    return;
  }

  el.innerHTML = `<table>
    <thead><tr><th>Label</th><th>UPRN</th><th>Calendar</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${properties.map(p => {
      const connected = !!p.connected;
      return `<tr>
        <td>${escHtml(p.label)}</td>
        <td><code style="font-size:12px">${escHtml(p.uprn)}</code></td>
        <td>${p.calendar_type === 'google' ? 'Google' : 'iCloud'}</td>
        <td>${connected
          ? '<span class="badge badge-success">Connected</span>'
          : '<span class="badge badge-warning">Not connected</span>'}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap">
          ${!connected && p.calendar_type === 'google'
            ? `<button class="btn btn-sm btn-secondary" onclick="reconnectGoogle(${p.id})">Reconnect</button>`
            : ''}
          <button class="btn btn-sm btn-danger" onclick="deleteProperty(${p.id}, '${escHtml(p.label)}')">Delete</button>
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function openPropertyModal() {
  document.getElementById('modal-title').textContent = 'Add Property';
  document.getElementById('property-modal').classList.remove('hidden');
  renderPropertyForm();
}

function closeModal() {
  document.getElementById('property-modal').classList.add('hidden');
}

function handleModalClick(event) {
  if (event.target === event.currentTarget) closeModal();
}

function renderPropertyForm() {
  const body = document.getElementById('modal-body');
  const hasLookup = CONFIG.addressLookupConfigured;
  const hasGoogle = CONFIG.googleConfigured;

  body.innerHTML = `
    ${hasLookup ? `
    <div class="form-group">
      <label>Find address by postcode</label>
      <div style="display:flex;gap:8px">
        <input id="postcode-input" placeholder="e.g. KA1 1AB" style="flex:1">
        <button class="btn btn-secondary" type="button" onclick="lookupAddress()">Search</button>
      </div>
      <div id="address-results" style="margin-top:6px;font-size:12px;color:#64748b"></div>
    </div>` : ''}
    <div class="form-group">
      <label>Label</label>
      <input id="prop-label" placeholder="e.g. Home">
    </div>
    <div class="form-group">
      <label>UPRN</label>
      <input id="prop-uprn" placeholder="e.g. 127053058">
    </div>
    <div class="form-group">
      <label>Calendar type</label>
      <select id="prop-type" onchange="renderCalendarFields()">
        <option value="">Select...</option>
        <option value="google" ${!hasGoogle ? 'disabled' : ''}>
          Google Calendar${!hasGoogle ? ' (not configured — set GOOGLE_CLIENT_ID/SECRET)' : ''}
        </option>
        <option value="icloud">iCloud</option>
      </select>
    </div>
    <div id="calendar-fields"></div>
    <div id="form-error" class="form-error"></div>`;
}

function renderCalendarFields() {
  const type = document.getElementById('prop-type').value;
  const el = document.getElementById('calendar-fields');
  document.getElementById('form-error').textContent = '';

  if (type === 'google') {
    el.innerHTML = `
      <div id="google-step-1">
        <p style="font-size:12px;color:#64748b;margin-bottom:12px">
          Save your property first, then authorise Google Calendar access in a new tab.
        </p>
        <div class="form-actions">
          <button class="btn btn-primary" onclick="saveAndGetGoogleUrl()">Save &amp; Get Auth Link</button>
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
      </div>
      <div id="google-step-2" style="display:none">
        <p style="font-size:12px;font-weight:600;margin-bottom:8px">Step 1 — Authorise Google Calendar</p>
        <p style="font-size:12px;color:#64748b;margin-bottom:10px">
          Click the link below to open Google's authorisation page in a new tab.
          After you approve access, Google will redirect to a page that won't load — that's expected.
        </p>
        <a id="google-auth-link" href="#" target="_blank" rel="noopener"
           style="display:inline-block;margin-bottom:16px;font-size:13px;color:#3b82f6">
          Open Google authorisation &rarr;
        </a>
        <p style="font-size:12px;font-weight:600;margin-bottom:4px">Step 2 — Paste the URL</p>
        <p style="font-size:12px;color:#64748b;margin-bottom:8px">
          Copy the full URL from your browser's address bar (starting with <code>http://localhost...</code>) and paste it below.
        </p>
        <div class="form-group">
          <input id="google-callback-url" placeholder="http://localhost:3000/auth/google/callback?code=...">
        </div>
        <div id="google-complete-error" class="form-error"></div>
        <div class="form-actions">
          <button class="btn btn-primary" onclick="completeGoogleAuth()">Complete Connection</button>
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
      </div>
      <div id="google-step-3" style="display:none">
        <p style="font-size:12px;font-weight:600;margin-bottom:8px">Step 3 — Select Calendar</p>
        <p style="font-size:12px;color:#64748b;margin-bottom:10px">Choose which Google Calendar to sync bin collections into.</p>
        <div class="form-group">
          <select id="google-calendar-select" style="width:100%">
            <option value="">Loading calendars...</option>
          </select>
        </div>
        <div id="google-step-3-error" class="form-error"></div>
        <div class="form-actions">
          <button class="btn btn-primary" onclick="saveGoogleCalendar()">Save</button>
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
      </div>`;
  } else if (type === 'icloud') {
    el.innerHTML = `
      <div class="form-group">
        <label>Apple ID</label>
        <input id="apple-id" type="email" placeholder="you@example.com">
      </div>
      <div class="form-group">
        <label>
          App-specific password
          <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noopener"
             style="font-weight:normal;font-size:11px;margin-left:6px">Generate at appleid.apple.com</a>
        </label>
        <input id="apple-pass" type="password" placeholder="xxxx-xxxx-xxxx-xxxx">
      </div>
      <div class="form-group">
        <button class="btn btn-secondary" type="button" onclick="fetchIcloudCalendars()">Fetch Calendars</button>
        <div id="calendar-select" style="margin-top:8px"></div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="saveIcloud()">Save</button>
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      </div>`;
  } else {
    el.innerHTML = '';
  }
}

async function lookupAddress() {
  const postcode = document.getElementById('postcode-input')?.value.trim();
  const el = document.getElementById('address-results');
  if (!postcode) { el.textContent = 'Enter a postcode first'; return; }
  el.textContent = 'Searching...';
  try {
    const suggestions = await api('GET', `/api/uprn/lookup?postcode=${encodeURIComponent(postcode)}`);
    if (suggestions.length === 0) {
      el.textContent = 'No addresses found for that postcode';
      return;
    }
    el.innerHTML = `<select id="address-select" style="width:100%;margin-top:4px">
      <option value="">Select address...</option>
      ${suggestions.map(s => `<option value="${escAttr(s.id)}">${escHtml(s.address)}</option>`).join('')}
    </select>`;
    document.getElementById('address-select').addEventListener('change', async function () {
      if (!this.value) return;
      try {
        const detail = await api('GET', `/api/uprn/detail?id=${encodeURIComponent(this.value)}`);
        if (detail.uprn) document.getElementById('prop-uprn').value = detail.uprn;
      } catch (err) {
        el.textContent = `Could not retrieve UPRN: ${err.message}`;
      }
    });
  } catch {
    el.textContent = 'Address lookup unavailable — enter your UPRN manually';
  }
}

async function saveAndGetGoogleUrl() {
  const label = document.getElementById('prop-label')?.value.trim();
  const uprn = document.getElementById('prop-uprn')?.value.trim();
  if (!label || !uprn) {
    document.getElementById('form-error').textContent = 'Label and UPRN are required';
    return;
  }
  try {
    const { id } = await api('POST', '/api/properties', { label, uprn, calendar_type: 'google' });
    const { authUrl } = await api('GET', `/api/google/auth-url/${id}`);
    document.getElementById('google-auth-link').href = authUrl;
    document.getElementById('google-step-1').style.display = 'none';
    document.getElementById('google-step-2').style.display = 'block';
    // Store property id for the complete step
    document.getElementById('google-step-2').dataset.propertyId = id;
  } catch (err) {
    document.getElementById('form-error').textContent = err.message;
  }
}

async function completeGoogleAuth() {
  const pastedUrl = document.getElementById('google-callback-url')?.value.trim();
  const errorEl = document.getElementById('google-complete-error');
  if (!pastedUrl) { errorEl.textContent = 'Paste the URL from your browser first'; return; }
  errorEl.textContent = '';
  try {
    await api('POST', '/api/google/complete', { pastedUrl });
    const propertyId = document.getElementById('google-step-2').dataset.propertyId;
    document.getElementById('google-step-2').style.display = 'none';
    document.getElementById('google-step-3').style.display = 'block';
    document.getElementById('google-step-3').dataset.propertyId = propertyId;
    // Load calendars
    const cals = await api('GET', `/api/google/calendars/${propertyId}`);
    const sel = document.getElementById('google-calendar-select');
    sel.innerHTML = cals.map(c =>
      `<option value="${escAttr(c.id)}"${c.primary ? ' selected' : ''}>${escHtml(c.summary)}${c.primary ? ' (default)' : ''}</option>`
    ).join('');
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function saveGoogleCalendar() {
  const propertyId = document.getElementById('google-step-3').dataset.propertyId;
  const calendarId = document.getElementById('google-calendar-select').value;
  const errorEl = document.getElementById('google-step-3-error');
  if (!calendarId) { errorEl.textContent = 'Select a calendar'; return; }
  errorEl.textContent = '';
  try {
    await api('PUT', `/api/properties/${propertyId}/calendar`, { calendar_id: calendarId });
    closeModal();
    showToast('Google Calendar connected');
    await renderPropertiesTable();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function fetchIcloudCalendars() {
  const appleId = document.getElementById('apple-id')?.value.trim();
  const pass = document.getElementById('apple-pass')?.value.trim();
  const el = document.getElementById('calendar-select');
  if (!appleId || !pass) { el.innerHTML = '<span style="color:#dc2626;font-size:12px">Enter Apple ID and password first</span>'; return; }
  el.innerHTML = '<span style="font-size:12px;color:#64748b">Fetching calendars...</span>';
  try {
    const cals = await api('POST', '/api/icloud/calendars', { apple_id: appleId, app_specific_password: pass });
    if (cals.length === 0) { el.innerHTML = '<span style="font-size:12px;color:#dc2626">No calendars found</span>'; return; }
    el.innerHTML = `<label style="margin-top:8px">Select calendar</label>
      <select id="cal-url" style="width:100%;margin-top:4px">
        <option value="">Select...</option>
        ${cals.map(c => `<option value="${escAttr(c.url)}">${escHtml(c.displayName)}</option>`).join('')}
      </select>`;
  } catch (err) {
    el.innerHTML = `<span style="color:#dc2626;font-size:12px">Error: ${escHtml(err.message)}</span>`;
  }
}

async function saveIcloud() {
  const label = document.getElementById('prop-label')?.value.trim();
  const uprn = document.getElementById('prop-uprn')?.value.trim();
  const appleId = document.getElementById('apple-id')?.value.trim();
  const pass = document.getElementById('apple-pass')?.value.trim();
  const calUrl = document.getElementById('cal-url')?.value;
  const errorEl = document.getElementById('form-error');

  if (!label || !uprn || !appleId || !pass || !calUrl) {
    errorEl.textContent = 'All fields are required — make sure you have fetched and selected a calendar';
    return;
  }
  errorEl.textContent = '';
  try {
    const { id } = await api('POST', '/api/properties', { label, uprn, calendar_type: 'icloud' });
    await api('POST', `/api/properties/${id}/icloud`, {
      apple_id: appleId,
      app_specific_password: pass,
      calendar_url: calUrl,
    });
    closeModal();
    showToast('iCloud calendar connected');
    await renderPropertiesTable();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function deleteProperty(id, label) {
  if (!confirm(`Delete "${label}"? Sync logs will be retained.`)) return;
  try {
    await api('DELETE', `/api/properties/${id}`);
    await renderPropertiesTable();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function reconnectGoogle(id) {
  openPropertyModal();
  // Switch directly to step 2 for an existing property
  document.getElementById('prop-type').value = 'google';
  renderCalendarFields();
  try {
    const { authUrl } = await api('GET', `/api/google/auth-url/${id}`);
    document.getElementById('google-auth-link').href = authUrl;
    document.getElementById('google-step-1').style.display = 'none';
    document.getElementById('google-step-2').style.display = 'block';
    document.getElementById('google-step-2').dataset.propertyId = id;
  } catch (err) {
    document.getElementById('form-error').textContent = err.message;
  }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function escAttr(str) {
  return String(str).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
