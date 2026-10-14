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
