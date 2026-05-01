const ical = require('node-ical');

const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

function normaliseIcsUrl(url) {
  return url.replace(/^webcal:\/\//, 'https://');
}

async function fetchWithRetry(icsUrl) {
  const url = normaliseIcsUrl(icsUrl);
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * Math.pow(2, attempt - 1)); // 1s, 2s, 4s
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        if (res.status >= 400 && res.status < 500) throw Object.assign(err, { fatal: true });
        throw err;
      }
      return await res.text();
    } catch (err) {
      if (err.fatal) throw err;
      lastError = err;
    }
  }
  throw new Error(`ICS fetch failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
}

function parseIcs(icsText) {
  const parsed = ical.sync.parseICS(icsText);
  const events = [];
  const warnings = [];

  for (const [, entry] of Object.entries(parsed)) {
    if (entry.type !== 'VEVENT') continue;
    if (!entry.uid) {
      warnings.push('VEVENT missing UID — skipped');
      continue;
    }
    events.push({
      uid: entry.uid,
      summary: extractText(entry.summary) || 'Bin Collection',
      start: entry.start,
      end: entry.end,
      description: entry.description || '',
      allDay: entry.datetype === 'date',
    });
  }

  return { events, warnings };
}

async function fetchIcs(icsUrl) {
  const icsText = await fetchWithRetry(icsUrl);
  return parseIcs(icsText);
}

// node-ical returns parameterised properties (e.g. SUMMARY;LANGUAGE=en-gb) as objects with a val field
function extractText(value) {
  if (!value) return '';
  if (typeof value === 'object') return String(value.val || '').trim();
  return String(value).trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { fetchIcs, parseIcs, normaliseIcsUrl };
