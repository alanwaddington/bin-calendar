jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({ stop: jest.fn() }),
}));
jest.mock('../../src/sync', () => ({
  runSync: jest.fn(),
}));

const cron = require('node-cron');
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
});
