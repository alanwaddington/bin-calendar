const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '../../public');

// Loads the real app.js + calendar.js into a jsdom window via window.eval(),
// which (unlike require()) executes top-level `function` declarations as
// real globals on `window` — matching how the browser loads these as plain
// <script> tags with no imports/exports. fetchImpl mocks api()'s underlying
// fetch() call so tests exercise real application code against canned
// responses, not a reimplementation of it.
//
// includeDashboard (default true) also loads dashboard.js, needed for the
// navigateToProperty() handoff tests. jsdom fires DOMContentLoaded shortly
// after construction, which app.js's listener turns into an automatic
// navigate('dashboard') -> loadDashboard() in the background — harmless for
// most tests (its fetches are wrapped in Promise.allSettled), but tests that
// deliberately interleave two in-flight requests should pass false here to
// avoid an unrelated concurrent async chain complicating the timing.
function createCalendarWindow(fetchImpl, { includeDashboard = true } = {}) {
  const dom = new JSDOM(`
    <nav>
      <a class="nav-link" data-view="dashboard"></a>
      <a class="nav-link" data-view="calendar"></a>
      <a class="nav-link" data-view="settings"></a>
    </nav>
    <div id="view-dashboard" class="view"></div>
    <div id="view-calendar" class="view hidden"></div>
    <div id="view-settings" class="view hidden"></div>
  `, { url: 'http://localhost/', runScripts: 'outside-only' });

  const { window } = dom;
  window.fetch = fetchImpl;

  window.eval(fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(PUBLIC_DIR, 'calendar.js'), 'utf8'));
  if (includeDashboard) {
    window.eval(fs.readFileSync(path.join(PUBLIC_DIR, 'dashboard.js'), 'utf8'));
  }

  _openWindows.push(window);
  return window;
}

// jsdom windows keep internal timers alive until closed, which otherwise
// leaves Jest's process hanging after the run completes. Call this from an
// afterEach in any test file using createCalendarWindow.
const _openWindows = [];
function closeAllCalendarWindows() {
  while (_openWindows.length) _openWindows.pop().close();
}

function mockFetch(routes) {
  return async url => {
    for (const [pattern, body] of routes) {
      if (typeof pattern === 'string' ? url === pattern : pattern.test(url)) {
        return { ok: true, json: async () => body };
      }
    }
    throw new Error('No mock route for ' + url);
  };
}

module.exports = { createCalendarWindow, mockFetch, closeAllCalendarWindows };
