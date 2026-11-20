// Talking to the person's own PC (the Vault's clipper endpoint on 127.0.0.1, src/main/clipper.ts): the ports tried in
// order, pairing once with the code Settings shows, then every request carrying the kept token. Plain fetch and an
// injected token store, so node tests drive it against the real server (tests/clipper-server.test.mjs).

/** The Vault listens on the first free one; the extension tries each in turn (src/shared/clipper.ts CLIPPER_PORTS). */
export const CLIPPER_PORTS = [28741, 28742, 28743];
const TOKEN_HEADER = 'x-neuralvault-clipper';
const TOKEN_KEY = 'nvault.clipper.token';

const WORDS = {
  'not-running': 'Ironleaf is not running. Open it and try again.',
  off: 'The web clipper is off. Switch it on in Ironleaf Settings.',
  unpaired: 'This browser is not paired yet. Enter the code from Ironleaf Settings.',
  refused: 'Ironleaf refused that. Pair again with the code in Settings.',
  'too-many': 'Too many tries. Wait a minute, then try again.',
  'too-big': 'That clip is too large. Clip the selection instead.',
  failed: 'The clip could not be saved. Try again.',
};

/** A coded failure with the person's own words (err.code, err.words). */
export function clipperError(code, words) {
  const err = new Error(words ?? WORDS[code] ?? WORDS.failed);
  err.code = code;
  err.words = words ?? WORDS[code] ?? WORDS.failed;
  return err;
}

const withTimeout = (ms) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
};

/**
 * The Vault on this PC. storage keeps the pairing token ({ get, set, remove }); fetchImpl is fetch (a test's own in
 * node).
 */
export class ClipperApi {
  constructor({ fetchImpl = fetch, storage = null } = {}) {
    this.fetch = fetchImpl;
    this.storage = storage ?? {
      data: new Map(),
      async get(k) {
        return this.data.get(k);
      },
      async set(k, v) {
        this.data.set(k, v);
      },
      async remove(k) {
        this.data.delete(k);
      },
    };
  }

  async token() {
    return (await this.storage.get(TOKEN_KEY)) ?? null;
  }

  async clearToken() {
    await this.storage.remove(TOKEN_KEY);
  }

  /** One request against each port in turn: the first Vault that answers wins; none answering means not running. */
  async call(path, { method = 'GET', body = null, token = null, timeoutMs = 8000 } = {}) {
    let refused = null;
    for (const port of CLIPPER_PORTS) {
      const { signal, done } = withTimeout(timeoutMs);
      try {
        const res = await this.fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          signal,
          headers: { ...(body !== null ? { 'content-type': 'application/json' } : {}), ...(token ? { [TOKEN_HEADER]: token } : {}) },
          ...(body !== null ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
        });
        done();
        const json = await res.json().catch(() => ({}));
        if (res.ok) return { port, json };
        refused = { status: res.status, json };
        // Answered, so the Vault runs: a refusal is final (no next port).
        break;
      } catch {
        done();
        // Nothing there: the next port.
      }
    }
    if (!refused) throw clipperError('not-running');
    const words = typeof refused.json?.error === 'string' && refused.json.error ? refused.json.error : null;
    if (refused.status === 429) throw clipperError('too-many', words);
    if (refused.status === 413) throw clipperError('too-big', words);
    if (refused.status === 403 && /not paired/i.test(words ?? '')) throw clipperError('unpaired', words);
    if (refused.status === 403 && /clipper is off/i.test(words ?? '')) throw clipperError('off', words);
    if (refused.status === 403) throw clipperError('refused', words);
    throw clipperError('failed', words);
  }

  /** How the Vault stands: running, on, and whether this browser paired. Never throws unpaired. */
  async status() {
    const { json } = await this.call('/status', { token: await this.token(), timeoutMs: 4000 });
    return json;
  }

  /** Pair once with the code Settings shows; the kept token comes back. */
  async pair(code) {
    const clean = String(code ?? '').toUpperCase().replace(/[\s-]+/g, '');
    if (!clean) throw clipperError('unpaired', 'Enter the code from Ironleaf Settings.');
    const { json } = await this.call('/pair', { method: 'POST', body: { code: clean }, timeoutMs: 8000 });
    if (!json.token) throw clipperError('refused');
    await this.storage.set(TOKEN_KEY, json.token);
    return json.token;
  }

  /** Where a clip can land: folders, projects, and the default. Throws unpaired when not paired. */
  async places() {
    const token = await this.token();
    if (!token) throw clipperError('unpaired');
    const { json } = await this.call('/places', { token, timeoutMs: 10000 });
    return json;
  }

  /** Send a clip (src/shared/clipper.ts ClipRequest). Answers { path, title, words }. */
  async clip(payload) {
    const token = await this.token();
    if (!token) throw clipperError('unpaired');
    try {
      const { json } = await this.call('/clip', { method: 'POST', body: payload, token, timeoutMs: 90000 });
      return json;
    } catch (err) {
      // A token the Vault no longer keeps (its pairing was reset): pair again rather than fail each time.
      if (err.code === 'refused' || err.code === 'unpaired') await this.clearToken().catch(() => undefined);
      throw err;
    }
  }
}
