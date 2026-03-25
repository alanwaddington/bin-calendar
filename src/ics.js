const ical = require('node-ical');

const EAC_URL = 'https://www.east-ayrshire.gov.uk/WasteCalendarICSDownload';
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

async function fetchWithRetry(uprn) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * Math.pow(2, attempt - 1)); // 1s, 2s, 4s
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(EAC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `uprn=${encodeURIComponent(uprn)}&captchaResponse=`,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
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

async function fetchIcs(uprn) {
  const icsText = await fetchWithRetry(uprn);
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

module.exports = { fetchIcs, parseIcs };
