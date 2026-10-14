'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/core.js');

const T0 = 1700000000000;
const me = { id: 'tab-1', name: 'iPhone' };

function run(state, commands) {
  // commands: [[atMs, cmd], ...] relative to T0
  return commands.reduce((s, [at, cmd]) => core.apply(s, cmd, T0 + at, me), state);
}

test('starts with a paused 5 minute countdown', () => {
  const s = core.initialState();
  const v = core.timerView(s, T0);
  assert.equal(s.mode, 'timer');
  assert.equal(v.status, 'idle');
  assert.equal(v.remaining, 5 * 60000);
  assert.equal(core.clockText(v.shown), '05:00');
});

test('countdown runs, pauses and resumes without losing time', () => {
  let s = run(core.initialState(), [[0, { type: 'start', target: 'timer' }]]);
  let v = core.timerView(s, T0 + 1500);
  assert.equal(v.status, 'running');
  assert.equal(v.remaining, 298500);
  assert.equal(v.shown, 299); // rounded up: shows 04:59

  s = run(s, [[2000, { type: 'pause', target: 'timer' }]]);
  v = core.timerView(s, T0 + 60000); // time passes while paused
  assert.equal(v.status, 'paused');
  assert.equal(v.remaining, 298000);

  s = run(s, [[60000, { type: 'start', target: 'timer' }]]);
  v = core.timerView(s, T0 + 61000);
  assert.equal(v.remaining, 297000);
});

test('the shown second flips exactly on the second', () => {
  const s = run(core.initialState(), [[0, { type: 'set', ms: 3000 }], [0, { type: 'start', target: 'timer' }]]);
  assert.equal(core.timerView(s, T0 + 999).shown, 3);
  assert.equal(core.timerView(s, T0 + 1000).shown, 2);
  assert.equal(core.timerView(s, T0 + 2999).shown, 1);
  assert.equal(core.timerView(s, T0 + 3000).shown, 0);
  assert.equal(Object.is(core.timerView(s, T0 + 3500).shown, -0), false);
});

test('reset brings back the chosen duration, even after adjustments', () => {
  const s = run(core.initialState(), [
    [0, { type: 'set', ms: 10 * 60000 }],
    [0, { type: 'start', target: 'timer' }],
    [5000, { type: 'adjust', ms: 60000 }],
    [6000, { type: 'reset', target: 'timer' }]
  ]);
  const v = core.timerView(s, T0 + 9000);
  assert.equal(v.status, 'idle');
  assert.equal(v.remaining, 10 * 60000);
});

test('adjust adds and removes remaining time, never below zero', () => {
  let s = run(core.initialState(), [[0, { type: 'set', ms: 60000 }], [0, { type: 'start', target: 'timer' }]]);
  s = run(s, [[30000, { type: 'adjust', ms: 60000 }]]);
  assert.equal(core.timerView(s, T0 + 30000).remaining, 90000);
  s = run(s, [[30000, { type: 'adjust', ms: -10 * 60000 }]]);
  const v = core.timerView(s, T0 + 30000);
  assert.equal(v.remaining, 0);
  assert.equal(v.finished, true);
});

test('in overtime, +1 min gives a full minute from now and −10 s does nothing', () => {
  let s = run(core.initialState(), [[0, { type: 'set', ms: 10000 }], [0, { type: 'start', target: 'timer' }]]);
  let v = core.timerView(s, T0 + 25000);
  assert.equal(v.remaining, -15000);
  assert.equal(v.phase, 'over');
  assert.equal(core.clockText(v.shown), '00:15');
  assert.ok(v.shown < 0);

  const same = core.apply(s, { type: 'adjust', ms: -10000 }, T0 + 25000, me);
  assert.equal(same, s);

  s = core.apply(s, { type: 'adjust', ms: 60000 }, T0 + 25000, me);
  v = core.timerView(s, T0 + 25000);
  assert.equal(v.remaining, 60000);
  assert.equal(v.phase, 'danger'); // one minute left: red, with the default thresholds
});

