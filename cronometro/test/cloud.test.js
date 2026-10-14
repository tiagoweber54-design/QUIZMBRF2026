'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Cloud = require('../public/cloud.js');
const core = require('../public/core.js');

test('new room codes are 8 characters with no look-alikes', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const room = Cloud.newRoom();
    assert.match(room, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    seen.add(room);
  }
  assert.equal(seen.size, 500, 'codes must not repeat');
});

test('typed codes are cleaned up; anything else is rejected', () => {
  assert.equal(Cloud.cleanRoom('K7M2Q9XR'), 'K7M2Q9XR');
  assert.equal(Cloud.cleanRoom('k7m2-q9xr'), 'K7M2Q9XR');
  assert.equal(Cloud.cleanRoom('  K7M2 Q9XR \n'), 'K7M2Q9XR');
  assert.equal(Cloud.cleanRoom('K7M2Q9X'), '');
  assert.equal(Cloud.cleanRoom('K7M2Q9XRZ'), '');
  assert.equal(Cloud.cleanRoom(''), '');
  assert.equal(Cloud.cleanRoom(null), '');
  assert.equal(Cloud.cleanRoom(undefined), '');
  assert.equal(Cloud.formatRoom('K7M2Q9XR'), 'K7M2-Q9XR');
  assert.equal(Cloud.cleanRoom(Cloud.formatRoom('K7M2Q9XR')), 'K7M2Q9XR');
});

test('the database address is accepted in the ways people paste it', () => {
  const host = 'cronometro-73d5c-default-rtdb.firebaseio.com';
  const same = { host, url: 'https://' + host };
  for (const text of [
    'https://' + host,
    'https://' + host + '/',
    'https://' + host + '/.json',
    '  https://' + host + '/  ',
    '"https://' + host + '"',
    '<https://' + host + '>',
    'HTTPS://' + host.toUpperCase(),
    'http://' + host,
    host,
    host + '/dados?x=1'
  ]) {
    assert.deepEqual(Cloud.parseDbUrl(text), same, JSON.stringify(text));
  }
  const regional = 'meu-projeto-default-rtdb.europe-west1.firebasedatabase.app';
  assert.deepEqual(Cloud.parseDbUrl('https://' + regional + '/'), { host: regional, url: 'https://' + regional });
  assert.deepEqual(Cloud.parseDbUrl('projeto-antigo-1234.firebaseio.com').host, 'projeto-antigo-1234.firebaseio.com');
});

test('anything that is not a Firebase database address is refused', () => {
  for (const text of [
    '',
    '   ',
    null,
    undefined,
    42,
    'https://example.com',
    'https://firebaseio.com',
    'https://evil.com/x.firebaseio.com',
    'https://x.firebaseio.com.evil.com',
    'https://x.firebaseio.com@evil.com',
    'https://evil.com#x.firebaseio.com',
    'https://x_y.firebaseio.com',
    'javascript:alert(1)',
    'https://console.firebase.google.com/u/1/project/cronometro-73d5c/database',
    'cronometro-73d5c'
  ]) {
    assert.equal(Cloud.parseDbUrl(text), null, JSON.stringify(text));
  }
});

test('the share link carries the room (and the database when the site does not know it)', () => {
  assert.deepEqual(Cloud.parseHash('#sala=K7M2Q9XR'), { room: 'K7M2Q9XR', db: '' });
  assert.deepEqual(Cloud.parseHash('#sala=k7m2-q9xr&db=x-default-rtdb.firebaseio.com'), { room: 'K7M2Q9XR', db: 'x-default-rtdb.firebaseio.com' });
  assert.deepEqual(Cloud.parseHash('#db=x-default-rtdb.firebaseio.com&sala=K7M2Q9XR'), { room: 'K7M2Q9XR', db: 'x-default-rtdb.firebaseio.com' });
  assert.deepEqual(Cloud.parseHash('#sala=K7M2Q9XR&db=https%3A%2F%2Fx-default-rtdb.firebaseio.com%2F'), { room: 'K7M2Q9XR', db: 'x-default-rtdb.firebaseio.com' });
  assert.deepEqual(Cloud.parseHash(''), { room: '', db: '' });
  assert.deepEqual(Cloud.parseHash('#'), { room: '', db: '' });
  assert.deepEqual(Cloud.parseHash('#sala=curto&db=evil.com'), { room: '', db: '' });
  assert.deepEqual(Cloud.parseHash('#sala=%E0%A4%A&x'), { room: '', db: '' });
  assert.deepEqual(Cloud.parseHash(undefined), { room: '', db: '' });

  assert.equal(Cloud.buildLink('https://a.github.io/x/', 'K7M2Q9XR', ''), 'https://a.github.io/x/#sala=K7M2Q9XR');
  assert.equal(Cloud.buildLink('https://a.github.io/x/', 'K7M2Q9XR', 'x-default-rtdb.firebaseio.com'),
    'https://a.github.io/x/#sala=K7M2Q9XR&db=x-default-rtdb.firebaseio.com');
  const link = Cloud.buildLink('', 'K7M2Q9XR', 'x-default-rtdb.firebaseio.com');
  assert.deepEqual(Cloud.parseHash(link.slice(link.indexOf('#'))), { room: 'K7M2Q9XR', db: 'x-default-rtdb.firebaseio.com' });

  assert.equal(Cloud.pageBase({ origin: 'https://a.github.io', pathname: '/x/cronometro/public/index.html' }), 'https://a.github.io/x/cronometro/public/');
  assert.equal(Cloud.pageBase({ origin: 'https://a.github.io', pathname: '/x/' }), 'https://a.github.io/x/');
});

test('lap lists come back from the database either as a list or as numbered keys', () => {
  assert.deepEqual(core.normalize({ stopwatch: { laps: [1000, 2500] } }).stopwatch.laps, [1000, 2500]);
  assert.deepEqual(core.normalize({ stopwatch: { laps: { 0: 1000, 1: 2500 } } }).stopwatch.laps, [1000, 2500]);
  assert.deepEqual(core.normalize({ stopwatch: { laps: { 10: 3, 2: 1 } } }).stopwatch.laps, [1, 3]);
  assert.deepEqual(core.normalize({ stopwatch: { laps: 'x' } }).stopwatch.laps, []);
  assert.deepEqual(core.normalize({ stopwatch: { laps: { a: 1 } } }).stopwatch.laps, []);
});

test('a state missing the parts the database drops still works', () => {
  // The database does not keep nulls or empty lists: a state read back is missing them.
  const written = JSON.parse(JSON.stringify(core.apply(core.initialState(), { type: 'start', target: 'timer' }, 1700000000000, { id: 'a', name: 'iPad' })));
  delete written.stopwatch.laps;
  delete written.stopwatch.startedAt;
  const back = core.normalize(written);
  assert.deepEqual(back.stopwatch, { elapsed: 0, startedAt: null, laps: [] });
  assert.equal(back.timer.startedAt, 1700000000000);
  const paused = core.apply(back, { type: 'pause', target: 'timer' }, 1700000005000, { id: 'b', name: 'iPhone' });
  assert.equal(core.timerView(paused, 1700000009000).remaining, 295000);
});
