/* Shared plumbing for every provider: one retry on the failures that cost nothing (429, 5xx, no
   connection), a timeout, and errors that say which capability failed without echoing the key. */
export class ProviderError extends Error {
  constructor(what, status, detail) {
    super(`${what} failed${status ? ` (${status})` : ''}${detail ? `: ${detail}` : ''}`);
    this.status = status || 502;
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function call(what, url, init, { timeout = 90_000, retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      if (attempt < retries && e.name !== 'TimeoutError') { await sleep(800); continue; }
      throw new ProviderError(what, 504, e.name === 'TimeoutError' ? 'timed out' : e.message);
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => '');
    if (attempt < retries && (res.status === 429 || res.status >= 500)) { await sleep(1200 * (attempt + 1)); continue; }
    let msg = body.slice(0, 400);
    try { msg = JSON.parse(body).error?.message || msg; } catch {}
    throw new ProviderError(what, res.status, msg);
  }
}

export const bearer = (key) => ({ Authorization: `Bearer ${key}` });
