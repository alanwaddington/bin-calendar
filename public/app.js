// ── Config ─────────────────────────────────────────────────────────────────
let CONFIG = {};
fetch('/api/config').then(r => r.json()).then(c => { CONFIG = c; }).catch(() => {});

// ── API helper ─────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Router ─────────────────────────────────────────────────────────────────
const viewLoaders = {};

function navigate(view) {
  if (!['dashboard', 'settings', 'logs'].includes(view)) view = 'dashboard';
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach(el => {
    el.classList.remove('view-enter');
    el.classList.toggle('hidden', el.id !== `view-${view}`);
  });
  const activeView = document.getElementById(`view-${view}`);
  if (activeView) {
    void activeView.offsetWidth; // trigger reflow to restart animation
    activeView.classList.add('view-enter');
  }
  location.hash = view;
  if (viewLoaders[view]) viewLoaders[view]();
}

document.querySelectorAll('.nav-link, .topnav-brand').forEach(a => {
  a.addEventListener('click', e => { e.preventDefault(); navigate(a.dataset.view); });
});

window.addEventListener('DOMContentLoaded', () => {
  const hash = location.hash.replace('#', '') || 'dashboard';
  navigate(hash);
});

// ── Register view loaders ──────────────────────────────────────────────────
function registerView(name, loader) {
  viewLoaders[name] = loader;
}

// ── Toast notifications ────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-exit');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  }, 3000);
}
