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
  var MAX_RESULTS = 200;
  var ID_PATTERN = /^[a-z0-9-]{1,24}$/; // keep in step with firebase-rules.json
  // What the operator can put on the big screen by hand (see apply 'screen').
  var SCREEN_PATTERN = /^(logo|timer|parodia(:[a-z0-9-]{1,24})?|rank:[a-z0-9-]{1,24})$/;
  var WARN_AT = 3 * MINUTE;   // the clock turns yellow
  var DANGER_AT = 30 * SECOND; // ...and red

  // Seminar rule: every FULL minute over the limit costs one point.
  var PENALTY_MS = 60 * SECOND;
  var PENALTY_POINTS = 1;
  var ALERT_SHOW_MS = 12 * SECOND; // how long an automatic message stays on screen

  function initialState() {
    return {
      v: 1,
      rev: 0,
      mode: 'timer', // what every screen shows: 'timer' | 'stopwatch'
      title: '',
      timer: { base: 5 * MINUTE, duration: 5 * MINUTE, elapsed: 0, startedAt: null },
      stopwatch: { elapsed: 0, startedAt: null, laps: [] },
      settings: { warnAt: WARN_AT, dangerAt: DANGER_AT, overtime: true },
      message: { text: '', flash: false, id: 0 },
      // Seminar: the presentation on the clock, what the big screen was told to show by
      // hand (screen; null = decide by itself, see screenOf), which automatic messages the
      // presentation already got (sent.half / sent.last) and what was registered for each one
      // (results[id] = { used, allowed, points, at, by }, all times in ms).
      agenda: { current: null, screen: null, sent: {}, results: {} },
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

  // A list, or the {"0": …, "1": …} object a database may hand back in its place.
  function listOf(v) {
    if (Array.isArray(v)) return v;
    if (!v || typeof v !== 'object') return [];
    return Object.keys(v)
      .filter(function (k) { return /^\d+$/.test(k); })
      .sort(function (a, b) { return a - b; })
      .map(function (k) { return v[k]; });
  }

  // Points lost for finishing `overMs` past the limit: 1 per full minute.
  function penaltyPoints(overMs) {
    return overMs > 0 ? Math.floor(overMs / PENALTY_MS) * PENALTY_POINTS : 0;
  }

  /*
   * What the big screen shows: { name, arg }
   *   logo     the company logo on white (nothing is going on)
   *   call     announcing the presentation that was picked, before its clock starts
   *   timer    the clock
   *   parodia  the video category (arg: id of the one playing, or '')
   *   rank     the results board (arg: category id, or 'all')
   * The operator can force one with the 'screen' command; otherwise it follows the clock.
   */
  function screenOf(state) {
    var a = state.agenda || {};
    var t = state.timer;
    if (a.screen) {
      var i = a.screen.indexOf(':');
      var name = i < 0 ? a.screen : a.screen.slice(0, i);
      return { name: name, arg: i < 0 ? '' : a.screen.slice(i + 1) };
    }
    var going = t.startedAt != null || t.elapsed > 0;
    if (a.current) return { name: going ? 'timer' : 'call', arg: a.current };
    return { name: going || state.mode === 'stopwatch' ? 'timer' : 'logo', arg: '' };
  }

  // The current presentation was stopped and its time registered (and not touched since).
  function isRegistered(state) {
    var a = state.agenda;
    var r = a && a.current ? a.results[a.current] : null;
    return !!r && state.timer.startedAt == null && state.timer.elapsed === r.used;
  }

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
    s.stopwatch.laps = listOf(w.laps)
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
    if (isTime(m.until) && s.message.text !== '') s.message.until = Math.round(m.until); // automatic messages fade out

    var ag = raw.agenda && typeof raw.agenda === 'object' ? raw.agenda : {};
    s.agenda.current = typeof ag.current === 'string' && ID_PATTERN.test(ag.current) ? ag.current : null;
    s.agenda.screen = typeof ag.screen === 'string' && SCREEN_PATTERN.test(ag.screen) ? ag.screen : null;
    if (ag.sent && typeof ag.sent === 'object') {
      if (ag.sent.half === true) s.agenda.sent.half = true;
      if (ag.sent.last === true) s.agenda.sent.last = true;
    }
    var res = ag.results && typeof ag.results === 'object' ? ag.results : {};
    Object.keys(res).slice(0, MAX_RESULTS).forEach(function (id) {
      var r = res[id];
      if (!ID_PATTERN.test(id) || !r || typeof r !== 'object' || !isNum(r.used) || !isNum(r.allowed)) return;
      s.agenda.results[id] = {
        used: int(r.used, 0, MAX_MS * 4, 0),
        allowed: int(r.allowed, 0, MAX_MS * 4, 0),
        points: int(r.points, 0, 9999, 0),
        at: isTime(r.at) ? Math.round(r.at) : 0,
        by: cleanText(r.by, MAX_NAME)
      };
    });

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
   *   { type: 'select', id, ms, force? } seminar: put a presentation on the clock (ms = its limit)
   *   { type: 'finish' }                 seminar: stop it and register the time used and the points lost
   *   { type: 'screen', name }          seminar: what the big screen shows: 'logo', 'timer', 'parodia', 'parodia:<id>',
   *                                      'rank:<category|all>', or '' to let it follow the presentation (see screenOf)
   *   { type: 'alert', kind, text }      seminar: automatic message at half time ('half') and one minute left ('last');
   *                                      accepted once per presentation, only at the right moment
   *   { type: 'clearResult', id }        seminar: forget a registered time ('*' = all of them)
   */
  function apply(state, cmd, now, by) {
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') return state;
    var next = clone(state);
    if (!next.agenda) next.agenda = { current: null, screen: null, sent: {}, results: {} };
    if (!next.agenda.sent) next.agenda.sent = {};
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
          if (!next.agenda.current) next.agenda.screen = 'timer'; // a free clock is meant to be seen
          changed = true;
        }
        target = next.mode;
        break;

      case 'start':
        if (target === 'timer' && isRegistered(next)) break; // registered: redo it with Zerar
        if (clock.startedAt == null) {
          // A countdown stopped at zero cannot resume; it needs 'restart'.
          var canRun = target === 'timer'
            ? t.elapsed < t.duration || next.settings.overtime
            : w.elapsed < MAX_MS;
          if (canRun) {
            clock.startedAt = now;
            next.agenda.screen = null; // starting brings the clock to the big screen
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
            next.agenda.sent = {};
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
        if (target === 'timer') {
          t.duration = t.base;
          next.agenda.sent = {};
        }
        else w.laps = [];
        clock.elapsed = 0;
        clock.startedAt = now;
        next.agenda.screen = null;
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
        next.agenda.current = null; // a free countdown is no presentation
        next.agenda.sent = {};
        next.agenda.screen = 'timer'; // ...but whoever sets it wants to see it
        target = 'timer';
        changed = true;
        break;

      case 'adjust':
        if (isRegistered(next)) break;
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
        if (!next.agenda.current) next.agenda.screen = 'timer';
        target = 'timer';
        changed = true;
        break;

      case 'select':
        value = typeof cmd.id === 'string' && ID_PATTERN.test(cmd.id) ? cmd.id : '';
        ms = roundSeconds(cmd.ms);
        if (!value || ms === null) { ms = null; break; }
        ms = clamp(ms, SECOND, MAX_MS);
        // A presentation under way is never replaced by accident.
        if (next.agenda.current && !isRegistered(next) && (t.startedAt != null || t.elapsed > 0) && cmd.force !== true) break;
        next.agenda.current = value;
        next.agenda.sent = {};
        next.agenda.screen = null; // the big screen announces the presentation until the clock starts
        next.mode = 'timer';
        next.settings.overtime = true; // the time over the limit is what costs points
        next.settings.warnAt = WARN_AT;
        next.settings.dangerAt = DANGER_AT;
        t.base = ms;
        t.duration = ms;
        t.elapsed = 0;
        t.startedAt = null;
        target = 'timer';
        changed = true;
        break;

      case 'finish':
        if (!next.agenda.current || isRegistered(next)) break;
        var used = Math.min(elapsedOf(t, now), MAX_MS);
        if (used < SECOND) break; // nothing was timed
        if (!next.agenda.results[next.agenda.current] && Object.keys(next.agenda.results).length >= MAX_RESULTS) break;
        t.elapsed = used;
        t.startedAt = null;
        next.agenda.results[next.agenda.current] = {
          used: used,
          allowed: t.duration,
          points: penaltyPoints(used - t.duration),
          at: now,
          by: by ? cleanText(by.name, MAX_NAME) : ''
        };
        ms = used;
        target = 'timer';
        changed = true;
        break;

      case 'clearResult':
        if (cmd.id === '*') {
          if (!Object.keys(next.agenda.results).length) break;
          next.agenda.results = {};
          changed = true;
        } else if (typeof cmd.id === 'string' && next.agenda.results[cmd.id]) {
          delete next.agenda.results[cmd.id];
          changed = true;
        }
        target = 'timer';
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

      case 'screen':
        value = typeof cmd.name === 'string' && (cmd.name === '' || SCREEN_PATTERN.test(cmd.name)) ? cmd.name : null;
        if (value === null) break;
        if ((value || null) !== next.agenda.screen) {
          next.agenda.screen = value || null;
          changed = true;
        }
        target = 'timer';
        break;

      case 'alert':
        if ((cmd.kind !== 'half' && cmd.kind !== 'last') || !next.agenda.current || t.startedAt == null || isRegistered(next)) break;
        if (next.agenda.sent[cmd.kind]) break; // every device sees the moment arrive; only the first one counts
        var timeLeft = t.duration - elapsedOf(t, now);
        if (cmd.kind === 'half') {
          // not for short slots (the minute warning is enough) and not once it is too late for it
          if (t.duration <= 2 * MINUTE || timeLeft > t.duration / 2 + SECOND || timeLeft <= MINUTE) break;
        } else if (timeLeft > MINUTE + SECOND || timeLeft <= 0) {
          break;
        }
        value = cleanText(cmd.text, MAX_MESSAGE);
        if (!value) break;
        next.agenda.sent[cmd.kind] = true;
        next.message = { text: value, flash: true, id: next.message.id + 1, until: now + ALERT_SHOW_MS };
        target = 'timer';
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
        if (typeof cmd.overtime === 'boolean' && cmd.overtime !== next.settings.overtime &&
            !(cmd.overtime === false && next.agenda.current && !isRegistered(next))) {
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
    PENALTY_MS: PENALTY_MS,
    ALERT_SHOW_MS: ALERT_SHOW_MS,
    ID_PATTERN: ID_PATTERN,
    penaltyPoints: penaltyPoints,
    isRegistered: isRegistered,
    screenOf: screenOf,
    SCREEN_PATTERN: SCREEN_PATTERN,
    WARN_AT: WARN_AT,
    DANGER_AT: DANGER_AT,
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
