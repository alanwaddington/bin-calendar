const TIMEOUT_MS = 5_000;

async function lookupPostcode(postcode) {
  const apiKey = process.env.GETADDRESS_API_KEY;
  if (!apiKey) throw new Error('GETADDRESS_API_KEY not configured');

  const url = `https://api.getAddress.io/autocomplete/${encodeURIComponent(postcode)}?api-key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`getAddress.io error: HTTP ${res.status}`);
    const data = await res.json();
    return (data.suggestions || []).map(s => ({
      address: s.address,
      id: s.url,
    }));
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Address lookup timed out');
    throw err;
  }
}

async function getAddressDetail(id) {
  const apiKey = process.env.GETADDRESS_API_KEY;
  if (!apiKey) throw new Error('GETADDRESS_API_KEY not configured');

  const url = `https://api.getAddress.io${id}?api-key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { uprn: data.uprn, address: data.formatted_address?.join(', ') };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Address detail lookup timed out');
    throw err;
  }
}

module.exports = { lookupPostcode, getAddressDetail };
