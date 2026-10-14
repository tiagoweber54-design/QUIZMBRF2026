'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTimerServer, APP_ID } = require('../server.js');

function start(options) {
  const app = createTimerServer(Object.assign({ stateFile: null }, options));
  return new Promise((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve({ app, port: app.server.address().port }));
  });
}

function stop(app) {
  return new Promise((resolve) => app.close(() => resolve()));
}

function request(port, method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: headers || {} }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function command(port, cmd, client) {
  return request(port, 'POST', '/api/command', JSON.stringify({ cmd, client: client || { id: 'tab-a', name: 'iPhone' } }), {
    'Content-Type': 'application/json'
  }).then((r) => Object.assign(r, { json: JSON.parse(r.body) }));
}

// Minimal EventSource for tests: collects events and lets a test wait for one.
function listen(port, query) {
  const events = [];
  const waiting = [];
  let buffer = '';
  let response = null;
  const req = http.get({ host: '127.0.0.1', port, path: '/api/events?' + query }, (res) => {
    response = res;
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buffer += chunk;
      let cut;
      while ((cut = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        let type = 'message';
        let data = '';
        block.split('\n').forEach((line) => {
          if (line.startsWith('event: ')) type = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        });
        if (!data) continue;
        const event = { type, data: JSON.parse(data) };
        events.push(event);
        waiting.slice().forEach((w) => {
          if (w.match(event)) {
            waiting.splice(waiting.indexOf(w), 1);
            w.resolve(event);
          }
        });
      }
    });
  });
  req.on('error', () => {});
  return {
    events,
    headers: () => response && response.headers,
    next(match, timeout) {
      const found = events.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { match, resolve };
        waiting.push(w);
        setTimeout(() => reject(new Error('timed out waiting for an event')), timeout || 2000).unref();
      });
    },
    close() { req.destroy(); }
  };
}

const isState = (rev) => (e) => e.type === 'state' && e.data.state.rev === rev;

test('serves the app and nothing outside the public folder', async () => {
  const { app, port } = await start();
  try {
    const home = await request(port, 'GET', '/');
    assert.equal(home.status, 200);
    assert.match(home.headers['content-type'], /text\/html/);
    assert.match(home.body, /Cronômetro Sync/);
    const js = await request(port, 'GET', '/core.js');
    assert.match(js.headers['content-type'], /javascript/);
    const head = await request(port, 'HEAD', '/');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    for (const p of ['/../server.js', '/..%2fserver.js', '/%2e%2e/server.js', '/..%5cserver.js', '/nada.html', '/%00']) {
      const r = await request(port, 'GET', p);
      assert.equal(r.status === 404 || r.status === 400, true, p + ' → ' + r.status);
      assert.doesNotMatch(r.body, /createTimerServer/);
    }
    assert.equal((await request(port, 'POST', '/')).status, 405);
  } finally {
    await stop(app);
  }
});

test('info and time endpoints', async () => {
  const { app, port } = await start();
  try {
    const info = JSON.parse((await request(port, 'GET', '/api/info')).body);
    assert.equal(info.app, APP_ID);
    assert.equal(info.port, port);
    assert.ok(Array.isArray(info.addresses));
    const t = JSON.parse((await request(port, 'GET', '/api/time')).body).t;
    assert.ok(Math.abs(t - Date.now()) < 1000);
    assert.equal((await request(port, 'GET', '/api/nada')).status, 404);
  } finally {
    await stop(app);
  }
});

