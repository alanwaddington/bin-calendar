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

async function listEventUids(property, timeMin, timeMax) {
  const creds = decryptJson(property.credentials);
  const client = await createClient(creds);
  const objects = await client.fetchCalendarObjects({
    calendar: { url: property.calendar_id },
    timeRange: { start: timeMin.toISOString(), end: timeMax.toISOString() },
  });
  const uids = new Set();
  for (const obj of objects) {
    const match = obj.data?.match(/^UID:(.+)$/m);
    if (match) uids.add(match[1].trim());
  }
  return uids;
}

async function insertEvent(property, event) {
  const creds = decryptJson(property.credentials);
  const client = await createClient(creds);
  const vcalendar = [
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

  await client.createCalendarObject({
    calendar: { url: property.calendar_id },
    filename: `${event.uid}.ics`,
    iCalString: vcalendar,
  });
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

module.exports = { fetchCalendars, listEventUids, insertEvent, checkCredentials };