test('with overtime off the countdown stops at zero and needs a restart', () => {
  let s = run(core.initialState(), [
    [0, { type: 'settings', overtime: false }],
    [0, { type: 'set', ms: 5000 }],
    [0, { type: 'start', target: 'timer' }]
  ]);
  let v = core.timerView(s, T0 + 9000);
  assert.equal(v.remaining, 0);
  assert.equal(v.running, false);
  assert.equal(v.status, 'finished');

  assert.equal(core.apply(s, { type: 'start', target: 'timer' }, T0 + 9000, me), s);
  s = core.apply(s, { type: 'restart', target: 'timer' }, T0 + 9000, me);
  v = core.timerView(s, T0 + 10000);
  assert.equal(v.status, 'running');
  assert.equal(v.remaining, 4000);
});

test('turning overtime off while over time freezes the countdown at zero', () => {
  let s = run(core.initialState(), [[0, { type: 'set', ms: 5000 }], [0, { type: 'start', target: 'timer' }]]);
  s = core.apply(s, { type: 'settings', overtime: false }, T0 + 8000, me);
  assert.equal(s.timer.startedAt, null);
  assert.equal(s.timer.elapsed, 5000);
  s = core.apply(s, { type: 'settings', overtime: true }, T0 + 9000, me);
  assert.equal(core.timerView(s, T0 + 20000).remaining, 0); // stays stopped
});

test('paused in overtime, start keeps counting the excess', () => {
  let s = run(core.initialState(), [
    [0, { type: 'set', ms: 5000 }],
    [0, { type: 'start', target: 'timer' }],
    [7000, { type: 'pause', target: 'timer' }]
  ]);
  assert.equal(core.timerView(s, T0 + 20000).status, 'paused');
  s = core.apply(s, { type: 'start', target: 'timer' }, T0 + 20000, me);
  assert.equal(core.timerView(s, T0 + 21000).remaining, -3000);
});

test('warning colors follow the number on screen and skip thresholds longer than the timer', () => {
  const base = run(core.initialState(), [[0, { type: 'settings', warnAt: 120000, dangerAt: 60000 }]]);
  let s = run(base, [[0, { type: 'set', ms: 5 * 60000 }], [0, { type: 'start', target: 'timer' }]]);
  assert.equal(core.timerView(s, T0 + 179000).phase, 'normal'); // shows 02:01
  assert.equal(core.timerView(s, T0 + 180500).phase, 'warn'); // shows 02:00
  assert.equal(core.timerView(s, T0 + 240500).phase, 'danger'); // shows 01:00
  assert.equal(core.timerView(s, T0 + 300000).phase, 'over');

  s = run(base, [[0, { type: 'set', ms: 60000 }], [0, { type: 'start', target: 'timer' }]]);
  assert.equal(core.timerView(s, T0 + 100).phase, 'normal'); // a 1 min timer does not start red
  s = run(base, [[0, { type: 'settings', warnAt: 0, dangerAt: 0 }], [0, { type: 'set', ms: 30000 }]]);
  assert.equal(core.timerView(s, T0).phase, 'normal');
});

test('set clamps to 1 s – 99:59:59 and can start right away', () => {
  let s = core.apply(core.initialState(), { type: 'set', ms: 0 }, T0, me);
  assert.equal(s.timer.base, 1000);
  s = core.apply(s, { type: 'set', ms: 1e12 }, T0, me);
  assert.equal(s.timer.base, core.MAX_MS);
  assert.equal(core.clockText(s.timer.base / 1000), '99:59:59');
  s = core.apply(s, { type: 'set', ms: 90 * 60000, start: true }, T0, me);
  assert.equal(core.timerView(s, T0 + 1000).status, 'running');
  assert.equal(core.clockText(core.timerView(s, T0).shown), '1:30:00');
  assert.equal(core.apply(s, { type: 'set', ms: 'abc' }, T0, me), s);
});

