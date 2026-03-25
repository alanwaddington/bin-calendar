const cron = require('node-cron');
const { runSync } = require('./sync');

let task;

function startScheduler() {
  task = cron.schedule('0 0 1 * *', async () => {
    console.log('Scheduled sync starting...');
    try {
      const result = await runSync();
      console.log('Scheduled sync complete:', result.overallStatus || result.message);
    } catch (err) {
      console.error('Scheduled sync error:', err.message);
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
  if (task) task.stop();
}

module.exports = { startScheduler, getNextSyncDate, stopScheduler };
