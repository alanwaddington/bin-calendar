const { encryptJson, decryptJson } = require('./crypto');
const { getDb } = require('./db');

const SCOPE = 'https://www.googleapis.com/auth/calendar';

// googleapis is a very large package (1000+ files across ~200 bundled API
// clients) - requiring it eagerly at module load adds real startup cost to
// every server boot, whether or not Google Calendar is even configured for
// any property. Lazily requiring it here means that cost is only paid once,
// on first actual use, and only if a Google-related function is called at
// all. Node's require() cache makes every call after the first free.
function getGoogleApi() {
  return require('googleapis').google;
}

function createOAuthClient() {
  const google = getGoogleApi();
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function isGoogleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getAuthUrl(state) {
  const client = createOAuthClient();
  return client.generateAuthUrl({ access_type: 'offline', scope: SCOPE, state, prompt: 'consent' });
}

async function exchangeCode(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

async function getAuthenticatedClient(property) {
  const creds = decryptJson(property.credentials);
  const client = createOAuthClient();
  client.setCredentials(creds);

  if (creds.expiry_date && Date.now() > creds.expiry_date - 60_000) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    getDb()
      .prepare('UPDATE properties SET credentials = ? WHERE id = ?')
      .run(encryptJson(credentials), property.id);
  }

  return client;
}

async function listCalendars(property) {
  const auth = await getAuthenticatedClient(property);
  const calendar = getGoogleApi().calendar({ version: 'v3', auth });
  const res = await calendar.calendarList.list();
  return (res.data.items || []).map(c => ({ id: c.id, summary: c.summary, primary: !!c.primary }));
}

// PR #34 review finding m5: Google's events.list returns at most 250
// results per call with no explicit maxResults. This feeds existingByUid
// in sync.js, which now has a destructive responsibility (deciding which
// Garden Waste events to delete on opt-out) - a property with more events
// in range than one page would silently miss any beyond the first,
// leaving them un-deleted. Follows nextPageToken until exhausted.
async function listEvents(property, timeMin, timeMax) {
  const auth = await getAuthenticatedClient(property);
  const calendar = getGoogleApi().calendar({ version: 'v3', auth });
  let items = [];
  let pageToken;
  do {
    const res = await calendar.events.list({
      calendarId: property.calendar_id,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      pageToken,
    });
    items = items.concat(res.data.items || []);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return items;
}

async function insertEvent(property, event) {
  const auth = await getAuthenticatedClient(property);
  const calendar = getGoogleApi().calendar({ version: 'v3', auth });
  const start = event.allDay
    ? { date: event.start.toISOString().slice(0, 10) }
    : { dateTime: event.start.toISOString() };
  const end = event.allDay
    ? { date: event.end.toISOString().slice(0, 10) }
    : { dateTime: event.end.toISOString() };
  await calendar.events.import({
    calendarId: property.calendar_id,
    requestBody: {
      iCalUID: event.uid,
      summary: event.summary,
      start,
      end,
      description: event.description,
    },
  });
}

// #33: deletes a previously-pushed event when a property opts out of
// Garden Waste. Only the delete call itself is caught - an auth failure
// from getAuthenticatedClient still propagates like every other operation
// here, so syncProperty's existing isAuthError handling still fires. A
// per-event delete failure (already removed, transient API error) is
// logged and swallowed so it never aborts the rest of the sync run.
//
// PR #34 review finding m2: returns whether the delete actually succeeded,
// so sync.js's events_deleted count reflects CONFIRMED deletions rather
// than merely attempted ones.
async function deleteEvent(property, googleEventId) {
  const auth = await getAuthenticatedClient(property);
  const calendar = getGoogleApi().calendar({ version: 'v3', auth });
  try {
    await calendar.events.delete({ calendarId: property.calendar_id, eventId: googleEventId });
    return true;
  } catch (err) {
    console.error(`Failed to delete Google event ${googleEventId} for property ${property.id}:`, err.message);
    return false;
  }
}

// PR #34 review finding M1: rewrites an already-pushed event's summary in
// place (e.g. a combined day with its garden-waste segment now stripped
// out) via calendar.events.patch - a documented, ID-addressed, idempotent
// update. The event ID is already available wherever this is called from
// (the same existingByUid map deleteEvent uses), so no new lookup is
// needed. Only the patch call itself is caught, matching deleteEvent's
// error-boundary placement: an auth failure still propagates to
// syncProperty's isAuthError handling, while a per-event update failure
// (transient API error) is logged and swallowed so it never aborts the
// rest of the sync run.
async function updateEventSummary(property, googleEventId, summary) {
  const auth = await getAuthenticatedClient(property);
  const calendar = getGoogleApi().calendar({ version: 'v3', auth });
  try {
    await calendar.events.patch({
      calendarId: property.calendar_id,
      eventId: googleEventId,
      requestBody: { summary },
    });
    return true;
  } catch (err) {
    console.error(`Failed to update Google event ${googleEventId} for property ${property.id}:`, err.message);
    return false;
  }
}

async function checkCredentials(property) {
  if (!property.credentials) return 'unknown';
  try {
    await listCalendars(property);
    return 'ok';
  } catch {
    return 'invalid';
  }
}

module.exports = { isGoogleConfigured, getAuthUrl, exchangeCode, listCalendars, listEvents, insertEvent, deleteEvent, updateEventSummary, checkCredentials };
