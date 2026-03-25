registerView('dashboard', loadDashboard);

async function loadDashboard() {
  const el = document.getElementById('view-dashboard');
  el.innerHTML = '<h1>Dashboard</h1><div id="sync-bar" class="sync-bar"></div><div id="property-cards" class="card-grid"></div>';
  await renderDashboard();
}

async function renderDashboard() {
  try {
    const [properties, { runs }, health] = await Promise.all([
      api('GET', '/api/properties'),
      api('GET', '/api/sync/runs'),
      fetch('/health').then(r => r.json()),
    ]);

    const lastRun = runs[0];
    const isRunning = lastRun?.status === 'running';
    const nextDate = new Date(health.nextSync).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    document.getElementById('sync-bar').innerHTML = `
      <div style="font-size:13px">
        Next sync: <strong>${nextDate}</strong>
        ${lastRun ? `&nbsp;&middot;&nbsp; Last run: <span class="badge badge-${lastRun.status}">${lastRun.status}</span>` : ''}
      </div>
      <button class="btn btn-primary" id="sync-now-btn" ${isRunning ? 'disabled' : ''}>
        ${isRunning ? 'Sync in progress...' : 'Sync Now'}
      </button>`;

    document.getElementById('sync-now-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('sync-now-btn');
      btn.disabled = true;
      btn.textContent = 'Sync in progress...';
      try {
        const result = await api('POST', '/api/sync');
        showToast(`Sync complete: ${result.overallStatus || result.message}`);
      } catch (err) {
        showToast(err.message, 'error');
      }
      await renderDashboard();
    });

    const cards = document.getElementById('property-cards');
    if (properties.length === 0) {
      cards.innerHTML = `<p style="color:#64748b">No properties configured. Go to
        <a href="#" onclick="navigate('properties');return false">Properties</a> to add one.</p>`;
      return;
    }

    cards.innerHTML = properties.map(p => {
      const calLabel = p.calendar_type === 'google' ? 'Google Calendar' : 'iCloud';
      const connected = !!p.connected;
      return `<div class="card">
        <div class="card-label">${calLabel}</div>
        <div class="card-value">${escHtml(p.label)}</div>
        <div style="margin-top:6px;font-size:12px;color:#64748b">UPRN: ${escHtml(p.uprn)}</div>
        <div style="margin-top:8px">
          ${connected
            ? '<span class="badge badge-success">Connected</span>'
            : '<span class="badge badge-warning">Not connected</span>'}
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    document.getElementById('view-dashboard').innerHTML =
      `<p style="color:#dc2626">Error loading dashboard: ${escHtml(err.message)}</p>`;
  }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
