const { google } = require('googleapis');
const { encryptJson, decryptJson } = require('./crypto');
const { getDb } = require('./db');

const SCOPE = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

function createOAuthClient() {
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
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.calendarList.list();
  return (res.data.items || []).map(c => ({ id: c.id, summary: c.summary, primary: !!c.primary }));
}

async function listEvents(property, timeMin, timeMax) {
  const auth = await getAuthenticatedClient(property);
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.list({
    calendarId: property.calendar_id,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
  });
  return res.data.items || [];
}

async function insertEvent(property, event) {
  const auth = await getAuthenticatedClient(property);
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.insert({
    calendarId: property.calendar_id,
    requestBody: {
      iCalUID: event.uid,
      summary: event.summary,
      start: { dateTime: event.start.toISOString() },
      end: { dateTime: event.end.toISOString() },
      description: event.description,
    },
  });
}

module.exports = { isGoogleConfigured, getAuthUrl, exchangeCode, listCalendars, listEvents, insertEvent };
