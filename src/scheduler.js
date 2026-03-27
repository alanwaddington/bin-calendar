const cron = require('node-cron');
const { runSync } = require('./sync');
const { checkAllCredentials } = require('./credential-check');

let syncTask;
let credentialTask;

function startScheduler() {
  syncTask = cron.schedule('0 0 1 * *', async () => {
    console.log('Scheduled sync starting...');
    try {
      const result = await runSync();
      console.log('Scheduled sync complete:', result.overallStatus || result.message);
    } catch (err) {
      console.error('Scheduled sync error:', err.message);
    }
  });

  credentialTask = cron.schedule('0 0 * * 0', async () => {
    console.log('Weekly credential check starting...');
    try {
      await checkAllCredentials();
      console.log('Weekly credential check complete');
    } catch (err) {
      console.error('Weekly credential check error:', err.message);
    }
  });

  console.log('Scheduler started — next sync on 1st of next month at 00:00');
}

function getNextSyncDate() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  return next.toISOString();
}

function stopScheduler() {
  if (syncTask) syncTask.stop();
  if (credentialTask) credentialTask.stop();
}

module.exports = { startScheduler, getNextSyncDate, stopScheduler };
