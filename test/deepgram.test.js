import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { TranscriptionSession } from '../electron/deepgram.js';

test('streams audio, parses multichannel results, and closes cleanly', async () => {
  const wss = new WebSocketServer({ port: 0 });
  const port = wss.address().port;
  let gotAuth, gotQuery, bytes = 0, closeMsg = false;

  wss.on('connection', (ws, req) => {
    gotAuth = req.headers.authorization;
    gotQuery = new URL(req.url, 'http://x').searchParams;
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        bytes += data.length;
        if (bytes === 6400) {
          ws.send(JSON.stringify({
            type: 'Results', channel_index: [1, 2], is_final: true, start: 1.5, duration: 2,
            channel: { alternatives: [{ transcript: 'Hello from the client', words: [{ speaker: 1 }, { speaker: 1 }, { speaker: 0 }] }] },
          }));
        }
      } else if (JSON.parse(data).type === 'CloseStream') {
        closeMsg = true;
        ws.close();
      }
    });
  });

  const s = new TranscriptionSession({ apiKey: 'k', keyterms: ['CG Technologies'], offsetSec: 10, url: `ws://127.0.0.1:${port}` });
  const got = new Promise((r) => s.once('transcript', r));
  s.start();
  s.sendAudio(Buffer.alloc(3200)); // queued until open
  s.sendAudio(Buffer.alloc(3200));
  const t = await got;
  await s.stop();
  wss.close();

  assert.equal(gotAuth, 'Token k');
  assert.equal(gotQuery.get('multichannel'), 'true');
  assert.equal(gotQuery.get('channels'), '2');
  assert.deepEqual(gotQuery.getAll('keyterm'), ['CG Technologies']);
  assert.ok(closeMsg);
  assert.deepEqual(t, { channel: 1, isFinal: true, text: 'Hello from the client', speaker: 1, start: 11.5, end: 13.5 });
});

test('reports a rejected key as a fatal error', async () => {
  const { createServer } = await import('node:http');
  const srv = createServer((_q, res) => { res.writeHead(401); res.end(); }).listen(0);
  const port = srv.address().port;
  const s = new TranscriptionSession({ apiKey: 'bad', url: `ws://127.0.0.1:${port}` });
  const err = new Promise((r) => s.once('error', r));
  s.start();
  assert.match((await err).message, /rejected the API key/);
  await s.stop();
  srv.close();
});
