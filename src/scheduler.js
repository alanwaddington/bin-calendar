const cron = require('node-cron');
const { CronExpressionParser } = require('cron-parser');
const { runSync } = require('./sync');
const { checkAllCredentials } = require('./credential-check');
const { getDb } = require('./db');

const DEFAULT_CRON = '0 0 1 * *';

let syncTask;
let credentialTask;
let currentCronExpression = DEFAULT_CRON;

function loadCronExpression() {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('sync_cron');
    return (row && row.value) ? row.value : DEFAULT_CRON;
  } catch {
    return DEFAULT_CRON;
  }
}

function scheduleSyncTask(expression) {
  return cron.schedule(expression, async () => {
    console.log('Scheduled sync starting...');
    try {
      const result = await runSync();
      console.log('Scheduled sync complete:', result.overallStatus || result.message);
    } catch (err) {
      console.error('Scheduled sync error:', err.message);
    }
  });
}

function startScheduler() {
  currentCronExpression = loadCronExpression();
  syncTask = scheduleSyncTask(currentCronExpression);

  credentialTask = cron.schedule('0 0 * * 0', async () => {
    console.log('Weekly credential check starting...');
    try {
      await checkAllCredentials();
      console.log('Weekly credential check complete');
    } catch (err) {
      console.error('Weekly credential check error:', err.message);
    }
  });

  console.log(`Scheduler started — next sync: ${getNextSyncDate()}`);
}

function restartSyncSchedule(expression) {
  if (syncTask) syncTask.stop();
  currentCronExpression = expression;
  syncTask = scheduleSyncTask(expression);
}

function getNextSyncDate() {
  const interval = CronExpressionParser.parse(currentCronExpression);
  return interval.next().toISOString();
}

function stopScheduler() {
  if (syncTask) syncTask.stop();
  if (credentialTask) credentialTask.stop();
}

module.exports = { startScheduler, getNextSyncDate, stopScheduler, restartSyncSchedule };