test('stopwatch counts, laps only while running and resets the laps', () => {
  let s = run(core.initialState(), [
    [0, { type: 'mode', mode: 'stopwatch' }],
    [0, { type: 'lap' }], // not running yet: ignored
    [0, { type: 'start', target: 'stopwatch' }],
    [1234, { type: 'lap' }],
    [3000, { type: 'lap' }],
    [3500, { type: 'pause', target: 'stopwatch' }]
  ]);
  let v = core.stopwatchView(s, T0 + 9999);
  assert.deepEqual(v.laps, [1234, 3000]);
  assert.equal(v.elapsed, 3500);
  assert.equal(v.lapNumber, 3);
  assert.equal(v.lapElapsed, 500);
  assert.equal(v.status, 'paused');
  assert.deepEqual(core.stopwatchText(v.elapsed), { main: '00:03', frac: '50' });

  s = core.apply(s, { type: 'reset', target: 'stopwatch' }, T0 + 9999, me);
  v = core.stopwatchView(s, T0 + 9999);
  assert.equal(v.status, 'idle');
  assert.deepEqual(v.laps, []);
});

test('timer and stopwatch run independently; commands name their target', () => {
  let s = run(core.initialState(), [
    [0, { type: 'start', target: 'timer' }],
    [0, { type: 'mode', mode: 'stopwatch' }],
    [1000, { type: 'start', target: 'stopwatch' }],
    [2000, { type: 'pause', target: 'stopwatch' }]
  ]);
  assert.equal(core.timerView(s, T0 + 5000).running, true);
  assert.equal(core.stopwatchView(s, T0 + 5000).elapsed, 1000);
  // A stale screen asking to pause the timer pauses the timer, not what is shown.
  s = core.apply(s, { type: 'pause', target: 'timer' }, T0 + 5000, me);
  assert.equal(core.timerView(s, T0 + 9000).remaining, 295000);
});

test('rev and last change only when something changes', () => {
  const s0 = core.initialState();
  const s1 = core.apply(s0, { type: 'start', target: 'timer' }, T0, me);
  assert.equal(s1.rev, 1);
  assert.deepEqual(s1.last, { type: 'start', target: 'timer', ms: null, by: { id: 'tab-1', name: 'iPhone' }, at: T0 });
  assert.equal(core.apply(s1, { type: 'start', target: 'timer' }, T0 + 5, me), s1);
  assert.equal(core.apply(s1, { type: 'nonsense' }, T0, me), s1);
  assert.equal(core.apply(s1, null, T0, me), s1);
  assert.equal(core.apply(s1, { type: 'mode', mode: 'clock' }, T0, me), s1);
  assert.equal(s0.rev, 0, 'the input state is never mutated');
});

test('message and title are cleaned, limited and versioned', () => {
  let s = core.apply(core.initialState(), { type: 'message', text: '  Faltam\n5   minutos ', flash: true }, T0, me);
  assert.deepEqual(s.message, { text: 'Faltam 5 minutos', flash: true, id: 1 });
  s = core.apply(s, { type: 'message', text: 'Faltam 5 minutos', flash: true }, T0, me);
  assert.equal(s.message.id, 2, 'sending again flashes again');
  s = core.apply(s, { type: 'message', text: '' }, T0, me);
  assert.deepEqual(s.message, { text: '', flash: false, id: 3 });
  assert.equal(core.apply(s, { type: 'message', text: '   ' }, T0, me), s);

  s = core.apply(s, { type: 'title', text: 'x'.repeat(200) }, T0, me);
  assert.equal(s.title.length, core.MAX_TITLE);
  s = core.apply(s, { type: 'title', text: '😀'.repeat(100) }, T0, me);
  assert.equal(Array.from(s.title).length, core.MAX_TITLE, 'emoji are never cut in half');
});

