const MAX_RETRY_AFTER_MS = 60_000;
const permanent = message => Object.assign(new Error(message), { permanent: true });
const wait = ms => new Promise(r => setTimeout(r, ms));

// Retry-After is either delta-seconds or an HTTP date. Unparseable values are ignored.
export function retryAfterMs(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

export async function fetchCatalog(url, fetchImpl = fetch, maxBytes = 10 * 1024 * 1024, { sleep = wait } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    let delay = 500 * (attempt + 1);
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'free-llm-catalog/1.0' },
        // Workers supports manual/follow only. Treat 3xx as a permanent failure below.
        signal: AbortSignal.timeout(30_000), redirect: 'manual',
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status !== 429 && response.status < 500) throw permanent(`Catalog returned HTTP ${response.status}`);
        if (response.status === 429 || response.status === 503) {
          const requested = retryAfterMs(response.headers.get('Retry-After'));
          // Never retry earlier than the server asked; a long back-off waits for the next scheduled run.
          if (requested > MAX_RETRY_AFTER_MS) throw permanent(`Catalog returned HTTP ${response.status}; Retry-After exceeds 60s`);
          if (requested !== null) delay = Math.max(delay, requested);
        }
        throw new Error(`Catalog returned HTTP ${response.status}`);
      }
      if (!response.body) throw permanent('Catalog returned an empty body');
      const chunks = [];
      const decoder = new TextDecoder();
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw permanent('Catalog exceeds response size limit');
        chunks.push(chunk);
      }
      const text = chunks.map(chunk => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
      if (!text.trim()) throw permanent('Catalog returned an empty body');
      try { return JSON.parse(text); }
      catch { throw permanent('Catalog did not return valid JSON'); }
    } catch (error) {
      lastError = error;
      if (error.permanent || attempt === 2) throw error;
      await sleep(delay);
    }
  }
  throw lastError;
}
