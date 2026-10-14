/*
 * Cronômetro Sync — shared core (runs in the browser and in Node).
 *
 * Pure state logic. The server applies every command to the one authoritative
 * state; each device renders that state against its estimate of the server
 * clock, so every screen shows the same time.
 *
 * All times are integer milliseconds. A running clock stores the server time
 * it was started at (startedAt) plus what it had accumulated before (elapsed).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TimerCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SECOND = 1000;
  var MINUTE = 60 * SECOND;
  var MAX_MS = (99 * 3600 + 59 * 60 + 59) * SECOND; // 99:59:59
  var MAX_LAPS = 99;
  var MAX_TITLE = 80;
  var MAX_MESSAGE = 140;
  var MAX_NAME = 40;

  function initialState() {
    return {
      v: 1,
      rev: 0,
      mode: 'timer', // what every screen shows: 'timer' | 'stopwatch'
      title: '',
      timer: { base: 5 * MINUTE, duration: 5 * MINUTE, elapsed: 0, startedAt: null },
      stopwatch: { elapsed: 0, startedAt: null, laps: [] },
      settings: { warnAt: 2 * MINUTE, dangerAt: 1 * MINUTE, overtime: true },
      message: { text: '', flash: false, id: 0 },
      last: null // last change: { type, target, ms, by: { id, name }, at }
    };
  }

  // ------------------------------------------------------------------ helpers

  function clamp(n, min, max) { return n < min ? min : n > max ? max : n; }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function int(v, min, max, fallback) { return isNum(v) ? clamp(Math.round(v), min, max) : fallback; }

  function isTime(v) { return isNum(v) && v > 0 && v < 1e15; }

  // Whole seconds, keeping the sign; null when it is not a number.
  function roundSeconds(v) {
    if (!isNum(v)) return null;
    var s = Math.round(Math.abs(v) / SECOND) * SECOND;
    return v < 0 ? -s : s;
  }

  // Single-line text: no control characters, collapsed spaces, at most `max` characters.
  function cleanText(v, max) {
    if (typeof v !== 'string') return '';
    var s = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
    var chars = Array.from(s);
    return chars.length > max ? chars.slice(0, max).join('').trim() : s;
  }

  function clone(state) { return JSON.parse(JSON.stringify(state)); }

  function elapsedOf(clock, now) {
    return clock.startedAt == null ? clock.elapsed : clock.elapsed + Math.max(0, now - clock.startedAt);
  }

  // With "overtime" off, a countdown that ran out stops at zero. The state is
  // only rewritten when the next command arrives; the views apply the same rule.
  function settleTimer(t, settings, now) {
    if (t.startedAt != null && !settings.overtime && elapsedOf(t, now) >= t.duration) {
      t.elapsed = t.duration;
      t.startedAt = null;
    }
  }

  // ------------------------------------------------------------------- state

  // Rebuilds a valid state from anything (saved file, network, localStorage).
  function normalize(raw) {
    var s = initialState();
    if (!raw || typeof raw !== 'object') return s;
    s.rev = int(raw.rev, 0, Number.MAX_SAFE_INTEGER, 0);
    s.mode = raw.mode === 'stopwatch' ? 'stopwatch' : 'timer';
    s.title = cleanText(raw.title, MAX_TITLE);

    var t = raw.timer || {};
    s.timer.base = int(t.base, SECOND, MAX_MS, s.timer.base);
    s.timer.duration = int(t.duration, 0, MAX_MS * 4, s.timer.base);
    s.timer.elapsed = int(t.elapsed, 0, MAX_MS * 4, 0);
    s.timer.startedAt = isTime(t.startedAt) ? Math.round(t.startedAt) : null;

    var w = raw.stopwatch || {};
    s.stopwatch.elapsed = int(w.elapsed, 0, MAX_MS, 0);
    s.stopwatch.startedAt = isTime(w.startedAt) ? Math.round(w.startedAt) : null;
    s.stopwatch.laps = (Array.isArray(w.laps) ? w.laps : [])
      .filter(function (x) { return isNum(x) && x >= 0; })
      .slice(0, MAX_LAPS)
      .map(function (x) { return Math.min(Math.round(x), MAX_MS); });

    var st = raw.settings || {};
    s.settings.warnAt = int(st.warnAt, 0, MAX_MS, s.settings.warnAt);
    s.settings.dangerAt = int(st.dangerAt, 0, MAX_MS, s.settings.dangerAt);
    s.settings.overtime = typeof st.overtime === 'boolean' ? st.overtime : s.settings.overtime;

    var m = raw.message || {};
    s.message.text = cleanText(m.text, MAX_MESSAGE);
    s.message.flash = m.flash === true && s.message.text !== '';
    s.message.id = int(m.id, 0, Number.MAX_SAFE_INTEGER, 0);

    var l = raw.last;
    if (l && typeof l === 'object' && typeof l.type === 'string') {
      s.last = {
        type: cleanText(l.type, 20),
        target: l.target === 'stopwatch' || l.target === 'timer' ? l.target : null,
        ms: isNum(l.ms) ? Math.round(l.ms) : null,
        by: l.by && typeof l.by === 'object'
          ? { id: cleanText(l.by.id, 64), name: cleanText(l.by.name, MAX_NAME) }
          : null,
        at: isTime(l.at) ? Math.round(l.at) : 0
      };
    }
    return s;
  }

  /*
   * Applies one command at server time `now`. Returns a new state, or the very
   * same object when the command changes nothing (callers compare by identity).
   *
   * Commands carry their target explicitly ('timer' | 'stopwatch'), so a device
   * showing an old screen can never pause the wrong clock:
   *   { type: 'start' | 'pause' | 'reset' | 'restart', target }
   *   { type: 'set', ms, start? }        countdown length (resets the countdown)
   *   { type: 'adjust', ms }             add (or take, if negative) remaining time
   *   { type: 'lap' }                    stopwatch lap
   *   { type: 'mode', mode }             what every screen shows
   *   { type: 'title', text }            label above the time
   *   { type: 'message', text, flash? }  banner on every screen ('' clears it)
   *   { type: 'settings', warnAt?, dangerAt?, overtime? }
   */
  function apply(state, cmd, now, by) {
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') return state;
    var next = clone(state);
    var t = next.timer;
    var w = next.stopwatch;
    var target = cmd.target === 'timer' || cmd.target === 'stopwatch' ? cmd.target : next.mode;
    var clock = target === 'timer' ? t : w;
    var changed = false;
    var ms = null;
    var value;

    settleTimer(t, next.settings, now);

    switch (cmd.type) {
      case 'mode':
        if ((cmd.mode === 'timer' || cmd.mode === 'stopwatch') && cmd.mode !== next.mode) {
          next.mode = cmd.mode;
          changed = true;
        }
        target = next.mode;
        break;

      case 'start':
        if (clock.startedAt == null) {
          // A countdown stopped at zero cannot resume; it needs 'restart'.
          var canRun = target === 'timer'
            ? t.elapsed < t.duration || next.settings.overtime
            : w.elapsed < MAX_MS;
          if (canRun) {
            clock.startedAt = now;
            changed = true;
          }
        }
        break;

      case 'pause':
        if (clock.startedAt != null) {
          clock.elapsed = Math.min(elapsedOf(clock, now), target === 'timer' ? t.duration + MAX_MS : MAX_MS);
          clock.startedAt = null;
          changed = true;
        }
        break;

      case 'reset':
        if (target === 'timer') {
          if (t.elapsed !== 0 || t.startedAt != null || t.duration !== t.base) {
            t.duration = t.base;
            t.elapsed = 0;
            t.startedAt = null;
            changed = true;
          }
        } else if (w.elapsed !== 0 || w.startedAt != null || w.laps.length) {
          w.elapsed = 0;
          w.startedAt = null;
          w.laps = [];
          changed = true;
        }
        break;

      case 'restart':
        if (target === 'timer') t.duration = t.base;
        else w.laps = [];
        clock.elapsed = 0;
        clock.startedAt = now;
        changed = true;
        break;

      case 'set':
        ms = roundSeconds(cmd.ms);
        if (ms === null) break;
        ms = clamp(ms, SECOND, MAX_MS);
        t.base = ms;
        t.duration = ms;
        t.elapsed = 0;
        t.startedAt = cmd.start === true ? now : null;
        target = 'timer';
        changed = true;
        break;

      case 'adjust':
        ms = roundSeconds(cmd.ms);
        if (!ms) break;
        ms = clamp(ms, -MAX_MS, MAX_MS);
        var spent = elapsedOf(t, now);
        var left = t.duration - spent;
        if (left <= 0 && ms < 0) break; // nothing left to take away
        // Time already over counts as zero: "+1 min" gives one more minute from now.
        var newLeft = clamp(Math.max(left, 0) + ms, 0, MAX_MS);
        if (newLeft === left) break;
        t.duration = spent + newLeft;
        target = 'timer';
        changed = true;
        break;

      case 'lap':
        if (w.startedAt != null && w.laps.length < MAX_LAPS) {
          w.laps.push(Math.min(elapsedOf(w, now), MAX_MS));
          target = 'stopwatch';
          changed = true;
        }
        break;

      case 'title':
        value = cleanText(cmd.text, MAX_TITLE);
        if (value !== next.title) {
          next.title = value;
          changed = true;
        }
        break;

      case 'message':
        value = cleanText(cmd.text, MAX_MESSAGE);
        if (value === '' && next.message.text === '') break;
        // A new id on every send, so repeating a message flashes it again.
        next.message = { text: value, flash: value !== '' && cmd.flash === true, id: next.message.id + 1 };
        changed = true;
        break;

      case 'settings':
        ['warnAt', 'dangerAt'].forEach(function (key) {
          var v = roundSeconds(cmd[key]);
          if (v === null) return;
          v = clamp(v, 0, MAX_MS);
          if (v !== next.settings[key]) {
            next.settings[key] = v;
            changed = true;
          }
        });
        if (typeof cmd.overtime === 'boolean' && cmd.overtime !== next.settings.overtime) {
          next.settings.overtime = cmd.overtime;
          settleTimer(t, next.settings, now);
          changed = true;
        }
        break;
    }

    if (!changed) return state;
    next.rev = state.rev + 1;
    next.last = {
      type: cmd.type,
      target: target,
      ms: ms,
      by: by ? { id: cleanText(by.id, 64), name: cleanText(by.name, MAX_NAME) } : null,
      at: now
    };
    return next;
  }

  // ------------------------------------------------------------------- views

  function thresholdHit(at, shownSeconds, duration) {
    return at > 0 && at < duration && shownSeconds * SECOND <= at;
  }

  /*
   * What a countdown looks like at server time `now`.
   *   shown   whole seconds on screen (rounded up, negative in overtime)
   *   phase   'normal' | 'warn' | 'danger' | 'over'  (colors follow the shown value)
   *   status  'idle' | 'running' | 'paused' | 'finished' (stopped at zero)
   */
  function timerView(state, now) {
    var t = state.timer;
    var s = state.settings;
    var running = t.startedAt != null;
    var elapsed = elapsedOf(t, now);
    if (!s.overtime && elapsed >= t.duration) {
      elapsed = t.duration;
      running = false;
    }
    var remaining = Math.max(t.duration - elapsed, -MAX_MS);
    var shown = Math.ceil(remaining / SECOND) || 0; // `|| 0` turns -0 into 0
    var finished = remaining <= 0;
    var phase = finished ? 'over'
      : thresholdHit(s.dangerAt, shown, t.duration) ? 'danger'
      : thresholdHit(s.warnAt, shown, t.duration) ? 'warn'
      : 'normal';
    var status = running ? 'running'
      : finished && !s.overtime ? 'finished'
      : elapsed > 0 ? 'paused'
      : 'idle';
    return {
      running: running,
      status: status,
      phase: phase,
      finished: finished,
      elapsed: elapsed,
      remaining: remaining,
      shown: shown,
      duration: t.duration,
      base: t.base,
      progress: t.duration > 0 ? clamp(remaining / t.duration, 0, 1) : 0
    };
  }

  function stopwatchView(state, now) {
    var w = state.stopwatch;
    var elapsed = Math.min(elapsedOf(w, now), MAX_MS);
    var running = w.startedAt != null && elapsed < MAX_MS;
    var lastLap = w.laps.length ? w.laps[w.laps.length - 1] : 0;
    return {
      running: running,
      status: running ? 'running' : elapsed > 0 ? 'paused' : 'idle',
      elapsed: elapsed,
      laps: w.laps,
      lapNumber: w.laps.length + 1,
      lapElapsed: Math.max(0, elapsed - lastLap)
    };
  }

  // -------------------------------------------------------------- formatting

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // "05:00", or "1:05:00" from one hour up. Takes whole seconds; the sign is ignored.
  function clockText(seconds) {
    seconds = Math.abs(Math.round(seconds));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor(seconds / 60) % 60;
    var s = seconds % 60;
    return (h ? h + ':' : '') + pad2(m) + ':' + pad2(s);
  }

  // Stopwatch digits: { main: "01:02", frac: "34" } (hundredths, rounded down).
  function stopwatchText(ms) {
    ms = Math.max(0, Math.floor(ms));
    return { main: clockText(Math.floor(ms / SECOND)), frac: pad2(Math.floor(ms / 10) % 100) };
  }

  // Short human label: "30 s", "5 min", "1 h 30 min", "2 min 30 s".
  function durationLabel(ms) {
    var total = Math.round(Math.abs(ms) / SECOND);
    var h = Math.floor(total / 3600);
    var m = Math.floor(total / 60) % 60;
    var s = total % 60;
    var parts = [];
    if (h) parts.push(h + ' h');
    if (m) parts.push(m + ' min');
    if (s || !parts.length) parts.push(s + ' s');
    return parts.join(' ');
  }

  return {
    SECOND: SECOND,
    MINUTE: MINUTE,
    MAX_MS: MAX_MS,
    MAX_LAPS: MAX_LAPS,
    MAX_TITLE: MAX_TITLE,
    MAX_MESSAGE: MAX_MESSAGE,
    MAX_NAME: MAX_NAME,
    initialState: initialState,
    normalize: normalize,
    apply: apply,
    timerView: timerView,
    stopwatchView: stopwatchView,
    clockText: clockText,
    stopwatchText: stopwatchText,
    durationLabel: durationLabel,
    cleanText: cleanText,
    pad2: pad2
  };
}));
