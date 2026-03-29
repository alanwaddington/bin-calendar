registerView('dashboard', loadDashboard);

async function loadDashboard() {
  const el = document.getElementById('view-dashboard');

  el.innerHTML = `
    <div class="section-label">NEXT COLLECTION</div>
    <div class="hero-card" id="hero-card">
      <div class="hero-card-empty" style="opacity:0.4">Loading\u2026</div>
    </div>

    <div class="section-label" style="margin-top:var(--space-lg)">YOUR PROPERTIES</div>
    <div class="tile-grid" id="property-tiles"></div>

    <div class="section-label">SYNC HEALTH</div>
    <div class="sync-health" id="sync-health">
      <div class="sync-health-left">
        <div class="sparkline" id="sparkline">
          ${Array(7).fill('<div class="spark-dot empty"></div>').join('')}
        </div>
        <div class="sync-meta" id="sync-meta"></div>
      </div>
      <button class="btn btn-primary btn-sm" id="sync-now-btn" onclick="syncNow()">Sync Now</button>
    </div>`;

  await refreshDashboard();
}

async function refreshDashboard() {
  const [nextCollection, properties, syncData, health] = await Promise.allSettled([
    api('GET', '/api/next-collection'),
    api('GET', '/api/properties'),
    api('GET', '/api/sync/runs'),
    api('GET', '/health'),
  ]);

  renderHeroCard(nextCollection.status === 'fulfilled' ? nextCollection.value : null);
  renderPropertyTiles(properties.status === 'fulfilled' ? properties.value : []);
  renderSparkline(
    syncData.status === 'fulfilled' ? syncData.value.runs : [],
    health.status === 'fulfilled' ? health.value.nextSync : null
  );
}

function renderHeroCard(data) {
  const el = document.getElementById('hero-card');
  if (!el) return;

  if (!data || !data.collections || data.collections.length === 0) {
    el.innerHTML = `<div class="hero-card-empty">No upcoming collections found \u2014 sync to update</div>`;
    return;
  }

  const { collections } = data;
  const first = collections[0];

  // Parse date as local time to avoid UTC offset shifting the displayed day
  const [y, m, d] = first.date.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const formattedDate = date.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const days = first.daysUntil;
  const daysText = days <= 0 ? 'Today'
    : days === 1 ? 'Tomorrow'
    : `${days} days away`;

  // De-duplicate bins by label (multiple properties may share the same bin type)
  const seenLabels = new Set();
  const uniqueBins = collections.filter(c => {
    if (seenLabels.has(c.label)) return false;
    seenLabels.add(c.label);
    return true;
  });

  const uniquePropertyIds = [...new Set(collections.map(c => c.propertyId))];
  const propertyText = uniquePropertyIds.length === 1
    ? escHtml(collections[0].propertyLabel)
    : 'Multiple properties';

  el.innerHTML = `
    <div class="hero-date">${escHtml(formattedDate)}</div>
    <div class="hero-days">${escHtml(daysText)}</div>
    <div class="hero-bins">
      ${uniqueBins.map(bin =>
        `<div class="hero-bin-chip" style="color:${escAttr(bin.colour)}">${escHtml(bin.label)}</div>`
      ).join('')}
    </div>
    <div class="hero-property">${propertyText}</div>`;
}

function renderPropertyTiles(properties) {
  const el = document.getElementById('property-tiles');
  if (!el) return;

  const tiles = properties.map(p => {
    let statusClass, statusText;
    if (!p.connected) {
      statusClass = 'disconnected';
      statusText = 'Action required';
    } else if (p.credential_status === 'invalid') {
      statusClass = 'invalid';
      statusText = 'Action required';
    } else if (p.credential_status === 'unknown') {
      statusClass = 'unknown';
      statusText = 'Needs attention';
    } else {
      statusClass = 'ok';
      statusText = 'Connected';
    }

    const calType = p.calendar_type === 'google' ? 'Google Calendar' : 'iCloud';

    return `
      <button class="property-tile status-${escAttr(statusClass)}" onclick="navigate('settings')">
        <div class="tile-label">${escHtml(p.label)}</div>
        <div class="tile-type">${escHtml(calType)}</div>
        <div class="tile-status">${escHtml(statusText)}</div>
      </button>`;
  }).join('');

  el.innerHTML = tiles + `<button class="tile-add" onclick="navigate('settings')">+ Add property</button>`;
}

function renderSparkline(runs, nextSync) {
  const sparkEl = document.getElementById('sparkline');
  const metaEl = document.getElementById('sync-meta');
  if (!sparkEl) return;

  // Take the 7 most recent runs; reverse so oldest is on the left
  const recent = runs.slice(0, 7).reverse();
  const emptyCount = 7 - recent.length;

  const dots = [
    ...Array(emptyCount).fill(null),
    ...recent,
  ];

  sparkEl.innerHTML = dots.map(run => {
    if (!run) return `<div class="spark-dot empty"></div>`;

    const dotClass = run.status === 'success' ? 'success'
      : (run.status === 'failed' || run.status === 'partial') ? 'failed'
      : 'empty';

    const dateStr = new Date(run.started_at).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short',
    });
    const tooltip = `${dateStr} \u2014 ${run.status}`;

    return `<div class="spark-dot ${escAttr(dotClass)}" data-tooltip="${escAttr(tooltip)}"></div>`;
  }).join('');

  if (metaEl && nextSync) {
    const formatted = new Date(nextSync).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    metaEl.textContent = `Next auto-sync: ${formatted}`;
  }
}

async function syncNow() {
  const btn = document.getElementById('sync-now-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Syncing\u2026';
  }
  try {
    const result = await api('POST', '/api/sync');
    if (result.status === 429) {
      showToast('Sync already in progress', 'error');
      return;
    }
    const label = result.overallStatus === 'success' ? 'Sync complete'
      : result.overallStatus === 'skipped' ? 'Nothing to sync \u2014 add a property first'
      : `Sync ${result.overallStatus}`;
    showToast(label, result.overallStatus === 'failed' ? 'error' : 'success');

    // Refresh hero card and sparkline without reloading properties
    const [nextCollection, syncData, health] = await Promise.allSettled([
      api('GET', '/api/next-collection'),
      api('GET', '/api/sync/runs'),
      api('GET', '/health'),
    ]);
    renderHeroCard(nextCollection.status === 'fulfilled' ? nextCollection.value : null);
    renderSparkline(
      syncData.status === 'fulfilled' ? syncData.value.runs : [],
      health.status === 'fulfilled' ? health.value.nextSync : null
    );
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Sync Now';
    }
  }
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