test('normalize repairs anything into a valid state', () => {
  assert.deepEqual(core.normalize(null), core.initialState());
  assert.deepEqual(core.normalize('garbage'), core.initialState());
  const s = core.normalize({
    rev: -5,
    mode: 'weird',
    timer: { base: -1, duration: 'x', elapsed: -100, startedAt: 'yesterday' },
    stopwatch: { laps: [5, -1, 'a', 7.6, Infinity], startedAt: T0 },
    settings: { warnAt: -1, dangerAt: 9e20, overtime: 'yes' },
    message: { text: 42, flash: true, id: 3 },
    last: { type: 'start', by: { id: 7, name: 'iPad' }, at: T0 }
  });
  assert.equal(s.rev, 0);
  assert.equal(s.mode, 'timer');
  assert.equal(s.timer.base, 1000);
  assert.equal(s.timer.duration, 1000);
  assert.equal(s.timer.elapsed, 0);
  assert.equal(s.timer.startedAt, null);
  assert.deepEqual(s.stopwatch.laps, [5, 8]);
  assert.equal(s.stopwatch.startedAt, T0);
  assert.equal(s.settings.warnAt, 0);
  assert.equal(s.settings.dangerAt, core.MAX_MS);
  assert.equal(s.settings.overtime, true);
  assert.deepEqual(s.message, { text: '', flash: false, id: 3 });
  assert.deepEqual(s.last.by, { id: '', name: 'iPad' });
});

test('formatting helpers', () => {
  assert.equal(core.clockText(0), '00:00');
  assert.equal(core.clockText(59), '00:59');
  assert.equal(core.clockText(-75), '01:15');
  assert.equal(core.clockText(3600), '1:00:00');
  assert.equal(core.clockText(36000 + 61), '10:01:01');
  assert.deepEqual(core.stopwatchText(61234), { main: '01:01', frac: '23' });
  assert.equal(core.durationLabel(30000), '30 s');
  assert.equal(core.durationLabel(-60000), '1 min');
  assert.equal(core.durationLabel(150000), '2 min 30 s');
  assert.equal(core.durationLabel(5400000), '1 h 30 min');
  assert.equal(core.durationLabel(0), '0 s');
});

// ------------------------------------------------------------------ seminar

const SEMINAR_LIMIT = 8 * 60000;

function onTheClock(id, ms) {
  return run(core.initialState(), [[0, { type: 'select', id, ms: ms || SEMINAR_LIMIT }]]);
}

test('one point is lost for every full minute over the limit', () => {
  const cases = [[-60000, 0], [0, 0], [1, 0], [59999, 0], [60000, 1], [119999, 1], [120000, 2], [185000, 3]];
  for (const [over, points] of cases) assert.equal(core.penaltyPoints(over), points, over + ' ms over');
});

test('choosing a presentation puts its limit on the clock, ready to start', () => {
  const s = onTheClock('p01');
  assert.equal(s.agenda.current, 'p01');
  assert.equal(s.timer.base, SEMINAR_LIMIT);
  assert.equal(s.timer.duration, SEMINAR_LIMIT);
  assert.equal(core.timerView(s, T0 + 5000).status, 'idle');
  assert.equal(s.settings.overtime, true);
  assert.equal(s.mode, 'timer');
  // a bad id or a bad limit changes nothing
  assert.equal(core.apply(s, { type: 'select', id: 'P 01!', ms: 1000 }, T0, me), s);
  assert.equal(core.apply(s, { type: 'select', id: 'p02', ms: 'x' }, T0, me), s);
  assert.equal(core.apply(s, { type: 'select', id: '', ms: 1000 }, T0, me), s);
});

test('stopping registers the time used; only then does it count', () => {
  let s = onTheClock('p01');
  s = run(s, [[1000, { type: 'start', target: 'timer' }], [61000, { type: 'pause', target: 'timer' }]]);
  assert.deepEqual(s.agenda.results, {}, 'pausing registers nothing');
  s = run(s, [[100000, { type: 'start', target: 'timer' }]]); // paused for 39 s, then on again
  s = core.apply(s, { type: 'finish' }, T0 + 100000 + 60000, me);
  const r = s.agenda.results.p01;
  assert.equal(r.used, 120000);
  assert.equal(r.allowed, SEMINAR_LIMIT);
  assert.equal(r.points, 0);
  assert.equal(r.by, 'iPhone');
  assert.equal(core.isRegistered(s), true);
  assert.equal(core.timerView(s, T0 + 9e6).status, 'paused', 'the clock stays stopped');
  assert.equal(s.last.type, 'finish');
  assert.equal(s.last.ms, 120000);
});

