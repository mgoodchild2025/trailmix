import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CoreClient, pair, parseConnectLink, connectUrl, readNdjson } from '../electron/core.js';

// A tiny fake CG Core that follows docs/cg-core-api.md.
function fakeCore(handlers) {
  const srv = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const key = `${req.method} ${req.url.split('?')[0]}`;
    const h = handlers[key];
    if (!h) return res.writeHead(404).end();
    h(req, res, body ? JSON.parse(body) : null);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

test('connect links are built and parsed', () => {
  const u = new URL(connectUrl('https://core.example.com', { state: 'abc', device: "Matt's Mac", platform: 'darwin' }));
  assert.equal(u.pathname, '/trailmix/connect');
  assert.equal(u.searchParams.get('device'), "Matt's Mac");
  assert.deepEqual(parseConnectLink('trailmix://connect?code=XY12&state=abc'), { code: 'XY12', state: 'abc' });
  assert.equal(parseConnectLink('trailmix://connect?code=XY12'), null);
  assert.equal(parseConnectLink('https://evil.example/connect?code=a&state=b'), null);
  assert.equal(parseConnectLink('not a url'), null);
});

test('pairing exchanges a code for a device token', async () => {
  const { srv, url } = await fakeCore({
    'POST /api/trailmix/v1/pair': (_q, res, body) => {
      if (body.code !== 'GOOD' || body.state !== 's1') {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'bad', code: 'invalid_code' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ token: 'cgt_ab_secret', staff: { id: '1', name: 'Matt' }, device: { id: 'd', name: 'Mac' } }));
    },
  });
  const ok = await pair(url, { code: ' GOOD ', state: 's1', deviceName: 'Mac', platform: 'darwin', appVersion: '0.3.0' });
  assert.equal(ok.token, 'cgt_ab_secret');
  await assert.rejects(pair(url, { code: 'BAD', state: 's1' }), /invalid or has expired/);
  srv.close();
});

test('authenticated calls send the bearer token and map errors', async () => {
  let auth;
  const { srv, url } = await fakeCore({
    'GET /api/trailmix/v1/me': (q, res) => {
      auth = q.headers.authorization;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ staff: { name: 'Matt' }, features: { claude: true, deepgram: false } }));
    },
    'POST /api/trailmix/v1/deepgram-token': (_q, res) =>
      res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Deepgram is not set up in CG Core', code: 'not_configured' })),
    'POST /api/trailmix/v1/signout': (_q, res) => res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'x', code: 'revoked' })),
  });
  const core = new CoreClient({ baseUrl: url, token: 'cgt_ab_secret' });
  assert.equal((await core.me()).staff.name, 'Matt');
  assert.equal(auth, 'Bearer cgt_ab_secret');
  await assert.rejects(core.deepgramToken(), (e) => e.status === 503 && /not set up in CG Core/.test(e.message));
  await assert.rejects(core.signout(), (e) => e.unauthorized && e.code === 'revoked');
  srv.close();
});

test('Claude responses stream as NDJSON, including lines split across chunks', async () => {
  let sent;
  const { srv, url } = await fakeCore({
    'POST /api/trailmix/v1/claude': async (_q, res, body) => {
      sent = body;
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write('{"t":"d","text":"Hel');
      await new Promise((r) => setTimeout(r, 10));
      res.write('lo"}\n{"t":"d","text":" world"}\n');
      res.end('{"t":"done","stopReason":"end_turn","usage":{"input":10,"output":2}}\n');
    },
  });
  const core = new CoreClient({ baseUrl: url, token: 't' });
  const deltas = [];
  const out = await core.streamClaude({ purpose: 'enhance', model: 'claude-opus-5-5', system: 'S', messages: [{ role: 'user', content: 'hi' }], effort: 'medium', onDelta: (d) => deltas.push(d) });
  assert.equal(out.text, 'Hello world');
  assert.deepEqual(deltas, ['Hello', ' world']);
  assert.equal(sent.purpose, 'enhance');
  assert.equal(sent.model, 'claude-opus-5-5');
  srv.close();
});

test('stream errors and early disconnects are reported', async () => {
  const { srv, url } = await fakeCore({
    'POST /api/trailmix/v1/claude': (q, res, body) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      if (body.purpose === 'chat') res.end('{"t":"d","text":"a"}\n{"t":"error","message":"nope","code":"refusal"}\n');
      else res.end('{"t":"d","text":"partial"}\n');
    },
  });
  const core = new CoreClient({ baseUrl: url, token: 't' });
  await assert.rejects(core.streamClaude({ purpose: 'chat', messages: [] }), /declined/);
  await assert.rejects(core.streamClaude({ purpose: 'enhance', messages: [] }), /ended before the response finished/);
  srv.close();
});

test('rate limits surface Retry-After', async () => {
  const { srv, url } = await fakeCore({
    'POST /api/trailmix/v1/claude': (_q, res) =>
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '120' }).end(JSON.stringify({ error: 'slow down' })),
  });
  const core = new CoreClient({ baseUrl: url, token: 't' });
  await assert.rejects(core.streamClaude({ purpose: 'chat', messages: [] }), (e) => e.status === 429 && /in 2 min/.test(e.message));
  srv.close();
});

test('readNdjson handles a final line without a newline', async () => {
  async function* chunks() {
    yield new TextEncoder().encode('{"a":1}\n{"b":');
    yield new TextEncoder().encode('2}');
  }
  const out = [];
  for await (const m of readNdjson(chunks())) out.push(m);
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }]);
});
