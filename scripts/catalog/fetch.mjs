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
  const text = await fetchText(url, fetchImpl, maxBytes, { sleep, accept: 'application/json', label: 'Catalog' });
  try { return JSON.parse(text); }
  catch { throw permanent('Catalog did not return valid JSON'); }
}

// Same transport rules as fetchCatalog (timeout, size cap, no redirects, no credentials, bounded retries),
// returning the body as text. `contentTypes` lists accepted media types; anything else is a permanent error.
// `label` names the resource in error messages.
export async function fetchText(url, fetchImpl = fetch, maxBytes = 10 * 1024 * 1024, { sleep = wait, accept = '*/*', contentTypes, label = 'Response' } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    let delay = 500 * (attempt + 1);
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: accept, 'User-Agent': 'free-llm-catalog/1.0' },
        // Workers supports manual/follow only. Treat 3xx as a permanent failure below.
        signal: AbortSignal.timeout(30_000), redirect: 'manual',
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status !== 429 && response.status < 500) throw permanent(`${label} returned HTTP ${response.status}`);
        if (response.status === 429 || response.status === 503) {
          const requested = retryAfterMs(response.headers.get('Retry-After'));
          // Never retry earlier than the server asked; a long back-off waits for the next scheduled run.
          if (requested > MAX_RETRY_AFTER_MS) throw permanent(`${label} returned HTTP ${response.status}; Retry-After exceeds 60s`);
          if (requested !== null) delay = Math.max(delay, requested);
        }
        throw new Error(`${label} returned HTTP ${response.status}`);
      }
      if (contentTypes) {
        const type = (response.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
        if (!contentTypes.includes(type)) {
          await response.body?.cancel();
          throw permanent(`Unexpected content type "${type || 'none'}"`);
        }
      }
      if (!response.body) throw permanent(`${label} returned an empty body`);
      const chunks = [];
      const decoder = new TextDecoder();
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw permanent(`${label} exceeds response size limit`);
        chunks.push(chunk);
      }
      const text = chunks.map(chunk => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
      if (!text.trim()) throw permanent(`${label} returned an empty body`);
      return text;
    } catch (error) {
      lastError = error;
      if (error.permanent || attempt === 2) throw error;
      await sleep(delay);
    }
  }
  throw lastError;
}