test('going over the limit costs points, and the time is kept exactly', () => {
  let s = onTheClock('p01', 3 * 60000);
  s = run(s, [[0, { type: 'start', target: 'timer' }]]);
  s = core.apply(s, { type: 'finish' }, T0 + 3 * 60000 + 59999, me);
  assert.equal(s.agenda.results.p01.points, 0, 'under a minute over is free');

  s = onTheClock('p02', 3 * 60000);
  s = run(s, [[0, { type: 'start', target: 'timer' }]]);
  s = core.apply(s, { type: 'finish' }, T0 + 3 * 60000 + 60000, me);
  assert.equal(s.agenda.results.p02.points, 1);
  assert.equal(s.agenda.results.p02.used, 4 * 60000);

  s = onTheClock('p03', 3 * 60000);
  s = run(s, [[0, { type: 'start', target: 'timer' }]]);
  s = core.apply(s, { type: 'finish' }, T0 + 3 * 60000 + 150000, me);
  assert.equal(s.agenda.results.p03.points, 2);
});

test('stopping works from a pause, and does nothing before anything was timed', () => {
  let s = onTheClock('p01');
  assert.equal(core.apply(s, { type: 'finish' }, T0 + 1000, me), s, 'nothing timed yet');
  s = run(s, [[0, { type: 'start', target: 'timer' }], [90000, { type: 'pause', target: 'timer' }]]);
  s = core.apply(s, { type: 'finish' }, T0 + 500000, me);
  assert.equal(s.agenda.results.p01.used, 90000, 'time spent paused is not counted');
  assert.equal(core.apply(s, { type: 'finish' }, T0 + 600000, me), s, 'registering twice does nothing');
  assert.equal(core.apply(core.initialState(), { type: 'finish' }, T0, me).agenda.current, null);
});

test('a registered presentation cannot be restarted or adjusted, but can be redone', () => {
  let s = onTheClock('p01');
  s = run(s, [[0, { type: 'start', target: 'timer' }], [60000, { type: 'finish' }]]);
  assert.equal(core.apply(s, { type: 'start', target: 'timer' }, T0 + 70000, me), s);
  assert.equal(core.apply(s, { type: 'adjust', ms: 60000 }, T0 + 70000, me), s);
  // Zerar clears the clock; the new run overwrites the old result
  s = core.apply(s, { type: 'reset', target: 'timer' }, T0 + 80000, me);
  assert.equal(core.isRegistered(s), false);
  assert.ok(s.agenda.results.p01, 'the old result stays until replaced');
  s = run(s, [[90000, { type: 'start', target: 'timer' }]]);
  s = core.apply(s, { type: 'finish' }, T0 + 90000 + 30000, me);
  assert.equal(s.agenda.results.p01.used, 30000);
});

test('a presentation under way is not replaced by accident', () => {
  let s = onTheClock('p01');
  s = run(s, [[0, { type: 'start', target: 'timer' }]]);
  assert.equal(core.apply(s, { type: 'select', id: 'p02', ms: 60000 }, T0 + 5000, me), s, 'running');
  s = run(s, [[5000, { type: 'pause', target: 'timer' }]]);
  assert.equal(core.apply(s, { type: 'select', id: 'p02', ms: 60000 }, T0 + 6000, me), s, 'paused');
  const forced = core.apply(s, { type: 'select', id: 'p02', ms: 60000, force: true }, T0 + 6000, me);
  assert.equal(forced.agenda.current, 'p02');
  assert.deepEqual(forced.agenda.results, {}, 'the abandoned one registers nothing');
  // once registered, the next one can be chosen freely
  let done = onTheClock('p01');
  done = run(done, [[0, { type: 'start', target: 'timer' }], [10000, { type: 'finish' }]]);
  assert.equal(core.apply(done, { type: 'select', id: 'p02', ms: 60000 }, T0 + 20000, me).agenda.current, 'p02');
  assert.ok(core.apply(done, { type: 'select', id: 'p02', ms: 60000 }, T0 + 20000, me).agenda.results.p01, 'results are kept');
});

