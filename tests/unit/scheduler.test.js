jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({ stop: jest.fn() }),
}));
jest.mock('../../src/sync', () => ({
  runSync: jest.fn(),
}));
jest.mock('../../src/credential-check', () => ({
  checkAllCredentials: jest.fn(),
}));

const cron = require('node-cron');
const { checkAllCredentials } = require('../../src/credential-check');
const { startScheduler, getNextSyncDate, stopScheduler } = require('../../src/scheduler');

describe('scheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getNextSyncDate_returnsFirstOfNextMonth', () => {
    const result = getNextSyncDate();
    const date = new Date(result);

    expect(date.getUTCDate()).toBe(1);
    expect(date.getUTCHours()).toBe(0);
    expect(date.getUTCMinutes()).toBe(0);
    expect(date.getUTCSeconds()).toBe(0);
  });

  test('startScheduler_schedulesJobWithCorrectCronExpression', () => {
    startScheduler();

    expect(cron.schedule).toHaveBeenCalledWith('0 0 1 * *', expect.any(Function));
  });

  test('stopScheduler_stopsTheTask', () => {
    startScheduler();
    stopScheduler();

    const mockTask = cron.schedule.mock.results[0].value;
    expect(mockTask.stop).toHaveBeenCalled();
  });

  test('cronCallback_onSuccess_logsResult', async () => {
    const { runSync } = require('../../src/sync');
    runSync.mockResolvedValue({ overallStatus: 'success' });

    startScheduler();

    // Get the callback that was passed to cron.schedule
    const callback = cron.schedule.mock.calls[0][1];
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await callback();
    consoleSpy.mockRestore();

    expect(runSync).toHaveBeenCalled();
  });

  test('cronCallback_onError_logsError', async () => {
    const { runSync } = require('../../src/sync');
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
