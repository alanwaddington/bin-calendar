const { getDb } = require('./db');
const google = require('./google');
const icloud = require('./icloud');

async function checkAllCredentials() {
  const db = getDb();
  const properties = db.prepare(
    'SELECT * FROM properties WHERE credentials IS NOT NULL'
  ).all();

  for (const property of properties) {
    try {
      const status = await checkSingleCredential(property);
      console.log(`Credential check: property ${property.id} → ${status}`);
    } catch (err) {
      console.error(`Credential check error for property ${property.id}:`, err.message);
    }
  }
}

async function checkSingleCredential(property) {
  const status = property.calendar_type === 'google'
    ? await google.checkCredentials(property)
    : await icloud.checkCredentials(property);

  getDb()
    .prepare("UPDATE properties SET credential_status = ?, credential_checked_at = datetime('now') WHERE id = ?")
    .run(status, property.id);

  return status;
}

module.exports = { checkAllCredentials, checkSingleCredential };
