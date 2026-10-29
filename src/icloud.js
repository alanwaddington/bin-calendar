const { DAVClient } = require('tsdav');
const { decryptJson } = require('./crypto');

const CALDAV_URL = 'https://caldav.icloud.com';

async function createClient(credentials) {
  const { apple_id, app_specific_password } = credentials;
  const client = new DAVClient({
    serverUrl: CALDAV_URL,
    credentials: { username: apple_id, password: app_specific_password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  await client.login();
  return client;
}

async function fetchCalendars(appleId, appPassword) {
  const client = await createClient({ apple_id: appleId, app_specific_password: appPassword });
  const collections = await client.fetchCalendars();
  return collections.map(c => ({ displayName: c.displayName, url: c.url }));
}

// PR #37 review suggestion S1: RFC 5545 §3.1 content lines SHOULD be
// folded at or before 75 octets, by inserting CRLF followed by a single
// leading space/tab before continuing. Without this, a long SUMMARY (the
// real East Ayrshire combined-day text comfortably exceeds the limit
// once "SUMMARY:" itself is counted in) risked being folded by the
// CalDAV SERVER on storage instead - which a single-line regex can't see
// past, so the compare-before-write check in sync.js would never find a
// match and rewrite the event on every single run. Folding here keeps
// bin-calendar in control of exactly where any fold lands. Byte-exact
// (not character-exact) so it round-trips perfectly with unfoldLines()
// regardless of where a split lands.
const MAX_LINE_OCTETS = 75;

function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= MAX_LINE_OCTETS) return line;
  const parts = [];
  let start = 0;
  let limit = MAX_LINE_OCTETS;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-octet UTF-8 sequence - back off to the nearest
    // byte that isn't a continuation byte (10xxxxxx).
    while (end > start && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = MAX_LINE_OCTETS - 1; // each continuation line loses 1 octet to its own leading space
  }
  return parts.join('\r\n ');
}

// The inverse of foldLine(): CRLF immediately followed by a single space
// or tab is a fold marker, not a real line break - remove it to recover
// the original unfolded content line before any field is parsed out of
// data a CalDAV server returned (UID, SUMMARY, or anything else).
function unfoldLines(iCalString) {
  return iCalString == null ? iCalString : iCalString.replace(/\r\n[ \t]/g, '');
}

// #33: deletion needs each object's url/etag (deleteCalendarObject's own
// requirement), which is why this returns the full dav object per uid
// rather than just a set of uids.
async function listEventObjects(property, timeMin, timeMax) {
  const creds = decryptJson(property.credentials);
  const client = await createClient(creds);
  const objects = await client.fetchCalendarObjects({
    calendar: { url: property.calendar_id },
    timeRange: { start: timeMin.toISOString(), end: timeMax.toISOString() },
  });
  const byUid = new Map();
  for (const obj of objects) {
    const match = unfoldLines(obj.data)?.match(/^UID:(.+)$/m);
    if (match) byUid.set(match[1].trim(), obj);
  }
  return byUid;
}

function buildVCalendarString(event) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//bin-calendar//EN',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `SUMMARY:${event.summary}`,
    `DTSTART:${toIcsDate(event.start)}`,
    `DTEND:${toIcsDate(event.end)}`,
    event.description ? `DESCRIPTION:${event.description}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).map(foldLine).join('\r\n');
}

async function insertEvent(property, event) {
  const creds = decryptJson(property.credentials);
  const client = await createClient(creds);
  await client.createCalendarObject({
    calendar: { url: property.calendar_id },
    filename: `${event.uid}.ics`,
    iCalString: buildVCalendarString(event),
  });
}

// #33 Task 6: rewrites an already-pushed event in place (e.g. a combined
// day's summary with its garden-waste segment now stripped out) rather
// than deleting and reinserting - which would lose the non-garden-waste
// half for however long the delete and the next sync's re-push are apart.
// Needs the dav object's own url/etag (from listEventObjects), which is
// exactly what updateCalendarObject's optimistic-concurrency check requires.
//
// PR #34 review findings m1/m2: only the update call itself is caught
// (an auth/login failure from createClient still propagates, matching
// deleteEvent's error-boundary placement) - previously this had NO error
// handling at all, so a transient CalDAV failure (e.g. a 412 etag
// conflict) would propagate to syncProperty's catch block and abort every
// remaining event for that property's sync. Returns whether the update
// actually succeeded, so sync.js can count confirmed updates rather than
// attempts.
async function updateEvent(property, davObject, event) {
  const creds = decryptJson(property.credentials);
  const client = await createClient(creds);
  try {
    await client.updateCalendarObject({
      calendarObject: { url: davObject.url, etag: davObject.etag, data: buildVCalendarString(event) },
    });
    return true;
  } catch (err) {
    console.error(`Failed to update iCloud event for property ${property.id}:`, err.message);
    return false;
  }
}

// #33: deletes a previously-pushed event when a property opts out of
// Garden Waste. Only the delete call itself is caught - a login/auth
// failure from createClient still propagates like every other operation
// here. A per-event delete failure (already removed, transient API error)
// is logged and swallowed so it never aborts the rest of the sync run.
//
// PR #34 review finding m2: returns whether the delete actually succeeded,
// so sync.js's events_deleted count reflects CONFIRMED deletions rather
// than merely attempted ones.
async function deleteEvent(property, davObject) {
  const creds = decryptJson(property.credentials);
  const client = await createClient(creds);
  try {
    await client.deleteCalendarObject({ calendarObject: davObject });
    return true;
  } catch (err) {
    console.error(`Failed to delete iCloud event for property ${property.id}:`, err.message);
    return false;
  }
}

// PR #34 review finding M2: lets sync.js check whether an already-pushed
// event's remote summary already matches the stripped summary before
// writing, so a combined-day event isn't rewritten identically on every
// single sync run (which would needlessly bump its etag/sequence on the
// user's own devices for no actual change).
function extractSummary(iCalString) {
  const match = unfoldLines(iCalString)?.match(/^SUMMARY:(.+)$/m);
  return match ? match[1].trim() : null;
}

function toIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

async function checkCredentials(property) {
  if (!property.credentials) return 'unknown';
  try {
    const creds = decryptJson(property.credentials);
    await createClient(creds);
    return 'ok';
  } catch {
    return 'invalid';
  }
}

module.exports = { fetchCalendars, listEventObjects, insertEvent, updateEvent, deleteEvent, extractSummary, checkCredentials };
