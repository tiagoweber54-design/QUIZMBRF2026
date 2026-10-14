/*
 * Cronômetro Sync — cloud mode (sync through Firebase Realtime Database).
 *
 * No server of our own: every device joins the same "room" in the database
 * and applies each command with a transaction, using the same TimerCore logic
 * the local server uses. Browser code, but the helpers also run in Node (tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.Cloud = factory(root.TimerCore);
}(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  // 32 characters without I, O, 0 and 1, so a code read aloud is hard to get wrong.
  var ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var ROOM_LENGTH = 8;
  var ROOM_PATTERN = /^[A-Z0-9]{8}$/; // keep in step with firebase-rules.json
  var DB_HOST_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}(\.[a-z0-9-]+)?\.(firebaseio\.com|firebasedatabase\.app)$/;
  var SDK_FILES = ['vendor/firebase-app-compat.js', 'vendor/firebase-database-compat.js'];
  var CONNECT_TIMEOUT = 15000;
  var appCounter = 0;

  // ---------------------------------------------------------------- helpers

  function randomBytes(n) {
    var bytes = new Uint8Array(n);
    var c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (c && c.getRandomValues) return c.getRandomValues(bytes);
    if (typeof require === 'function') {
      try { return new Uint8Array(require('crypto').randomBytes(n)); } catch (e) { /* fall through */ }
    }
    for (var i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
  }

  // A new unguessable room code: 8 characters, 32^8 (about 10^12) possibilities.
  function newRoom() {
    var bytes = randomBytes(ROOM_LENGTH);
    var out = '';
    for (var i = 0; i < ROOM_LENGTH; i++) out += ROOM_ALPHABET.charAt(bytes[i] & 31); // 256 is a multiple of 32: no bias
    return out;
  }

  // What a person typed → a valid code, or '' ("k7m2 q9xr" and "K7M2-Q9XR" are the same room).
  function cleanRoom(text) {
    var s = String(text == null ? '' : text).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return ROOM_PATTERN.test(s) ? s : '';
  }

  function formatRoom(code) {
    return code.length === ROOM_LENGTH ? code.slice(0, 4) + '-' + code.slice(4) : code;
  }

  // The address of the Realtime Database, as Firebase shows it, pasted any way.
  // → { host, url } or null. Only Firebase's own domains are accepted.
  function parseDbUrl(text) {
    if (typeof text !== 'string') return null;
    var s = text.trim().replace(/^["'<(]+|["'>)]+$/g, '').replace(/^https?:\/\//i, '');
    var host = s.split(/[\/?#\s]/)[0].toLowerCase();
    return DB_HOST_PATTERN.test(host) ? { host: host, url: 'https://' + host } : null;
  }

  // "#sala=K7M2Q9XR&db=meu-projeto-default-rtdb.firebaseio.com" → { room, db }
  function parseHash(hash) {
    var out = { room: '', db: '' };
    String(hash || '').replace(/^#/, '').split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i < 0) return;
      var value;
      try { value = decodeURIComponent(pair.slice(i + 1)); } catch (e) { return; }
      var key = pair.slice(0, i);
      if (key === 'sala') {
        out.room = cleanRoom(value);
      } else if (key === 'db') {
        var parsed = parseDbUrl(value);
        out.db = parsed ? parsed.host : '';
      }
    });
    return out;
  }

  function buildLink(base, room, dbHost) {
    return base + '#sala=' + room + (dbHost ? '&db=' + encodeURIComponent(dbHost) : '');
  }

  // The page's address without hash or file name: where the share link points.
  function pageBase(loc) {
    return loc.origin + loc.pathname.replace(/index\.html$/, '');
  }

  // ------------------------------------------------------------ SDK loading

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src;
      el.async = false;
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error('Não foi possível carregar ' + src)); };
      document.head.appendChild(el);
    });
  }

  // The Firebase SDK is 200 KB: only fetched when cloud mode is actually used.
  function loadSdk() {
    if (typeof window === 'undefined') return Promise.reject(new Error('Sem navegador'));
    if (window.firebase && window.firebase.database) return Promise.resolve(window.firebase);
    return SDK_FILES.reduce(function (chain, src) {
      return chain.then(function () { return loadScript(src); });
    }, Promise.resolve()).then(function () {
      if (!(window.firebase && window.firebase.database)) throw new Error('O Firebase não iniciou');
      return window.firebase;
    });
  }

  // ------------------------------------------------------------- connection

  function noop() {}

  function isPermissionError(err) {
    return !!err && (err.code === 'PERMISSION_DENIED' || /permission[_ ]denied/i.test(String(err.message || err)));
  }

  /*
   * One live connection to one room.
   *   opts.firebase   the Firebase compat namespace
   *   opts.db         database host ("projeto-default-rtdb.firebaseio.com")
   *   opts.emulator   "host:port" of the local emulator (tests only)
   *   opts.room       room code
   *   opts.client()   { id, name } of this device
   *   opts.now()      server time in ms, as this device estimates it
   *   opts.handlers   onStatus('connecting'|'online'|'offline'), onState(state, first),
   *                   onOffset(ms), onDevices(list), onError({ code: 'rules'|'timeout'|'error', error })
   */
  function Connection(opts) {
    var self = this;
    var fb = opts.firebase;
    this.opts = opts;
    this.h = opts.handlers || {};
    this.status = 'connecting';
    this.everOnline = false;
    this.connected = false;
    this.gotState = false;
    this.gotOffset = false;
    this.closed = false;

    this.app = fb.initializeApp({ databaseURL: 'https://' + opts.db }, 'sala-' + opts.room + '-' + (++appCounter));
    this.db = this.app.database();
    if (opts.emulator) {
      var parts = String(opts.emulator).split(':');
      this.db.useEmulator(parts[0], parseInt(parts[1], 10) || 9000);
    }
    var room = this.db.ref('salas/' + opts.room);
    this.stateRef = room.child('estado');
    this.devicesRef = room.child('aparelhos');
    this.meRef = this.devicesRef.child(opts.client().id);

    var fail = function (err) { self.fail(err); };

    this.db.ref('.info/serverTimeOffset').on('value', function (snap) {
      self.gotOffset = true;
      if (self.h.onOffset) self.h.onOffset(Number(snap.val()) || 0);
      self.refresh();
    });
    this.db.ref('.info/connected').on('value', function (snap) {
      self.connected = snap.val() === true;
      if (self.connected) self.announce();
      self.refresh();
    });
    this.stateRef.on('value', function (snap) {
      var first = !self.gotState;
      self.gotState = true;
      if (self.h.onState) self.h.onState(Core.normalize(snap.val()), first);
      self.refresh();
    }, fail);
    this.devicesRef.on('value', function (snap) {
      var list = [];
      snap.forEach(function (child) {
        var v = child.val() || {};
        list.push({
          id: child.key,
          name: typeof v.nome === 'string' ? v.nome : 'Aparelho',
          since: typeof v.desde === 'number' ? v.desde : 0
        });
      });
      list.sort(function (a, b) { return a.since - b.since; });
      if (self.h.onDevices) self.h.onDevices(list);
    }, noop); // the list is a nicety: the timer works without it

    this.timeout = setTimeout(function () {
      if (!self.closed && !self.everOnline) self.report('timeout', null);
    }, CONNECT_TIMEOUT);
  }

  Connection.prototype.report = function (code, error) {
    if (this.h.onError) this.h.onError({ code: code, error: error });
  };

  Connection.prototype.fail = function (err) {
    if (this.closed) return;
    this.report(isPermissionError(err) ? 'rules' : 'error', err);
  };

  // online = connected, with the room's state and the server clock in hand.
  Connection.prototype.refresh = function () {
    var ready = this.connected && this.gotState && this.gotOffset;
    if (ready) this.everOnline = true;
    var next = ready ? 'online' : this.everOnline ? 'offline' : 'connecting';
    if (next === this.status) return;
    this.status = next;
    if (this.h.onStatus) this.h.onStatus(next);
  };

  // Shows this device in the room's list for as long as it stays connected.
  // Redone after every reconnection: the server forgets the previous one.
  Connection.prototype.announce = function () {
    var me = this.opts.client();
    this.meRef.onDisconnect().remove().catch(noop);
    this.meRef.set({ nome: me.name, desde: this.opts.firebase.database.ServerValue.TIMESTAMP }).catch(noop);
  };

  // Applies a command to the shared state. Resolves { changed } once the server
  // has decided; commands that change nothing (pause when paused…) write nothing.
  Connection.prototype.send = function (cmd) {
    var self = this;
    return this.stateRef.transaction(function (current) {
      var base = Core.normalize(current);
      var next = Core.apply(base, cmd, self.opts.now(), self.opts.client());
      return next === base ? undefined : next;
    }, undefined, true).then(function (result) {
      return { changed: result.committed };
    });
  };

  Connection.prototype.rename = function (name) {
    if (!this.closed) this.meRef.update({ nome: name }).catch(noop);
  };

  // Back on screen: after a long time away the connection may be a zombie, so
  // start a fresh one (the SDK keeps its listeners and re-syncs by itself).
  Connection.prototype.wake = function (hiddenMs) {
    if (this.closed) return;
    if (!this.connected || hiddenMs > 8000) {
      this.db.goOffline();
      this.db.goOnline();
    }
  };

  Connection.prototype.leave = function () {
    var self = this;
    if (this.closed) return Promise.resolve();
    this.closed = true;
    clearTimeout(this.timeout);
    return this.meRef.remove().catch(noop).then(function () { return self.app.delete(); }).catch(noop);
  };

  function connect(opts) { return new Connection(opts); }

  return {
    ROOM_LENGTH: ROOM_LENGTH,
    newRoom: newRoom,
    cleanRoom: cleanRoom,
    formatRoom: formatRoom,
    parseDbUrl: parseDbUrl,
    parseHash: parseHash,
    buildLink: buildLink,
    pageBase: pageBase,
    loadSdk: loadSdk,
    connect: connect
  };
}));
