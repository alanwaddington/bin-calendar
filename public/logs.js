registerView('logs', loadLogs);

async function loadLogs() {
  const el = document.getElementById('view-logs');
  el.innerHTML = '<h1>Logs</h1><div id="logs-list"></div>';
  try {
    const { runs, results } = await api('GET', '/api/sync/runs');
    renderLogs(runs, results);
  } catch (err) {
    document.getElementById('logs-list').innerHTML =
      `<p style="color:var(--danger)">Error loading logs: ${escLogHtml(err.message)}</p>`;
  }
}

function renderLogs(runs, results) {
  const list = document.getElementById('logs-list');
  if (!list) return;

  if (runs.length === 0) {
    list.innerHTML = '<p style="color:var(--text-3)">No sync runs yet.</p>';
    return;
  }

  list.innerHTML = runs.map(run => {
    const runResults = results.filter(r => r.run_id === run.id);
    const duration = run.completed_at
      ? Math.round((new Date(run.completed_at) - new Date(run.started_at)) / 1000) + 's'
      : '\u2014';
    const dateStr = new Date(run.started_at).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    return `<div class="log-run">
      <div class="log-run-header" onclick="this.nextElementSibling.classList.toggle('open')">
        <span class="badge badge-${run.status}">${run.status}</span>
        <span style="font-size:13px;color:var(--text-2)">${escLogHtml(dateStr)}</span>
        <span style="font-size:12px;color:var(--text-3);margin-left:auto">${escLogHtml(duration)}</span>
        ${run.error ? `<span style="font-size:12px;color:var(--danger);margin-left:8px">${escLogHtml(run.error)}</span>` : ''}
      </div>
      <div class="log-run-body">
        ${runResults.length === 0
          ? '<div class="log-result" style="color:var(--text-3)">No property results recorded</div>'
          : runResults.map(r => renderLogResult(r)).join('')}
      </div>
    </div>`;
  }).join('');
}

function renderLogResult(r) {
  const label = r.label ? escLogHtml(r.label) : '<em style="color:var(--text-3)">(deleted property)</em>';
  const dur = r.started_at && r.completed_at
    ? ` &middot; ${Math.round((new Date(r.completed_at) - new Date(r.started_at)) / 1000)}s`
    : '';
  // PR #34 review finding M3: events_deleted was recorded and already
  // returned by the API, but never rendered here - the one irreversible
  // action in the app (removing events from the user's own external
  // calendar on Garden Waste opt-out) was invisible in the one place a
  // user would look to confirm what a sync run did. Shown only when
  // non-zero, so the common case (a property that never opts out) is
  // completely unaffected; styled in var(--warning) rather than
  // var(--danger) since a successful opted-out deletion is expected
  // behaviour, not an error, but still worth distinguishing from the
  // neutral added/skipped counts.
  const deletedPart = r.events_deleted
    ? `, <span style="color:var(--warning);font-weight:600">deleted: ${r.events_deleted}</span>`
    : '';
  return `<div class="log-result">
    <strong style="color:var(--text)">${label}</strong>
    <span style="color:var(--text-3)">&nbsp;&mdash;&nbsp;</span>added: ${r.events_added}, skipped: ${r.events_skipped}${deletedPart}${dur}
    ${r.error ? `<span style="color:var(--danger)"> &mdash; ${escLogHtml(r.error)}</span>` : ''}
  </div>`;
}

function escLogHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
