const { lookupPostcode, getAddressDetail } = require('../../src/uprn');

describe('uprn', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    process.env.GETADDRESS_API_KEY = 'test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.GETADDRESS_API_KEY;
  });

  test('lookupPostcode_withValidPostcode_returnsSuggestions', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        suggestions: [{ address: '1 Main St', url: '/addr/123' }],
      }),
    });

    const result = await lookupPostcode('KA1 1AA');

    expect(result).toEqual([{ address: '1 Main St', id: '/addr/123' }]);
  });

  test('lookupPostcode_when404_returnsEmptyArray', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await lookupPostcode('INVALID');

    expect(result).toEqual([]);
  });

  test('getAddressDetail_withValidId_returnsUprnAndAddress', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        uprn: '12345',
        formatted_address: ['1', 'Main St', 'KA1'],
      }),
    });

    const result = await getAddressDetail('/addr/123');

    expect(result).toEqual({ uprn: '12345', address: '1, Main St, KA1' });
  });

  test('lookupPostcode_whenApiKeyMissing_throwsError', async () => {
    delete process.env.GETADDRESS_API_KEY;

    await expect(lookupPostcode('KA1 1AA')).rejects.toThrow('GETADDRESS_API_KEY not configured');
  });

  test('lookupPostcode_whenFetchAborts_throwsTimeoutError', async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });

    await expect(lookupPostcode('KA1 1AA')).rejects.toThrow('Address lookup timed out');
  });

  test('lookupPostcode_whenHttpError_throwsError', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(lookupPostcode('KA1 1AA')).rejects.toThrow('HTTP 500');
  });

  test('getAddressDetail_whenApiKeyMissing_throwsError', async () => {
    delete process.env.GETADDRESS_API_KEY;

    await expect(getAddressDetail('/addr/123')).rejects.toThrow('GETADDRESS_API_KEY not configured');
  });

  test('getAddressDetail_whenHttpError_throwsError', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(getAddressDetail('/addr/123')).rejects.toThrow('HTTP 500');
  });

  test('getAddressDetail_whenFetchAborts_throwsTimeoutError', async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });

    await expect(getAddressDetail('/addr/123')).rejects.toThrow('Address detail lookup timed out');
  });
});