test('results can be cleared one by one or all together', () => {
  let s = core.initialState();
  for (const id of ['p01', 'p02', 'p03']) {
    s = run(s, [[0, { type: 'select', id, ms: 60000 }], [0, { type: 'start', target: 'timer' }], [5000, { type: 'finish' }]]);
  }
  assert.deepEqual(Object.keys(s.agenda.results).sort(), ['p01', 'p02', 'p03']);
  s = core.apply(s, { type: 'clearResult', id: 'p02' }, T0, me);
  assert.deepEqual(Object.keys(s.agenda.results).sort(), ['p01', 'p03']);
  assert.equal(core.apply(s, { type: 'clearResult', id: 'p02' }, T0, me), s, 'already gone');
  s = core.apply(s, { type: 'clearResult', id: '*' }, T0, me);
  assert.deepEqual(s.agenda.results, {});
  assert.equal(core.apply(s, { type: 'clearResult', id: '*' }, T0, me), s);
});

test('a free countdown leaves the seminar, and overtime stays on during a presentation', () => {
  let s = onTheClock('p01');
  assert.equal(core.apply(s, { type: 'settings', overtime: false }, T0, me), s, 'cannot switch overtime off mid-presentation');
  s = core.apply(s, { type: 'set', ms: 5 * 60000 }, T0, me);
  assert.equal(s.agenda.current, null);
  assert.equal(core.apply(s, { type: 'settings', overtime: false }, T0, me).settings.overtime, false);
});

test('results survive a trip through the database', () => {
  let s = onTheClock('p07');
  s = run(s, [[0, { type: 'start', target: 'timer' }], [90000, { type: 'finish' }]]);
  const stored = JSON.parse(JSON.stringify(s)); // nulls and empty lists are dropped by the database
  delete stored.last.ms;
  const back = core.normalize(stored);
  assert.equal(back.agenda.current, 'p07');
  assert.deepEqual(back.agenda.results.p07, s.agenda.results.p07);
  // an older state without any agenda still works
  const old = core.normalize({ rev: 3, timer: { base: 60000, duration: 60000, elapsed: 0 } });
  assert.deepEqual(old.agenda, { current: null, sent: {}, results: {} });
  // junk is dropped
  const junk = core.normalize({ agenda: { current: 'NOT OK!', results: { 'bad id': { used: 1, allowed: 1 }, p01: 'x', p02: { used: 5000, allowed: 'x' }, p03: { used: 5000, allowed: 60000, points: -3 } } } });
  assert.equal(junk.agenda.current, null);
  assert.deepEqual(Object.keys(junk.agenda.results), ['p03']);
  assert.equal(junk.agenda.results.p03.points, 0);
});

test('automatic messages: half time and one minute left, once each', () => {
  const text = (k) => (k === 'half' ? 'Metade do tempo: faltam 4 minutos' : 'Falta 1 minuto');
  let s = onTheClock('p01'); // 8 min
  s = run(s, [[0, { type: 'start', target: 'timer' }]]);
  const alert = (kind, at) => core.apply(s, { type: 'alert', kind, text: text(kind) }, T0 + at, me);

  assert.equal(alert('half', 3 * 60000), s, 'too early');
  assert.equal(alert('last', 3 * 60000), s, 'too early');
  const half = alert('half', 4 * 60000);
  assert.equal(half.message.text, 'Metade do tempo: faltam 4 minutos');
  assert.equal(half.message.flash, true);
  assert.equal(half.message.id, 1);
  assert.equal(half.message.until, T0 + 4 * 60000 + core.ALERT_SHOW_MS);
  assert.equal(half.agenda.sent.half, true);
  assert.equal(core.apply(half, { type: 'alert', kind: 'half', text: 'de novo' }, T0 + 4 * 60000 + 500, me), half, 'a second device asking changes nothing');

  const late = core.apply(half, { type: 'alert', kind: 'last', text: text('last') }, T0 + 7 * 60000, me);
  assert.equal(late.message.text, 'Falta 1 minuto');
  assert.equal(late.message.id, 2);
  assert.deepEqual(late.agenda.sent, { half: true, last: true });
  assert.equal(core.apply(late, { type: 'alert', kind: 'last', text: 'x' }, T0 + 7 * 60000 + 1000, me), late);
  assert.equal(core.apply(s, { type: 'alert', kind: 'last', text: text('last') }, T0 + 8 * 60000 + 1000, me), s, 'too late: already over');
  assert.equal(core.apply(s, { type: 'alert', kind: 'half', text: 'x' }, T0 + 7 * 60000 + 5000, me), s, 'the half-time message is skipped once the minute warning is near');
  assert.equal(core.apply(s, { type: 'alert', kind: 'other', text: 'x' }, T0 + 4 * 60000, me), s);
  assert.equal(core.apply(s, { type: 'alert', kind: 'half', text: '   ' }, T0 + 4 * 60000, me), s);
});