test('a command from one device reaches every connected device', async () => {
  const { app, port } = await start();
  const ipad = listen(port, 'id=tab-ipad&name=' + encodeURIComponent('iPad · Safari'));
  const pc = listen(port, 'id=tab-pc&name=PC');
  try {
    const snap = await ipad.next((e) => e.type === 'state');
    assert.equal(snap.data.snapshot, true);
    assert.equal(snap.data.state.rev, 0);
    assert.equal(typeof snap.data.serverTime, 'number');
    assert.match(ipad.headers()['content-type'], /text\/event-stream/);
    await pc.next((e) => e.type === 'state');
    const both = await ipad.next((e) => e.type === 'clients' && e.data.clients.length === 2);
    assert.deepEqual(both.data.clients.map((c) => c.name).sort(), ['PC', 'iPad · Safari']);

    const res = await command(port, { type: 'start', target: 'timer' });
    assert.equal(res.status, 200);
    assert.equal(res.json.changed, true);
    assert.equal(res.json.state.rev, 1);
    for (const device of [ipad, pc]) {
      const e = await device.next(isState(1));
      assert.notEqual(e.data.state.timer.startedAt, null);
      assert.deepEqual(e.data.state.last.by, { id: 'tab-a', name: 'iPhone' });
      assert.equal(e.data.instance, res.json.instance);
    }

    // Nothing changes, nothing is broadcast.
    const again = await command(port, { type: 'start', target: 'timer' });
    assert.equal(again.json.changed, false);
    assert.equal(again.json.state.rev, 1);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(ipad.events.filter((e) => e.type === 'state').length, 2);
  } finally {
    ipad.close();
    pc.close();
    await stop(app);
  }
});

test('a device that disconnects leaves the list; the same tab reconnecting is listed once', async () => {
  const { app, port } = await start();
  const a = listen(port, 'id=tab-x&name=iPhone');
  const b = listen(port, 'id=tab-y&name=iPad');
  try {
    await a.next((e) => e.type === 'clients' && e.data.clients.length === 2);
    const a2 = listen(port, 'id=tab-x&name=iPhone');
    await a2.next((e) => e.type === 'state');
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(app.getClients().map((c) => c.id).sort(), ['tab-x', 'tab-y']);
    a2.close();
    await b.next((e) => e.type === 'clients' && e.data.clients.length === 1);
    assert.deepEqual(app.getClients().map((c) => c.id), ['tab-y']);
  } finally {
    a.close();
    b.close();
    await stop(app);
  }
});

test('rejects malformed commands and cross-site form posts', async () => {
  const { app, port } = await start();
  try {
    const plain = await request(port, 'POST', '/api/command', '{"cmd":{"type":"start"}}', { 'Content-Type': 'text/plain' });
    assert.equal(plain.status, 415);
    const bad = await request(port, 'POST', '/api/command', '{nope', { 'Content-Type': 'application/json' });
    assert.equal(bad.status, 400);
    const empty = await request(port, 'POST', '/api/command', '{}', { 'Content-Type': 'application/json' });
    assert.equal(empty.status, 400);
    const huge = await request(port, 'POST', '/api/command', JSON.stringify({ cmd: { type: 'title', text: 'x'.repeat(20000) } }), {
      'Content-Type': 'application/json'
    });
    assert.equal(huge.status, 413);
    assert.equal(app.getState().rev, 0);
  } finally {
    await stop(app);
  }
});

test('the state survives a restart, running timer included', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cronometro-'));
  const stateFile = path.join(dir, 'estado.json');
  try {
    let { app, port } = await start({ stateFile });
    await command(port, { type: 'set', ms: 90000 });
    await command(port, { type: 'start', target: 'timer' });
    await command(port, { type: 'title', text: 'Abertura' });
    await stop(app); // flushes the pending save
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.rev, 3);

    ({ app, port } = await start({ stateFile }));
    const res = JSON.parse((await request(port, 'GET', '/api/state')).body);
    assert.equal(res.state.title, 'Abertura');
    assert.equal(res.state.timer.base, 90000);
    assert.notEqual(res.state.timer.startedAt, null);
    await stop(app);

    fs.writeFileSync(stateFile, '{ broken');
    ({ app, port } = await start({ stateFile, log: () => {} }));
    assert.equal(app.getState().rev, 0);
    await stop(app);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
