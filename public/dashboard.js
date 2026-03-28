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
      <div>
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-3);margin-bottom:4px">Next Sync</div>
        <div style="font-family:var(--font-display);font-size:15px;font-weight:600;color:var(--text)">${nextDate}</div>
        ${lastRun ? `<div style="margin-top:6px;display:flex;align-items:center;gap:8px"><span style="font-size:11px;color:var(--text-3)">Last run</span><span class="badge badge-${lastRun.status}">${lastRun.status}</span></div>` : ''}
      </div>
      <button class="btn btn-primary" id="sync-now-btn" ${isRunning ? 'disabled' : ''}>
        ${isRunning ? 'Syncing\u2026' : 'Sync Now'}
      </button>`;

    document.getElementById('sync-now-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('sync-now-btn');
      btn.disabled = true;
      btn.textContent = 'Syncing\u2026';
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
      cards.innerHTML = `<p style="color:var(--text-3)">No properties configured. Go to
        <a href="#" onclick="navigate('properties');return false">Properties</a> to add one.</p>`;
      return;
    }

    cards.innerHTML = properties.map((p, i) => {
      const calLabel = p.calendar_type === 'google' ? 'Google Calendar' : 'iCloud';
      const connected = !!p.connected;
      const credInvalid = connected && p.credential_status === 'invalid';
      const checkedAt = p.credential_checked_at
        ? new Date(p.credential_checked_at + 'Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : null;
      return `<div class="card" style="animation-delay:${i * 0.08}s">
        <div class="card-label">${calLabel}</div>
        <div class="card-value">${escHtml(p.label)}</div>
        <div style="margin-top:6px;font-size:12px;color:var(--text-3)">UPRN: ${escHtml(p.uprn)}</div>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:4px">
          ${credInvalid
            ? '<span class="badge badge-error">Credentials expired</span>'
            : connected
              ? '<span class="badge badge-success">Connected</span>'
              : '<span class="badge badge-warning">Not connected</span>'}
          ${checkedAt ? `<span style="font-size:11px;color:var(--text-3)">Checked ${escHtml(checkedAt)}</span>` : ''}
        </div>
        ${credInvalid
          ? `<div style="margin-top:12px"><button class="btn btn-sm btn-secondary" onclick="navigate('properties')">Reconnect</button></div>`
          : ''}
      </div>`;
    }).join('');
  } catch (err) {
    document.getElementById('view-dashboard').innerHTML =
      `<p style="color:var(--danger)">Error loading dashboard: ${escHtml(err.message)}</p>`;
  }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
