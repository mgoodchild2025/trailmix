// Client for the CG Core Trailmix API (docs/cg-core-api.md), shared by the desktop and
// mobile apps. CG Core signs staff in with Microsoft 365 and holds the Anthropic and
// Deepgram keys; Trailmix holds only a per-device token. Pass `fetchImpl` on platforms
// whose global fetch can't stream (React Native: expo/fetch).

export const CORE_URLS = {
  production: 'https://core.cgtechnologies.com',
  staging: 'https://core-staging.cgtechnologies.com',
};

export const PROTOCOL = 'trailmix';

export class CoreError extends Error {
  constructor(message, { status, code, retryAfter } = {}) {
    super(message);
    Object.assign(this, { status, code, retryAfter });
  }
  get unauthorized() {
    return this.status === 401;
  }
}

export function connectUrl(baseUrl, { state, device, platform }) {
  const u = new URL('/trailmix/connect', baseUrl);
  u.search = new URLSearchParams({ state, device, platform }).toString();
  return u.toString();
}

// trailmix://connect?code=...&state=...
export function parseConnectLink(link) {
  let u;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.protocol !== `${PROTOCOL}:`) return null;
  const action = u.hostname || u.pathname.replace(/^\/+/, '');
  if (action !== 'connect') return null;
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  return code && state ? { code, state } : null;
}

async function errorFrom(res) {
  let body = {};
  // Callers that resolve conflicts need the response body (409 carries the current copy).
  try {
    body = await res.json();
  } catch {}
  const retryAfter = Number(res.headers.get('retry-after')) || undefined;
  const code = body.code;
  let message = body.error || `CG Core returned HTTP ${res.status}`;
  if (res.status === 401) message = 'Your CG Core sign-in has expired or was revoked. Sign in again in Settings.';
  else if (res.status === 429) message = `CG Core rate limit reached. Try again${retryAfter ? ` in ${Math.ceil(retryAfter / 60)} min` : ' shortly'}.`;
  else if (res.status === 503 && code === 'not_configured') message = `${body.error || 'This feature is not set up in CG Core yet'}. Ask a CG Core admin.`;
  return Object.assign(new CoreError(message, { status: res.status, code, retryAfter }), { body });
}

export async function pair(baseUrl, { code, state, deviceName, platform, appVersion }, fetchImpl = fetch) {
  const res = await fetchImpl(new URL('/api/trailmix/v1/pair', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim(), state, deviceName, platform, appVersion }),
  }).catch((err) => {
    throw new CoreError(`Couldn't reach CG Core (${err.message}).`);
  });
  if (!res.ok) {
    const err = await errorFrom(res);
    if (err.code === 'invalid_code') err.message = 'That code is invalid or has expired. Start the sign-in again.';
    throw err;
  }
  return res.json();
}

export class CoreClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) {
    Object.assign(this, { baseUrl, token, fetchImpl });
  }

  async request(path, { method = 'GET', body, signal } = {}) {
    const res = await this.fetchImpl(new URL(path, this.baseUrl), {
      method,
      signal,
      headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).catch((err) => {
      if (err.name === 'AbortError') throw Object.assign(new Error('Cancelled'), { cancelled: true });
      throw new CoreError(`Couldn't reach CG Core (${err.message}).`);
    });
    if (!res.ok) throw await errorFrom(res);
    return res;
  }

  async me() {
    return (await this.request('/api/trailmix/v1/me')).json();
  }

  async deepgramToken() {
    return (await this.request('/api/trailmix/v1/deepgram-token', { method: 'POST' })).json();
  }

  // Meeting sync (docs/cg-core-api.md section 5). The SyncEngine in shared/sync.js
  // drives these; errors keep .status and .body for its conflict handling.
  async listMeetings(cursor, limit = 100) {
    const q = new URLSearchParams({ limit: String(limit), ...(cursor ? { since: cursor } : {}) });
    return (await this.request(`/api/trailmix/v1/meetings?${q}`)).json();
  }

  async putMeeting(id, ifVersion, doc) {
    return (await this.request(`/api/trailmix/v1/meetings/${encodeURIComponent(id)}`, { method: 'PUT', body: { ifVersion, doc } })).json();
  }

  async deleteMeeting(id, ifVersion) {
    const q = ifVersion != null ? `?ifVersion=${ifVersion}` : '';
    return (await this.request(`/api/trailmix/v1/meetings/${encodeURIComponent(id)}${q}`, { method: 'DELETE' })).json();
  }

  async signout() {
    await this.request('/api/trailmix/v1/signout', { method: 'POST' });
  }

  // Streams Claude through CG Core. Resolves with the full text.
  async streamClaude({ purpose, model, system, messages, effort, maxTokens, onDelta, signal }) {
    const res = await this.request('/api/trailmix/v1/claude', {
      method: 'POST',
      signal,
      body: { purpose, model, system, messages, effort, maxTokens },
    });
    let text = '';
    let done = null;
    try {
      for await (const msg of readNdjson(res.body)) {
        if (msg.t === 'd') {
          text += msg.text;
          onDelta?.(msg.text);
        } else if (msg.t === 'done') done = msg;
        else if (msg.t === 'error') {
          const m = msg.code === 'refusal' ? 'Claude declined to process this request.' : msg.message || 'CG Core reported an error.';
          throw new CoreError(m, { code: msg.code });
        }
      }
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
      throw err;
    }
    if (!done) throw new CoreError('The connection to CG Core ended before the response finished.');
    return { text, truncated: done.stopReason === 'max_tokens', usage: done.usage };
  }
}

// Accepts a Node/web stream that's async-iterable or exposes getReader() (React Native).
async function* chunksOf(body) {
  if (body?.getReader) {
    const reader = body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock?.();
    }
  } else yield* body;
}

export async function* readNdjson(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of chunksOf(body)) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) yield JSON.parse(buf);
}
