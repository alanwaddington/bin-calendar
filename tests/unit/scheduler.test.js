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
});
