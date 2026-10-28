const { createLogsWindow, mockFetch, closeAllCalendarWindows } = require('../helpers/browserDom');

afterEach(() => {
  closeAllCalendarWindows();
});

// PR #34 review finding M3: events_deleted was recorded in sync_results
// and already returned by GET /api/sync/runs, but never rendered - the
// one irreversible action in the app (deleting a user's own calendar
// events on Garden Waste opt-out) was invisible in the one place a user
// would look to confirm what a sync run did.
describe('logs.js - events_deleted (#34 review finding M3)', () => {
  test('renderLogResult_withEventsDeletedNonZero_showsDeletedCount', async () => {
    const window = createLogsWindow(mockFetch([
      ['/api/sync/runs', {
        runs: [{ id: 1, status: 'success', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:00:03Z' }],
        results: [{ run_id: 1, label: 'Home', events_added: 2, events_skipped: 5, events_deleted: 1, error: null, started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:00:02Z' }],
      }],
    ]));

    await window.loadLogs();
    const body = window.document.querySelector('.log-run-body').innerHTML;

    expect(body).toMatch(/deleted:\s*1/);
  });

  test('renderLogResult_withEventsDeletedZero_omitsDeletedEntirely', async () => {
    const window = createLogsWindow(mockFetch([
      ['/api/sync/runs', {
        runs: [{ id: 1, status: 'success', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:00:03Z' }],
        results: [{ run_id: 1, label: 'Home', events_added: 2, events_skipped: 5, events_deleted: 0, error: null, started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:00:02Z' }],
      }],
    ]));

    await window.loadLogs();
    const body = window.document.querySelector('.log-run-body').innerHTML;

    expect(body).not.toMatch(/deleted:/);
    // Existing rendering must be completely unaffected for the common case.
    expect(body).toMatch(/added:\s*2,\s*skipped:\s*5/);
  });

  test('renderLogResult_withEventsDeletedMissing_doesNotThrow', async () => {
    // Older sync_results rows (pre-migration-007) won't have the column at
    // all - must render gracefully, not crash the whole Logs page.
    const window = createLogsWindow(mockFetch([
      ['/api/sync/runs', {
        runs: [{ id: 1, status: 'success', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:00:03Z' }],
        results: [{ run_id: 1, label: 'Home', events_added: 2, events_skipped: 5, error: null, started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:00:02Z' }],
      }],
    ]));

    await expect(window.loadLogs()).resolves.not.toThrow();
    const body = window.document.querySelector('.log-run-body').innerHTML;
    expect(body).not.toMatch(/deleted:/);
  });

  test('renderLogResult_withEventsDeleted_stylesItDistinctlyFromAddedAndSkipped', async () => {
    const window = createLogsWindow(mockFetch([
      ['/api/sync/runs', {
        runs: [{ id: 1, status: 'success', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:00:03Z' }],
        results: [{ run_id: 1, label: 'Home', events_added: 2, events_skipped: 5, events_deleted: 1, error: null, started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:00:02Z' }],
      }],
    ]));

    await window.loadLogs();
    const body = window.document.querySelector('.log-run-body').innerHTML;

    expect(body).toMatch(/color:\s*var\(--warning\)/);
  });
});