test('automatic messages need a running presentation and start over with each one', () => {
  const idle = onTheClock('p01');
  assert.equal(core.apply(idle, { type: 'alert', kind: 'half', text: 'x' }, T0 + 4 * 60000, me), idle, 'not started');
  assert.equal(core.apply(core.initialState(), { type: 'alert', kind: 'half', text: 'x' }, T0, me).message.text, '', 'no presentation');
  let s = run(idle, [[0, { type: 'start', target: 'timer' }], [4 * 60000, { type: 'pause', target: 'timer' }]]);
  assert.equal(core.apply(s, { type: 'alert', kind: 'half', text: 'x' }, T0 + 5 * 60000, me), s, 'paused');
  s = run(onTheClock('p01'), [[0, { type: 'start', target: 'timer' }], [10000, { type: 'finish' }]]);
  assert.equal(core.apply(s, { type: 'alert', kind: 'last', text: 'x' }, T0 + 20000, me), s, 'already registered');

  let a = run(onTheClock('p01'), [[0, { type: 'start', target: 'timer' }]]);
  a = core.apply(a, { type: 'alert', kind: 'half', text: 'metade' }, T0 + 4 * 60000, me);
  assert.equal(a.agenda.sent.half, true);
  assert.deepEqual(core.apply(a, { type: 'reset', target: 'timer' }, T0 + 5 * 60000, me).agenda.sent, {}, 'Zerar');
  assert.deepEqual(core.apply(a, { type: 'select', id: 'p02', ms: 60000, force: true }, T0 + 5 * 60000, me).agenda.sent, {}, 'next presentation');
  assert.deepEqual(core.apply(a, { type: 'set', ms: 60000 }, T0 + 5 * 60000, me).agenda.sent, {}, 'free countdown');
  // a short slot never gets a half-time message
  const short = run(onTheClock('p03', 2 * 60000), [[0, { type: 'start', target: 'timer' }]]);
  assert.equal(core.apply(short, { type: 'alert', kind: 'half', text: 'x' }, T0 + 60000, me), short);
  assert.equal(core.apply(short, { type: 'alert', kind: 'last', text: 'x' }, T0 + 60000, me).agenda.sent.last, true);
});

test('a typed message replaces an automatic one and does not fade; flags and expiry survive the database', () => {
  let s = run(onTheClock('p01'), [[0, { type: 'start', target: 'timer' }]]);
  s = core.apply(s, { type: 'alert', kind: 'half', text: 'metade' }, T0 + 4 * 60000, me);
  assert.ok(s.message.until);
  const typed = core.apply(s, { type: 'message', text: 'Conclua, por favor', flash: true }, T0 + 4 * 60000 + 1000, me);
  assert.equal(typed.message.until, undefined);
  assert.equal(core.apply(typed, { type: 'message', text: '' }, T0 + 4 * 60000 + 2000, me).message.until, undefined);
  const back = core.normalize(JSON.parse(JSON.stringify(s)));
  assert.equal(back.message.until, s.message.until);
  assert.deepEqual(back.agenda.sent, { half: true });
  assert.deepEqual(core.normalize({ agenda: { sent: { half: 'yes', last: 1, extra: true } } }).agenda.sent, {});
  assert.equal(core.normalize({ message: { text: '', until: T0 } }).message.until, undefined);
});
