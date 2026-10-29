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

// #33: deletion needs each object's url/etag (deleteCalendarObject's own
// requirement), which listEventUids has always discarded after parsing out
// just the uid. listEventUids is re-expressed in terms of this so both
// stay in agreement about what counts as "present".
async function listEventObjects(property, timeMin, timeMax) {
  const creds = decryptJson(property.credentials);
  const client = await createClient(creds);
  const objects = await client.fetchCalendarObjects({
    calendar: { url: property.calendar_id },
    timeRange: { start: timeMin.toISOString(), end: timeMax.toISOString() },
  });
  const byUid = new Map();
  for (const obj of objects) {
    const match = obj.data?.match(/^UID:(.+)$/m);
    if (match) byUid.set(match[1].trim(), obj);
  }
  return byUid;
}

async function listEventUids(property, timeMin, timeMax) {
  const objects = await listEventObjects(property, timeMin, timeMax);
  return new Set(objects.keys());
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
  ].filter(Boolean).join('\r\n');
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
  const match = iCalString?.match(/^SUMMARY:(.+)$/m);
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

module.exports = { fetchCalendars, listEventUids, listEventObjects, insertEvent, updateEvent, deleteEvent, extractSummary, checkCredentials };
