jest.mock('node-cron', () => ({
  schedule: jest.fn().mockImplementation(() => ({ stop: jest.fn() })),
}));
jest.mock('../../src/sync', () => ({
  runSync: jest.fn(),
}));
jest.mock('../../src/credential-check', () => ({
  checkAllCredentials: jest.fn(),
}));
jest.mock('../../src/db', () => ({
  getDb: jest.fn(),
}));

const cron = require('node-cron');
const { getDb } = require('../../src/db');
const { checkAllCredentials } = require('../../src/credential-check');
const { runSync } = require('../../src/sync');
const { startScheduler, getNextSyncDate, stopScheduler, restartSyncSchedule } = require('../../src/scheduler');

describe('scheduler', () => {
  let mockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      prepare: jest.fn().mockReturnValue({
        get: jest.fn().mockReturnValue({ value: '0 0 1 * *' }),
      }),
    };
    getDb.mockReturnValue(mockDb);
  });

  test('startScheduler_schedulesJobWithExpressionFromDb', () => {
    mockDb.prepare.mockReturnValue({ get: jest.fn().mockReturnValue({ value: '0 0 15 * *' }) });
    startScheduler();

    expect(cron.schedule).toHaveBeenCalledWith('0 0 15 * *', expect.any(Function));
  });

  test('startScheduler_fallsBackToDefault_whenNoSetting', () => {
    mockDb.prepare.mockReturnValue({ get: jest.fn().mockReturnValue(undefined) });
    startScheduler();

    expect(cron.schedule).toHaveBeenCalledWith('0 0 1 * *', expect.any(Function));
  });

  test('startScheduler_schedulesWeeklyCredentialCheck', () => {
    startScheduler();

    expect(cron.schedule).toHaveBeenCalledWith('0 0 * * 0', expect.any(Function));
  });

  test('stopScheduler_stopsBothCronJobs', () => {
    startScheduler();
    stopScheduler();

    const mockTask1 = cron.schedule.mock.results[0].value;
    const mockTask2 = cron.schedule.mock.results[1].value;
    expect(mockTask1.stop).toHaveBeenCalled();
    expect(mockTask2.stop).toHaveBeenCalled();
  });

  test('getNextSyncDate_returnsFutureIsoString', () => {
    startScheduler();

    const result = getNextSyncDate();
    const date = new Date(result);
    expect(date.getTime()).toBeGreaterThan(Date.now());
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('restartSyncSchedule_stopsOldTaskAndStartsNewWithNewExpression', () => {
    startScheduler();

    const oldTask = cron.schedule.mock.results[0].value;
    restartSyncSchedule('0 0 * * 1');

    expect(oldTask.stop).toHaveBeenCalled();
    const newCallArgs = cron.schedule.mock.calls[cron.schedule.mock.calls.length - 1];
    expect(newCallArgs[0]).toBe('0 0 * * 1');
  });

  test('restartSyncSchedule_updatesGetNextSyncDate', () => {
    startScheduler();
    restartSyncSchedule('0 0 * * 1');

    const result = getNextSyncDate();
    const date = new Date(result);
    expect(date.getTime()).toBeGreaterThan(Date.now());
  });

  test('restartSyncSchedule_doesNotAffectCredentialTask', () => {
    startScheduler();

    const credTask = cron.schedule.mock.results[1].value;
    restartSyncSchedule('0 0 * * 1');

    expect(credTask.stop).not.toHaveBeenCalled();
  });

  test('cronCallback_onSuccess_logsResult', async () => {
    runSync.mockResolvedValue({ overallStatus: 'success' });
    startScheduler();

    const callback = cron.schedule.mock.calls[0][1];
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await callback();
    consoleSpy.mockRestore();

    expect(runSync).toHaveBeenCalled();
  });

  test('cronCallback_onError_logsError', async () => {
    runSync.mockRejectedValue(new Error('Sync failed'));
    startScheduler();

    const callback = cron.schedule.mock.calls[0][1];
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await callback();
    consoleSpy.mockRestore();
    logSpy.mockRestore();

    expect(runSync).toHaveBeenCalled();
  });

  test('weeklyCredentialCallback_onSuccess_logsResult', async () => {
    checkAllCredentials.mockResolvedValue(undefined);
    startScheduler();

    const callback = cron.schedule.mock.calls[1][1];
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await callback();
    consoleSpy.mockRestore();

    expect(checkAllCredentials).toHaveBeenCalled();
  });

  test('weeklyCredentialCallback_onError_logsError', async () => {
    checkAllCredentials.mockRejectedValue(new Error('Check failed'));
    startScheduler();

    const callback = cron.schedule.mock.calls[1][1];
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await callback();
    consoleSpy.mockRestore();
    logSpy.mockRestore();

    expect(checkAllCredentials).toHaveBeenCalled();
  });
});
