/*
 * Cronômetro Sync — browser app (iPad, iPhone, PC).
 *
 * When the page is served by server.js it stays in sync with every other
 * device: changes arrive over Server-Sent Events and commands go out with
 * POST. Opened from a file or a static host, it works on its own device.
 */
(function () {
  'use strict';

  var Core = window.TimerCore;
  var Cloud = window.Cloud; // cloud.js: missing only if that file failed to load
  var SECOND = Core.SECOND;
  var MINUTE = Core.MINUTE;

  var PRESET_MINUTES = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60];
  var QUICK_MESSAGES = ['Faltam 5 minutos', 'Faltam 2 minutos', 'Conclua, por favor', 'Hora das perguntas', 'Fale mais alto', 'Mais devagar'];
  var THRESHOLD_SECONDS = [0, 5, 10, 15, 20, 30, 60, 120, 180, 300, 600, 900];
  var PREFS_KEY = 'cronometro-sync.prefs';
  var LOCAL_STATE_KEY = 'cronometro-sync.state';
  var ROOM_KEY = 'cronometro-sync.sala';
  var DB_KEY = 'cronometro-sync.db';
  var LOCAL_CHOICE_KEY = 'cronometro-sync.so-local';
  var PREF_DEFAULTS = { sound: true, clock: true, awake: true, display: false, name: '', view: 'apres', cat: 'todas' };

  // ------------------------------------------------------------- helpers

  function $(id) { return document.getElementById(id); }

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function setClass(node, cls, on) {
    if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
  }

  function readStorage(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeStorage(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* private mode or full: not essential */ }
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function randomId() {
    var bytes = new Uint8Array(8);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(bytes, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }

  function hhmm(date) { return Core.pad2(date.getHours()) + ':' + Core.pad2(date.getMinutes()); }

  function lapText(ms) {
    var t = Core.stopwatchText(ms);
    return t.main + ',' + t.frac;
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function guessDeviceName() {
    var ua = navigator.userAgent;
    var device = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
      : /iPhone|iPod/.test(ua) ? 'iPhone'
      : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Celular Android' : 'Tablet Android')
      : /Windows/.test(ua) ? 'PC Windows'
      : /CrOS/.test(ua) ? 'Chromebook'
      : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
      : /Linux/.test(ua) ? 'Linux'
      : 'Aparelho';
    var browser = /Edg\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera'
      : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
      : /CriOS|Chrome\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) ? 'Safari'
      : '';
    return browser ? device + ' · ' + browser : device;
  }

  // ------------------------------------------------------------ elements

  var el = {};
  [
    'app', 'statusBtn', 'statusText', 'soundBtn', 'connectBtn', 'settingsBtn', 'fullscreenBtn', 'displayBtn',
    'display', 'clock', 'exitDisplayBtn', 'banner', 'bannerText', 'bannerClose', 'title', 'digitsWrap', 'digits', 'sign',
    'main', 'frac', 'progressBar', 'sub', 'resetBtn', 'lapBtn', 'mainBtn', 'mainLabel', 'presets', 'customForm',
    'inH', 'inM', 'inS', 'laps', 'lapsEmpty', 'messageForm', 'messageInput', 'quickMessages', 'flashInput',
    'clearMessageBtn', 'titleForm', 'titleInput', 'connectModal', 'connectServer', 'shareUrl', 'copyBtn', 'qr',
    'otherUrls', 'connectLocal', 'deviceCount', 'devices', 'settingsModal', 'warnSel', 'dangerSel', 'overtimeChk',
    'soundChk', 'testSoundBtn', 'clockChk', 'awakeChk', 'awakeNote', 'nameInput', 'versionText', 'toast',
    'connectIntro', 'cloudExtras', 'roomCode', 'cloudProblem', 'changeRoomBtn', 'setupCloud', 'setupCloudBtn',
    'roomModal', 'roomClose', 'dbBlock', 'dbInput', 'roomCreateBtn', 'roomJoinForm', 'roomInput', 'roomError', 'roomLocalBtn',
    'agendaHead', 'agCat', 'agName', 'agLead', 'tabs', 'doneCount', 'nowEmpty', 'nowInfo', 'nowCat', 'nowLimit', 'nowName',
    'nowLead', 'agMainBtn', 'agMainLabel', 'agStopBtn', 'agResetBtn', 'nowResult', 'agUndoBtn', 'agNextBtn', 'agFilter',
    'agList', 'resFilter', 'resSummary', 'resList', 'copyResultsBtn', 'csvBtn', 'clearResultsBtn'
  ].forEach(function (id) { el[id] = $(id); });
  var app = el.app;
  var segButtons = Array.prototype.slice.call(document.querySelectorAll('.seg'));
  var modals = [el.connectModal, el.settingsModal, el.roomModal];

  // ------------------------------------------------------------ identity

  var clientId = randomId(); // one per open page, so duplicated tabs never collide
  var prefs = loadPrefs();

  function loadPrefs() {
    var saved = parseJson(readStorage(PREFS_KEY)) || {};
    var out = {};
    Object.keys(PREF_DEFAULTS).forEach(function (k) {
      out[k] = typeof saved[k] === typeof PREF_DEFAULTS[k] ? saved[k] : PREF_DEFAULTS[k];
    });
    if (/[?&](exibir|exibicao|display|tela)\b/i.test(location.search)) out.display = true;
    return out;
  }

  function savePrefs() { writeStorage(PREFS_KEY, JSON.stringify(prefs)); }

  function deviceName() { return Core.cleanText(prefs.name, Core.MAX_NAME) || guessDeviceName(); }

  function me() { return { id: clientId, name: deviceName() }; }

  // --------------------------------------------------------------- state

  var state = Core.initialState();
  var link = null;              // ServerLink or LocalLink
  var conn = 'connecting';      // 'connecting' | 'online' | 'offline' | 'local'
  var clockOffset = 0;          // server time ≈ Date.now() + clockOffset
  var clockSynced = false;
  var latest = null;            // newest state from the server: { state, instance }
  var pending = 0;              // commands sent and not answered yet
  var serverInfo = null;
  var devices = [];
  var shownMessageId = null;
  var cloudMode = false;        // syncing through Firebase (no server of ours)
  var cloud = { db: '', room: '', configHost: '', problem: '' };
  var roomRequired = false;     // the room dialog cannot be dismissed yet
  var lastAnnounced = '';       // so a change by someone else is announced once
  var hiddenAt = 0;             // when the page went to the background

  function serverNow() { return Date.now() + clockOffset; }

  /*
   * Takes a state from the server: a snapshot (on every connection), a
   * broadcast, or the reply to one of our commands. Snapshots always win;
   * otherwise only newer states count. While our own commands are still on
   * their way, the screen keeps showing their predicted result and catches up
   * with the server once the last reply is in, so quick taps never flicker.
   */
  function receive(data, meta) {
    if (!data || !data.state) return;
    meta = meta || {};
    var incoming = Core.normalize(data.state);
    if (latest && data.instance === latest.instance && !meta.snapshot) {
      var known = latest.state.rev;
      if (incoming.rev < known || (incoming.rev === known && !meta.reply)) return;
    }
    if (meta.snapshot && !clockSynced && typeof data.serverTime === 'number') clockOffset = data.serverTime - Date.now();
    latest = { state: incoming, instance: data.instance };
    if (!meta.snapshot && !meta.reply) announce(incoming.last);
    if (pending && !meta.snapshot) return;
    show(incoming, meta);
  }

  function show(next, meta) {
    state = next;
    renderState(meta);
    kick();
  }

  // The cloud database already orders and merges changes (and shows ours at
  // once), so every state it reports is shown as it comes.
  function liveState(next, first) {
    latest = { state: next, instance: 'cloud' };
    var last = next.last;
    var key = last ? [last.at, last.type, last.by && last.by.id].join('|') : '';
    if (!first && key !== lastAnnounced) announce(last);
    lastAnnounced = key;
    show(next, { snapshot: first });
  }

  function dispatch(cmd) {
    if (!link) {
      toast('Conectando… tente de novo em instantes.', 'warn');
      return;
    }
    if (conn !== 'online' && conn !== 'local') {
      toast('Sem conexão — tentando reconectar…', 'warn');
      return;
    }
    if (link.optimistic) {
      // Show the result at once; the server's reply confirms or corrects it.
      var next = Core.apply(state, cmd, serverNow(), me());
      if (next !== state) show(next, {});
    }
    pending++;
    link.send(cmd).catch(function () {
      toast('Não foi possível enviar o comando. Verifique a conexão.', 'error');
      if (link.resync) link.resync();
    }).then(function () {
      pending--;
      // Settle on what the server says (this also undoes a command that failed).
      if (!pending && latest && state !== latest.state) show(latest.state, {});
    });
  }

  // ---------------------------------------------------------- server link

  function ServerLink() {
    var self = this;
    this.optimistic = true;
    this.es = null;
    this.lastEvent = 0;
    this.retryTimer = null;
    this.retryDelay = 2000;
    this.syncTimer = null;
    setInterval(function () { self.watchdog(); }, 4000);
  }

  ServerLink.prototype.open = function () {
    var self = this;
    this.close();
    this.lastEvent = Date.now();
    var url = 'api/events?id=' + encodeURIComponent(clientId) + '&name=' + encodeURIComponent(deviceName());
    var es;
    try {
      es = new EventSource(url);
    } catch (e) {
      this.retryLater();
      return;
    }
    this.es = es;
    es.addEventListener('state', function (e) {
      if (self.es !== es) return;
      self.lastEvent = Date.now();
      var data = parseJson(e.data);
      if (!data) return;
      if (data.snapshot) {
        self.retryDelay = 2000;
        setConnection('online');
        self.syncClock();
      }
      receive(data, { snapshot: !!data.snapshot });
    });
    es.addEventListener('clients', function (e) {
      if (self.es !== es) return;
      self.lastEvent = Date.now();
      var data = parseJson(e.data);
      if (data && Array.isArray(data.clients)) setDevices(data.clients);
    });
    es.addEventListener('ping', function () {
      if (self.es === es) self.lastEvent = Date.now();
    });
    es.onerror = function () {
      if (self.es !== es) return;
      setConnection('offline');
      // CLOSED means the browser gave up (e.g. an error page); retry ourselves.
      if (es.readyState === 2) self.retryLater();
    };
  };

  ServerLink.prototype.close = function () {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.es) {
      this.es.close();
      this.es = null;
    }
  };

  ServerLink.prototype.retryLater = function () {
    var self = this;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(function () { self.open(); }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 15000);
  };

  // Mobile browsers silently drop connections in the background; the server
  // pings every 10 s, so a quiet stream means it is gone.
  ServerLink.prototype.watchdog = function () {
    if (this.retryTimer) return;
    var quiet = Date.now() - this.lastEvent;
    if (quiet > (conn === 'online' ? 25000 : 12000)) {
      setConnection('offline');
      this.open();
    }
  };

  ServerLink.prototype.wake = function () {
    var stale = Date.now() - this.lastEvent > 12000;
    if (!this.es || this.es.readyState !== 1 || stale) this.open();
    else this.syncClock();
  };

  // NTP-style: of a few round trips, trust the fastest one.
  ServerLink.prototype.syncClock = function () {
    var self = this;
    var best = null;
    clearTimeout(this.syncTimer);
    function sample() {
      var t0 = Date.now();
      return fetch('api/time?_=' + t0, { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var t1 = Date.now();
          if (typeof d.t === 'number' && (!best || t1 - t0 < best.rtt)) best = { rtt: t1 - t0, offset: d.t - (t0 + t1) / 2 };
        });
    }
    var chain = Promise.resolve();
    for (var i = 0; i < 5; i++) chain = chain.then(sample);
    chain.catch(function () {}).then(function () {
      if (best) {
        clockOffset = Math.round(best.offset);
        clockSynced = true;
        kick();
      }
      self.syncTimer = setTimeout(function () { self.syncClock(); }, 60000);
    });
  };

  ServerLink.prototype.send = function (cmd) {
    return fetch('api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: cmd, client: me() }),
      cache: 'no-store'
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      receive(data, { reply: true });
    });
  };

  ServerLink.prototype.resync = function () {
    fetch('api/state', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) { receive(data, { snapshot: true }); })
      .catch(function () {});
  };

  // ----------------------------------------------------------- local link

  // No server: keeps the state in this browser and mirrors it across its tabs.
  function LocalLink() {
    this.optimistic = false;
    this.channel = null;
    var saved = parseJson(readStorage(LOCAL_STATE_KEY));
    receive({ state: saved || Core.initialState(), instance: 'local' }, { snapshot: true });
    if (window.BroadcastChannel) {
      this.channel = new BroadcastChannel('cronometro-sync');
      this.channel.onmessage = function (e) { receive(e.data, {}); };
    } else {
      window.addEventListener('storage', function (e) {
        if (e.key === LOCAL_STATE_KEY && e.newValue) receive({ state: parseJson(e.newValue), instance: 'local' }, {});
      });
    }
    setConnection('local');
    setDevices([{ id: clientId, name: deviceName(), since: Date.now() }]);
  }

  LocalLink.prototype.send = function (cmd) {
    var current = latest ? latest.state : state;
    var next = Core.apply(current, cmd, Date.now(), me());
    if (next !== current) {
      var data = { state: next, instance: 'local' };
      writeStorage(LOCAL_STATE_KEY, JSON.stringify(next));
      if (this.channel) this.channel.postMessage(data);
      receive(data, { reply: true });
    }
    return Promise.resolve();
  };

  function startServerLink(info) {
    serverInfo = info;
    setText(el.versionText, 'v' + info.version);
    link = new ServerLink();
    link.open();
  }

  function startLocalLink() {
    if (link) return;
    setText(el.versionText, '(sem servidor)');
    link = new LocalLink();
  }

  // ----------------------------------------------------------- cloud link

  // Sync through the Firebase Realtime Database: nothing to install anywhere,
  // the SDK keeps the data and the connection alive.
  function CloudLink(db, room) {
    this.optimistic = false; // the SDK shows our own changes at once
    this.closed = false;
    this.connection = null;
    this.db = db;
    this.room = room;
  }

  CloudLink.prototype.open = function () {
    var self = this;
    this.connection = Cloud.connect({
      firebase: window.firebase,
      db: this.db,
      emulator: (window.CRONOMETRO_FIREBASE || {}).emulator,
      room: this.room,
      client: me,
      now: serverNow,
      handlers: {
        onStatus: function (status) { if (!self.closed) setConnection(status); },
        onOffset: function (ms) {
          if (self.closed) return;
          clockOffset = ms;
          clockSynced = true;
          kick();
        },
        onState: function (next, first) { if (!self.closed) liveState(next, first); },
        onDevices: function (list) { if (!self.closed) setDevices(list); },
        onError: function (err) { if (!self.closed) cloudError(err); }
      }
    });
  };

  CloudLink.prototype.send = function (cmd) {
    return this.connection ? this.connection.send(cmd) : Promise.reject(new Error('sem conexão'));
  };

  CloudLink.prototype.rename = function () {
    if (this.connection) this.connection.rename(deviceName());
  };

  CloudLink.prototype.wake = function () {
    if (this.connection) this.connection.wake(hiddenAt ? Date.now() - hiddenAt : 0);
  };

  CloudLink.prototype.leave = function () {
    var connection = this.connection;
    this.closed = true;
    this.connection = null;
    return connection ? connection.leave() : Promise.resolve();
  };

  var CLOUD_PROBLEMS = {
    rules: ['O Firebase recusou: confira as regras de segurança.',
      'As regras de segurança do Firebase não permitem este uso. Cole as regras do LEIA-ME na aba Regras do Realtime Database e clique em Publicar.'],
    timeout: ['Não consegui conectar ao Firebase.',
      'Não consegui conectar ao Firebase. Confira a internet e o endereço do banco de dados; a rede pode estar bloqueando o serviço.'],
    sdk: ['Não consegui carregar o Firebase.',
      'Não consegui carregar os arquivos do Firebase. Confira a internet; o programa tenta de novo sozinho.'],
    error: ['Erro na conexão com o Firebase.',
      'Houve um erro na conexão com o Firebase. Use "Testar a conexão" para ver o motivo.']
  };

  function cloudError(err) {
    var texts = CLOUD_PROBLEMS[err.code] || CLOUD_PROBLEMS.error;
    cloud.problem = texts[1];
    toast(texts[0], 'error');
    if (!el.connectModal.hidden) renderConnect();
  }

  // The database and room to use: the link that was opened wins, then this
  // site's firebase-config.js, then whatever this device remembers.
  function loadCloudSettings() {
    var fromConfig = Cloud.parseDbUrl((window.CRONOMETRO_FIREBASE || {}).databaseURL || '');
    var fromLink = Cloud.parseHash(location.hash);
    cloud.configHost = fromConfig ? fromConfig.host : '';
    cloud.db = fromLink.db || cloud.configHost || readStorage(DB_KEY) || '';
    cloud.room = fromLink.room || readStorage(ROOM_KEY) || '';
    if (fromLink.db && fromLink.db !== cloud.configHost) writeStorage(DB_KEY, fromLink.db);
    if (fromLink.room) writeStorage(ROOM_KEY, fromLink.room);
    return fromLink;
  }

  function startCloudMode() {
    if (link) return;
    if (!window.Cloud) return startLocalLink();
    cloudMode = true;
    var fromLink = loadCloudSettings();
    if (!fromLink.room && readStorage(LOCAL_CHOICE_KEY) === '1') {
      cloudMode = false;
      return startLocalLink();
    }
    setText(el.versionText, '(nuvem)');
    if (cloud.db && cloud.room) connectCloud();
    else openRoomDialog(true);
  }

  function connectCloud() {
    cloudMode = true;
    setConnection('connecting');
    keepRoomInAddress();
    Cloud.loadSdk().then(function () {
      if (link) return;
      link = new CloudLink(cloud.db, cloud.room);
      link.open();
    }, function () {
      cloudError({ code: 'sdk' });
      setConnection('offline');
      setTimeout(function () { if (!link) connectCloud(); }, 8000);
    });
  }

  // The address bar always holds the link to this room, ready to copy.
  function keepRoomInAddress() {
    try {
      window.history.replaceState(null, '', location.pathname + location.search + shareHash());
    } catch (e) { /* not essential */ }
  }

  function shareHash() {
    return Cloud.buildLink('', cloud.room, cloud.db === cloud.configHost ? '' : cloud.db);
  }

  function shareLink() { return Cloud.pageBase(location) + shareHash(); }

  function resetRoomState() {
    state = Core.initialState();
    latest = null;
    devices = [];
    shownMessageId = null;
    lastAnnounced = '';
    cloud.problem = '';
    renderState({ snapshot: true });
    renderStatus();
    kick();
  }

  // ------------------------------------------------------------ room dialog

  function openRoomDialog(required) {
    roomRequired = !!required;
    el.roomClose.hidden = roomRequired;
    el.dbBlock.hidden = !!cloud.db;
    el.dbInput.value = '';
    el.roomInput.value = cloud.room && !link ? Cloud.formatRoom(cloud.room) : '';
    showRoomError('');
    if (!link) setConnection('setup');
    openModal(el.roomModal);
    var field = cloud.db ? el.roomInput : el.dbInput;
    if (!/iPad|iPhone|iPod/.test(navigator.userAgent)) field.focus();
  }

  function showRoomError(message) {
    el.roomError.hidden = !message;
    el.roomError.textContent = message || '';
  }

  function dbHelp(text) {
    if (/console\.firebase\.google\.com/i.test(text)) {
      return 'Esse é o endereço do console do Firebase. Copie o endereço do banco: na aba Dados do Realtime Database ele aparece no alto e termina em firebaseio.com ou firebasedatabase.app.';
    }
    return 'Endereço inválido. Ele aparece no alto da aba Dados do Realtime Database e termina em firebaseio.com ou firebasedatabase.app.';
  }

  function chooseRoom(room) {
    var db = cloud.db;
    if (!db) {
      var parsed = Cloud.parseDbUrl(el.dbInput.value);
      if (!parsed) {
        showRoomError(dbHelp(el.dbInput.value));
        el.dbInput.focus();
        return;
      }
      db = parsed.host;
    }
    var old = link;
    link = null;
    if (old && old.leave) old.leave();
    cloudMode = true;
    cloud.db = db;
    cloud.room = room;
    writeStorage(ROOM_KEY, room);
    writeStorage(LOCAL_CHOICE_KEY, '');
    if (db !== cloud.configHost) writeStorage(DB_KEY, db);
    resetRoomState();
    roomRequired = false;
    closeModals();
    setText(el.versionText, '(nuvem)');
    connectCloud();
  }

  function useOnlyThisDevice() {
    writeStorage(LOCAL_CHOICE_KEY, '1');
    roomRequired = false;
    closeModals();
    cloudMode = false;
    startLocalLink();
  }

  function detectServer(attempt) {
    if (location.protocol === 'file:') return startLocalLink();
    fetch('api/info', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (text) {
        // Hosts that answer every address with the page itself send HTML here: not ours.
        var info = parseJson(text);
        if (info && info.app === 'cronometro-sync') startServerLink(info);
        else startCloudMode();
      }, function () {
        // No answer at all: a hiccup, or a plain web host. Try again, then go on without our server.
        if (attempt < 2) setTimeout(function () { detectServer(attempt + 1); }, 1500);
        else startCloudMode();
      });
  }

  // ----------------------------------------------------------- rendering

  function setConnection(value) {
    if (conn === value) return;
    conn = value;
    renderStatus();
  }

  function setDevices(list) {
    devices = list;
    renderStatus();
    if (!el.connectModal.hidden) renderDevices();
  }

  function renderStatus() {
    app.setAttribute('data-conn', conn);
    var n = Math.max(devices.length, 1);
    var text = conn === 'online' ? (n === 1 ? '1 aparelho' : n + ' aparelhos')
      : conn === 'offline' ? 'Reconectando…'
      : conn === 'local' ? 'Sem servidor'
      : conn === 'setup' ? 'Configurar'
      : 'Conectando…';
    setText(el.statusText, text);
    el.statusBtn.title = conn === 'online' ? 'Sincronizado — toque para ver os aparelhos'
      : conn === 'offline' ? 'Sem conexão; tentando de novo'
      : conn === 'local' ? 'Funcionando só neste aparelho'
      : conn === 'setup' ? 'Toque para escolher a sala'
      : '';
  }

  function renderState(meta) {
    var s = state;
    setClass(app, 'mode-timer', s.mode === 'timer');
    setClass(app, 'mode-stopwatch', s.mode === 'stopwatch');
    segButtons.forEach(function (b) { setClass(b, 'active', b.getAttribute('data-mode') === s.mode); });

    Array.prototype.forEach.call(el.presets.children, function (b) {
      setClass(b, 'active', Number(b.getAttribute('data-ms')) === s.timer.base);
    });
    var base = Math.round(s.timer.base / SECOND);
    el.inH.placeholder = String(Math.floor(base / 3600));
    el.inM.placeholder = String(Math.floor(base / 60) % 60);
    el.inS.placeholder = String(base % 60);

    el.title.hidden = !s.title;
    setText(el.title, s.title);
    if (document.activeElement !== el.titleInput) el.titleInput.value = s.title;

    renderMessage(meta || {});
    renderLaps();
    renderAgenda();

    syncSelect(el.warnSel, s.settings.warnAt);
    syncSelect(el.dangerSel, s.settings.dangerAt);
    el.overtimeChk.checked = s.settings.overtime;
    needFit = true;
  }

  function renderMessage(meta) {
    var m = state.message;
    el.banner.hidden = !m.text;
    setText(el.bannerText, m.text);
    el.clearMessageBtn.disabled = !m.text;
    var isNew = shownMessageId !== null && m.id !== shownMessageId && !meta.snapshot;
    shownMessageId = m.id;
    if (!isNew) return;
    el.banner.classList.remove('flash');
    if (m.text && m.flash) {
      void el.banner.offsetWidth; // restart the animation
      el.banner.classList.add('flash');
    }
  }

  var lapsKey = null;
  var currentLap = null;

  function renderLaps() {
    var laps = state.stopwatch.laps;
    var key = laps.join(',');
    if (key === lapsKey) return;
    lapsKey = key;
    el.laps.textContent = '';
    el.lapsEmpty.hidden = laps.length > 0;
    currentLap = null;
    if (!laps.length) return;

    var splits = laps.map(function (total, i) { return total - (i ? laps[i - 1] : 0); });
    var best = Math.min.apply(null, splits);
    var worst = Math.max.apply(null, splits);

    currentLap = lapRow('Volta ' + (laps.length + 1), '', '');
    currentLap.row.className = 'current';
    el.laps.appendChild(currentLap.row);
    for (var i = laps.length - 1; i >= 0; i--) {
      var r = lapRow('Volta ' + (i + 1), lapText(splits[i]), lapText(laps[i]));
      if (laps.length > 1 && best !== worst) {
        if (splits[i] === best) r.row.className = 'best';
        else if (splits[i] === worst) r.row.className = 'worst';
      }
      el.laps.appendChild(r.row);
    }
  }

  function lapRow(name, split, total) {
    var row = document.createElement('li');
    var a = document.createElement('span');
    var b = document.createElement('span');
    var c = document.createElement('span');
    b.className = 'lap-split';
    c.className = 'lap-total';
    a.textContent = name;
    b.textContent = split;
    c.textContent = total;
    row.appendChild(a);
    row.appendChild(b);
    row.appendChild(c);
    return { row: row, split: b, total: c };
  }

  function syncSelect(select, value) {
    var v = String(value);
    var found = Array.prototype.some.call(select.options, function (o) { return o.value === v; });
    if (!found) select.appendChild(new Option(value ? Core.durationLabel(value) : 'Desligado', v));
    if (select.value !== v) select.value = v;
  }

  // ------------------------------------------------------------ seminar

  var PLAN = window.PROGRAMACAO || null; // programacao.js: who presents, in what order, for how long
  var planItems = PLAN ? PLAN.itens : [];
  var planCats = {};
  var planById = {};
  if (PLAN) {
    PLAN.categorias.forEach(function (c) { planCats[c.id] = c; });
    planItems.forEach(function (i) { planById[i.id] = i; });
  }
  var lastCurrent = null;

  function itemMs(item) { return Math.round(item.min * MINUTE); }
  function mmss(ms) { return Core.clockText(Math.floor(ms / SECOND)); }
  function pointsText(n) { return n + (n === 1 ? ' ponto' : ' pontos'); }
  function resultOf(item) { return (state.agenda && state.agenda.results[item.id]) || null; }

  // The presentation on the clock, its registered result (if any) and whether it was stopped.
  function agendaNow() {
    var cur = state.agenda && state.agenda.current;
    var item = cur ? planById[cur] || null : null;
    return { item: item, result: item ? resultOf(item) : null, registered: !!item && Core.isRegistered(state) };
  }

  // pendente | andamento | ok | penalizada
  function itemStatus(item) {
    var a = state.agenda;
    var timing = state.timer.startedAt != null || state.timer.elapsed > 0;
    if (a.current === item.id && !Core.isRegistered(state) && timing) return 'andamento';
    var r = resultOf(item);
    if (r) return r.points > 0 ? 'penalizada' : 'ok';
    return 'pendente';
  }

  function visibleItems() {
    return prefs.cat === 'todas' ? planItems : planItems.filter(function (i) { return i.cat === prefs.cat; });
  }

  function catBadge(node, cat) {
    node.textContent = cat ? cat.nome : '';
    node.style.setProperty('--c', cat ? cat.cor : '');
  }

  function nextItem() {
    var cur = state.agenda.current;
    var start = cur ? planItems.findIndex(function (i) { return i.id === cur; }) + 1 : 0;
    for (var k = 0; k < planItems.length; k++) {
      var item = planItems[(start + k) % planItems.length];
      if (!resultOf(item) && item.id !== cur) return item;
    }
    return null;
  }

  function renderAgenda() {
    if (!PLAN) return;
    var a = agendaNow();
    // big screen
    el.agendaHead.hidden = !a.item;
    if (a.item) {
      catBadge(el.agCat, planCats[a.item.cat]);
      setText(el.agName, a.item.nome);
      setText(el.agLead, a.item.lider);
    }
    el.title.hidden = !state.title || !!a.item;
    setClass(app, 'is-registered', a.registered);
    setClass(app, 'has-penalty', a.registered && a.result.points > 0);
    renderFilters();
    renderNowPanel(a);
    renderAgendaList();
    renderResults();
  }

  function filterChip(id, label, items, cat) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (prefs.cat === id ? ' active' : '');
    b.setAttribute('data-cat', id);
    if (cat) {
      var dot = document.createElement('span');
      dot.className = 'dot-c';
      dot.style.setProperty('--c', cat.cor);
      b.appendChild(dot);
    }
    b.appendChild(document.createTextNode(label));
    var done = items.filter(function (i) { return resultOf(i); }).length;
    var small = document.createElement('small');
    small.textContent = done + '/' + items.length;
    b.appendChild(small);
    return b;
  }

  function renderFilters() {
    [el.agFilter, el.resFilter].forEach(function (box) {
      box.textContent = '';
      box.appendChild(filterChip('todas', 'Todas', planItems, null));
      PLAN.categorias.forEach(function (c) {
        box.appendChild(filterChip(c.id, c.nome, planItems.filter(function (i) { return i.cat === c.id; }), c));
      });
    });
  }

  function badgeEl(cat) {
    var b = document.createElement('span');
    b.className = 'cat-badge';
    catBadge(b, cat);
    return b;
  }

  function stateChip(item) {
    var st = itemStatus(item);
    var r = resultOf(item);
    var chip = document.createElement('span');
    chip.className = 'chip-state';
    if (st === 'andamento') {
      chip.classList.add('run');
      chip.textContent = 'Em andamento';
    } else if (st === 'ok') {
      chip.classList.add('ok');
      chip.textContent = '✓ ' + mmss(r.used);
    } else if (st === 'penalizada') {
      chip.classList.add('bad');
      chip.textContent = '−' + pointsText(r.points);
    } else if (state.agenda.current === item.id) {
      chip.classList.add('run');
      chip.textContent = 'Na tela';
    } else {
      return null;
    }
    return chip;
  }

  function renderAgendaList() {
    var scroll = el.agList.scrollTop;
    el.agList.textContent = '';
    visibleItems().forEach(function (item) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ag-item';
      b.setAttribute('data-id', item.id);
      var st = itemStatus(item);
      if (state.agenda.current === item.id) b.classList.add('current');
      if (st === 'ok' || st === 'penalizada') b.classList.add('done');
      var time = document.createElement('span');
      time.className = 'ag-time';
      time.textContent = item.hora;
      var text = document.createElement('span');
      text.className = 'ag-text';
      var name = document.createElement('strong');
      name.textContent = item.nome;
      var lead = document.createElement('small');
      lead.textContent = item.lider + ' · ' + Core.durationLabel(itemMs(item));
      text.appendChild(name);
      text.appendChild(lead);
      b.appendChild(time);
      b.appendChild(badgeEl(planCats[item.cat]));
      b.appendChild(text);
      var chip = stateChip(item);
      if (chip) b.appendChild(chip);
      li.appendChild(b);
      el.agList.appendChild(li);
    });
    el.agList.scrollTop = scroll;
    if (state.agenda.current !== lastCurrent) {
      lastCurrent = state.agenda.current;
      var cur = el.agList.querySelector('.current');
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderNowPanel(a) {
    el.nowEmpty.hidden = !!a.item;
    el.nowInfo.hidden = !a.item;
    if (a.item) {
      catBadge(el.nowCat, planCats[a.item.cat]);
      setText(el.nowLimit, 'Tempo: ' + Core.durationLabel(itemMs(a.item)) + ' · previsto às ' + a.item.hora);
      setText(el.nowName, a.item.nome);
      setText(el.nowLead, a.item.lider);
    }
    var r = a.registered ? a.result : null;
    el.nowResult.hidden = !r;
    el.agUndoBtn.hidden = !r;
    if (r) {
      el.nowResult.className = 'now-result' + (r.points ? ' bad' : '');
      el.nowResult.textContent = 'Registrado: ' + mmss(r.used) + ' de ' + mmss(r.allowed) + ' · ' +
        (r.points ? 'penalidade de ' + pointsText(r.points) : 'sem penalização');
    }
    var next = nextItem();
    var show = !!next && (!a.item || a.registered);
    el.agNextBtn.hidden = !show;
    if (show) setText(el.agNextBtn, (a.item ? 'Próxima: ' : 'Começar por: ') + next.nome + ' — ' + next.lider);
    else if (a.registered && !next) {
      el.nowResult.hidden = false;
      el.nowResult.textContent += ' · Todas as apresentações já foram registradas ✓';
    }
  }

  function renderResults() {
    var done = 0;
    var penalized = 0;
    var lost = 0;
    planItems.forEach(function (item) {
      var r = resultOf(item);
      if (!r) return;
      done++;
      if (r.points) penalized++;
      lost += r.points;
    });
    setText(el.doneCount, done + '/' + planItems.length);
    setText(el.resSummary, 'Registradas ' + done + ' de ' + planItems.length + ' · Com penalização ' + penalized + ' · Pontos perdidos ' + lost);
    el.resList.textContent = '';
    visibleItems().forEach(function (item) {
      var r = resultOf(item);
      var li = document.createElement('li');
      li.className = 'res-row';
      var name = document.createElement('div');
      name.className = 'res-name';
      var time = document.createElement('span');
      time.className = 'muted small';
      time.textContent = item.hora;
      var strong = document.createElement('strong');
      strong.textContent = item.nome;
      name.appendChild(time);
      name.appendChild(badgeEl(planCats[item.cat]));
      name.appendChild(strong);
      var lead = document.createElement('div');
      lead.className = 'res-lead';
      lead.textContent = item.lider;
      var when = document.createElement('div');
      when.className = 'res-time';
      var main = document.createElement('span');
      main.textContent = r ? mmss(r.used) : '—';
      var small = document.createElement('small');
      small.textContent = 'limite ' + mmss(r ? r.allowed : itemMs(item)) + (r && r.used > r.allowed ? ' · +' + mmss(r.used - r.allowed) : '');
      when.appendChild(main);
      when.appendChild(small);
      var end = document.createElement('div');
      end.className = 'res-end';
      var chip = stateChip(item);
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'chip-state';
        chip.textContent = 'Pendente';
      } else if (chip.classList.contains('ok')) {
        chip.textContent = 'Sem penalização';
      }
      end.appendChild(chip);
      if (r) {
        var x = document.createElement('button');
        x.type = 'button';
        x.className = 'x';
        x.setAttribute('data-clear', item.id);
        x.title = 'Apagar o tempo registrado';
        x.setAttribute('aria-label', 'Apagar o tempo registrado de ' + item.nome);
        x.textContent = '×';
        end.appendChild(x);
      }
      li.appendChild(name);
      li.appendChild(when);
      li.appendChild(lead);
      li.appendChild(end);
      el.resList.appendChild(li);
    });
  }

  // Seen from the buttons: start/pause, stop and register, reset, next.
  function updateAgendaButtons(tv) {
    if (!PLAN) return;
    var a = agendaNow();
    var action = tv.running ? 'pause' : 'start';
    var label = tv.running ? 'Pausar' : a.registered ? 'Feito ✓' : tv.status === 'paused' ? 'Continuar' : 'Iniciar';
    if (el.agMainBtn.getAttribute('data-action') !== action) el.agMainBtn.setAttribute('data-action', action);
    setText(el.agMainLabel, label);
    var noItem = !a.item;
    var off = noItem || a.registered;
    if (el.agMainBtn.disabled !== off) el.agMainBtn.disabled = off;
    var canStop = !off && (tv.running || tv.elapsed >= SECOND);
    if (el.agStopBtn.disabled !== !canStop) el.agStopBtn.disabled = !canStop;
    var canReset = !noItem && tv.status !== 'idle';
    if (el.agResetBtn.disabled !== !canReset) el.agResetBtn.disabled = !canReset;
  }

  function agendaMainPress() {
    var a = agendaNow();
    if (!a.item) {
      toast('Escolha uma apresentação na lista.', 'warn');
      return;
    }
    if (a.registered) return;
    var running = Core.timerView(state, serverNow()).running;
    dispatch({ type: running ? 'pause' : 'start', target: 'timer' });
  }

  function agendaReset() {
    var a = agendaNow();
    if (!a.item) return;
    var tv = Core.timerView(state, serverNow());
    if (tv.status === 'idle') return;
    if (!a.registered && !window.confirm('Zerar o tempo de "' + a.item.nome + '" SEM registrar?')) return;
    dispatch({ type: 'reset', target: 'timer' });
  }

  function chooseItem(item) {
    if (!item) return;
    var a = agendaNow();
    var timing = state.timer.startedAt != null || state.timer.elapsed > 0;
    var inProgress = !!a.item && !a.registered && timing;
    var force = false;
    if (inProgress) {
      if (a.item.id === item.id) return; // already on the clock
      if (!window.confirm('"' + a.item.nome + '" está em andamento. Trocar mesmo assim? O tempo dela NÃO será registrado.')) return;
      force = true;
    } else if (resultOf(item)) {
      if (!window.confirm('"' + item.nome + '" já tem tempo registrado (' + mmss(resultOf(item).used) + '). Refazer? O tempo antigo só é trocado quando você parar de novo.')) return;
    }
    dispatch({ type: 'select', id: item.id, ms: itemMs(item), force: force });
  }

  function resultRows() {
    return planItems.map(function (item, i) {
      var r = resultOf(item);
      var st = itemStatus(item);
      var situation = st === 'andamento' ? 'Em andamento' : st === 'ok' ? 'Sem penalização' : st === 'penalizada' ? 'Com penalização' : 'Pendente';
      var cat = planCats[item.cat];
      return [i + 1, item.hora, cat ? cat.nome : item.cat, item.nome, item.lider,
        mmss(r ? r.allowed : itemMs(item)), r ? mmss(r.used) : '', r ? mmss(Math.max(0, r.used - r.allowed)) : '',
        r ? r.points : '', situation];
    });
  }

  var RESULT_HEADER = ['Ordem', 'Horário previsto', 'Categoria', 'Setor / Nome', 'Líder ou grupo', 'Tempo limite', 'Tempo usado', 'Excesso', 'Pontos perdidos', 'Situação'];

  function csvCell(v) {
    var t = String(v);
    return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  function downloadText(name, text, type) {
    var blob = new Blob(['﻿' + text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function setView(view) {
    if (!PLAN) view = 'livre';
    prefs.view = view;
    savePrefs();
    ['apres', 'tempos', 'livre'].forEach(function (n) { setClass(app, 'view-' + n, n === view); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-views]'), function (panel) {
      panel.hidden = (' ' + panel.getAttribute('data-views') + ' ').indexOf(' ' + view + ' ') < 0;
    });
    Array.prototype.forEach.call(el.tabs.querySelectorAll('.tab'), function (tab) {
      var on = tab.getAttribute('data-view') === view;
      setClass(tab, 'active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    needFit = true;
    kick();
  }

  function bindAgendaEvents() {
    el.tabs.classList.toggle('off', !PLAN);
    if (!PLAN) {
      setView('livre'); // no schedule file: only the free timer
      return;
    }
    el.tabs.addEventListener('click', function (e) {
      var tab = e.target.closest && e.target.closest('.tab');
      if (tab) setView(tab.getAttribute('data-view'));
    });
    [el.agFilter, el.resFilter].forEach(function (box) {
      box.addEventListener('click', function (e) {
        var chip = e.target.closest && e.target.closest('.chip');
        if (!chip) return;
        prefs.cat = chip.getAttribute('data-cat');
        savePrefs();
        renderAgenda();
      });
    });
    el.agList.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.ag-item');
      if (b) chooseItem(planById[b.getAttribute('data-id')]);
    });
    el.agMainBtn.addEventListener('click', agendaMainPress);
    el.agStopBtn.addEventListener('click', function () { dispatch({ type: 'finish' }); });
    el.agResetBtn.addEventListener('click', agendaReset);
    el.agUndoBtn.addEventListener('click', function () {
      var a = agendaNow();
      if (a.item) dispatch({ type: 'clearResult', id: a.item.id });
    });
    el.agNextBtn.addEventListener('click', function () { chooseItem(nextItem()); });
    el.resList.addEventListener('click', function (e) {
      var x = e.target.closest && e.target.closest('[data-clear]');
      if (!x) return;
      var item = planById[x.getAttribute('data-clear')];
      if (item && window.confirm('Apagar o tempo registrado de "' + item.nome + '"?')) dispatch({ type: 'clearResult', id: item.id });
    });
    el.clearResultsBtn.addEventListener('click', function () {
      if (window.confirm('Apagar TODOS os tempos registrados? Isso não pode ser desfeito.')) dispatch({ type: 'clearResult', id: '*' });
    });
    el.copyResultsBtn.addEventListener('click', function () {
      var rows = [RESULT_HEADER].concat(resultRows());
      copyText(rows.map(function (r) { return r.join('\t'); }).join('\n')).then(function () {
        toast('Tabela copiada: cole no Excel.');
      }, function () { toast('Não deu para copiar. Use "Baixar CSV".', 'warn'); });
    });
    el.csvBtn.addEventListener('click', function () {
      var rows = [RESULT_HEADER].concat(resultRows());
      var d = new Date();
      var name = 'tempos-seminario-' + d.getFullYear() + '-' + Core.pad2(d.getMonth() + 1) + '-' + Core.pad2(d.getDate()) + '.csv';
      downloadText(name, rows.map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n'), 'text/csv;charset=utf-8');
    });
    setView(prefs.view);
  }

  // --------------------------------------------------------- frame loop

  var needFit = true;
  var fitKey = '';
  var mainAction = 'start';
  var phaseClass = 'phase-normal';
  var statusClass = 'status-idle';
  var progressText = '';

  function tick() {
    var now = serverNow();
    var tv = Core.timerView(state, now);
    var sv = Core.stopwatchView(state, now);
    timerSounds(tv);

    var isTimer = state.mode === 'timer';
    var view = isTimer ? tv : sv;
    var mainText, signText = '', fracText = '', subText;
    if (isTimer) {
      mainText = Core.clockText(tv.shown);
      signText = tv.shown < 0 ? '−' : '';
      subText = timerLabel(tv);
      var p = 'scaleX(' + tv.progress.toFixed(4) + ')';
      if (p !== progressText) {
        progressText = p;
        el.progressBar.style.transform = p;
      }
    } else {
      var st = Core.stopwatchText(sv.elapsed);
      mainText = st.main;
      fracText = ',' + st.frac;
      subText = stopwatchLabel(sv);
      if (currentLap) {
        setText(currentLap.split, lapText(sv.lapElapsed));
        setText(currentLap.total, lapText(sv.elapsed));
      }
    }
    setText(el.sign, signText);
    setText(el.main, mainText);
    setText(el.frac, fracText);
    setText(el.sub, subText);

    swapClass('phase-' + (isTimer ? tv.phase : 'normal'), 'phase');
    swapClass('status-' + view.status, 'status');
    setClass(app, 'flashing', isTimer && tv.phase === 'over' && tv.running && tv.remaining > -10 * SECOND);
    updateButtons(tv, sv, isTimer);
    updateAgendaButtons(tv);

    var key = state.mode + '|' + signText + '|' + mainText.length + '|' + fracText.length;
    if (needFit || key !== fitKey) {
      fitKey = key;
      needFit = false;
      fitDigits();
    }
    updateClock();
    return view;
  }

  function swapClass(next, kind) {
    var current = kind === 'phase' ? phaseClass : statusClass;
    if (current === next) return;
    app.classList.remove(current);
    app.classList.add(next);
    if (kind === 'phase') phaseClass = next;
    else statusClass = next;
  }

  function timerLabel(tv) {
    var a = agendaNow();
    if (a.item) {
      if (a.registered) {
        var r = a.result;
        return 'Registrado · ' + mmss(r.used) + ' de ' + mmss(r.allowed) + ' · ' + (r.points ? 'penalidade −' + pointsText(r.points) : 'sem penalidade');
      }
      if (tv.finished && tv.status !== 'idle') {
        var lost = Core.penaltyPoints(-tv.remaining);
        return lost ? 'Penalidade: −' + pointsText(lost) : 'Tempo esgotado · penalidade a partir de −01:00';
      }
    }
    if (tv.status === 'running') return tv.finished ? 'Tempo esgotado' : 'Termina às ' + hhmm(new Date(Date.now() + tv.remaining));
    if (tv.status === 'paused') return tv.finished ? 'Pausado · tempo esgotado' : 'Pausado';
    if (tv.status === 'finished') return 'Tempo esgotado';
    return 'Pronto';
  }

  function stopwatchLabel(sv) {
    var n = sv.laps.length;
    if (sv.status === 'running') return n ? 'Volta ' + sv.lapNumber + ' · ' + lapText(sv.lapElapsed) : 'Cronometrando';
    if (sv.status === 'paused') return 'Pausado' + (n ? ' · ' + n + (n > 1 ? ' voltas' : ' volta') : '');
    return 'Pronto';
  }

  function updateButtons(tv, sv, isTimer) {
    var action, label;
    var v = isTimer ? tv : sv;
    if (v.running) { action = 'pause'; label = 'Pausar'; }
    else if (v.status === 'finished') { action = 'restart'; label = 'Reiniciar'; }
    else if (v.status === 'paused') { action = 'start'; label = 'Continuar'; }
    else { action = 'start'; label = 'Iniciar'; }
    if (action !== mainAction) {
      mainAction = action;
      el.mainBtn.setAttribute('data-action', action);
    }
    setText(el.mainLabel, label);
    var canReset = isTimer ? tv.status !== 'idle' || tv.duration !== tv.base : sv.status !== 'idle';
    if (el.resetBtn.disabled === canReset) el.resetBtn.disabled = !canReset;
    var canLap = !isTimer && sv.running && sv.laps.length < Core.MAX_LAPS;
    if (el.lapBtn.disabled === canLap) el.lapBtn.disabled = !canLap;
  }

  // Largest font size at which the digits still fit their box.
  function fitDigits() {
    var w = el.digitsWrap.clientWidth;
    var h = el.digitsWrap.clientHeight;
    if (w < 10 || h < 10) return;
    var d = el.digits;
    d.style.fontSize = '100px';
    var dw = d.offsetWidth;
    var dh = d.offsetHeight;
    if (!dw || !dh) return;
    var size = 100 * Math.min((w * 0.96) / dw, (h * 0.95) / dh);
    d.style.fontSize = Math.max(18, Math.floor(size)) + 'px';
  }

  var clockText = '';
  function updateClock() {
    if (!prefs.clock) return;
    var t = hhmm(new Date());
    if (t !== clockText) {
      clockText = t;
      el.clock.textContent = t;
    }
  }

  var rafId = null;
  var timeoutId = null;

  function loop() {
    rafId = timeoutId = null;
    var view = tick();
    // Every frame while a clock is running on screen; otherwise a slow pulse
    // keeps sounds, labels and the wall clock current.
    if (view.running && !document.hidden) rafId = requestAnimationFrame(loop);
    else timeoutId = setTimeout(loop, document.hidden ? 1000 : 250);
  }

  function kick() {
    if (rafId) cancelAnimationFrame(rafId);
    if (timeoutId) clearTimeout(timeoutId);
    loop();
  }

  // --------------------------------------------------------------- sound

  var audio = { ctx: null, primed: false };
  var soundPrev = null;

  function audioContext() {
    if (!audio.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        audio.ctx = new AC();
        audio.ctx.onstatechange = updateSoundButton;
      } catch (e) {
        return null;
      }
    }
    return audio.ctx;
  }

  // Browsers (iOS above all) only allow sound after the user touches the page.
  function unlockAudio() {
    if (!prefs.sound) return;
    var ctx = audioContext();
    if (!ctx) return;
    if (ctx.state !== 'running' && ctx.resume) ctx.resume().then(updateSoundButton, function () {});
    if (!audio.primed) {
      try {
        var src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
        audio.primed = true;
      } catch (e) { /* ignore */ }
    }
    updateSoundButton();
  }

  function audioReady() { return !!(audio.ctx && audio.ctx.state === 'running'); }

  function tone(ctx, freq, start, duration, volume) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  function playSound(kind) {
    var ctx = audioContext();
    if (!ctx) return;
    if (ctx.state !== 'running' && ctx.resume) ctx.resume().catch(function () {});
    var t = ctx.currentTime + 0.03;
    if (kind === 'warn') {
      tone(ctx, 880, t, 0.22, 0.35);
    } else if (kind === 'danger') {
      tone(ctx, 988, t, 0.16, 0.45);
      tone(ctx, 988, t + 0.24, 0.16, 0.45);
    } else if (kind === 'end') {
      for (var i = 0; i < 3; i++) {
        for (var j = 0; j < 3; j++) tone(ctx, 1046.5, t + i * 1.1 + j * 0.19, 0.14, 0.6);
      }
    } else {
      tone(ctx, 660, t, 0.14, 0.4);
      tone(ctx, 880, t + 0.16, 0.2, 0.4);
    }
  }

  // Beeps when the countdown crosses a color, but only when time itself got
  // there (not a reset or a jump by a command) and only if it just happened.
  function timerSounds(tv) {
    var cur = { phase: tv.phase, rev: state.rev, running: tv.running, shown: tv.shown };
    var prev = soundPrev;
    soundPrev = cur;
    if (!prev || !prefs.sound || prev.rev !== cur.rev || !prev.running || prev.phase === cur.phase) return;
    var s = state.settings;
    if (cur.phase === 'over') {
      if (tv.remaining > -3 * SECOND) playSound('end');
    } else if (cur.phase === 'danger') {
      if (cur.shown * SECOND > s.dangerAt - 3 * SECOND) playSound('danger');
    } else if (cur.phase === 'warn' && prev.phase === 'normal') {
      if (cur.shown * SECOND > s.warnAt - 3 * SECOND) playSound('warn');
    }
  }

  function setSound(on) {
    prefs.sound = on;
    savePrefs();
    if (on) unlockAudio();
    updateSoundButton();
    toast(on ? 'Som ligado neste aparelho' : 'Som desligado neste aparelho');
  }

  function updateSoundButton() {
    setClass(el.soundBtn, 'muted', !prefs.sound);
    setClass(el.soundBtn, 'locked', prefs.sound && !audioReady());
    el.soundBtn.title = !prefs.sound ? 'Som desligado neste aparelho (M)'
      : audioReady() ? 'Som ligado neste aparelho (M)'
      : 'Toque em qualquer lugar da tela para liberar o som';
    el.soundChk.checked = prefs.sound;
  }

  // ------------------------------------------------------ screen helpers

  var wakeLock = null;
  var wakeLockRequested = false;

  function wakeLockSupported() { return 'wakeLock' in navigator; }

  function updateWakeLock() {
    if (!wakeLockSupported()) return;
    var want = prefs.awake && !document.hidden;
    if (want && !wakeLock && !wakeLockRequested) {
      wakeLockRequested = true;
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLockRequested = false;
        wakeLock = lock;
        lock.addEventListener('release', function () { if (wakeLock === lock) wakeLock = null; });
        if (!prefs.awake) updateWakeLock(); // switched off while we were asking
      }, function () {
        wakeLockRequested = false;
      });
    } else if (!want && wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }

  var standalone = navigator.standalone === true ||
    !!(window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);

  function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }

  function toggleFullscreen() {
    var root = document.documentElement;
    if (fullscreenElement()) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
      return;
    }
    var request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request) return;
    var result = request.call(root);
    if (result && result.catch) result.catch(function () {});
  }

  function onFullscreenChange() {
    setClass(el.fullscreenBtn, 'on', !!fullscreenElement());
    onResize();
  }

  function setDisplayMode(on) {
    prefs.display = on;
    savePrefs();
    setClass(app, 'is-display', on);
    closeModals();
    onResize();
  }

  function onResize() {
    document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
    measureDisplay();
    needFit = true;
    kick();
  }

  var displayHeight = 0;
  function measureDisplay() {
    var h = el.display.clientHeight;
    if (h && h !== displayHeight) {
      displayHeight = h;
      el.display.style.setProperty('--dh', h + 'px');
      setClass(el.display, 'tight', h < 260);
      setClass(el.display, 'tiny', h < 170);
      needFit = true;
    }
  }

  var toastTimer = null;
  function toast(text, kind) {
    el.toast.textContent = text;
    el.toast.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.className = 'toast' + (kind ? ' ' + kind : ''); }, 2600);
  }

  // Tells the people at the controls what someone else just did.
  function announce(last) {
    if (!last || !last.by || last.by.id === clientId || prefs.display) return;
    toast(describeAction(last));
  }

  function describeAction(last) {
    var who = last.by.name || 'outro aparelho';
    var what = last.target === 'stopwatch' ? 'Cronômetro' : 'Temporizador';
    switch (last.type) {
      case 'start': return what + ' iniciado por ' + who;
      case 'pause': return what + ' pausado por ' + who;
      case 'reset': return what + ' zerado por ' + who;
      case 'restart': return what + ' reiniciado por ' + who;
      case 'set': return 'Tempo definido para ' + Core.clockText((last.ms || 0) / SECOND) + ' por ' + who;
      case 'adjust': return (last.ms < 0 ? '−' : '+') + Core.durationLabel(last.ms || 0) + ' por ' + who;
      case 'lap': return 'Volta marcada por ' + who;
      case 'mode': return (last.target === 'stopwatch' ? 'Cronômetro' : 'Temporizador') + ' na tela (' + who + ')';
      case 'title': return 'Título alterado por ' + who;
      case 'message': return 'Mensagem atualizada por ' + who;
      case 'settings': return 'Ajustes alterados por ' + who;
      case 'select': return 'Apresentação escolhida por ' + who;
      case 'finish': return 'Tempo registrado por ' + who + ': ' + mmss(last.ms || 0);
      case 'clearResult': return 'Tempo apagado por ' + who;
      default: return 'Atualizado por ' + who;
    }
  }

  // -------------------------------------------------------------- dialogs

  var qrFor = '';

  function openModal(modal) {
    closeModals();
    modal.hidden = false;
    if (modal === el.connectModal) {
      renderConnect();
      if (conn !== 'local' && !cloudMode) refreshServerInfo();
    }
  }

  function closeModals() {
    modals.forEach(function (m) {
      if (m === el.roomModal && roomRequired) return; // first-time setup must be finished
      m.hidden = true;
    });
  }

  function anyModalOpen() { return modals.some(function (m) { return !m.hidden; }); }

  function refreshServerInfo() {
    fetch('api/info', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (info) {
        if (info && info.app === 'cronometro-sync') {
          serverInfo = info;
          if (!el.connectModal.hidden) renderConnect();
        }
      })
      .catch(function () {});
  }

  function isLoopback(host) { return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'; }

  // The address other devices should open: this one, unless it is "localhost".
  function shareUrl() {
    if (!isLoopback(location.hostname)) return location.origin + location.pathname.replace(/index\.html$/, '');
    var first = serverInfo && serverInfo.addresses && serverInfo.addresses[0];
    return first ? first.url : location.origin + '/';
  }

  var INTRO_SERVER = el.connectIntro.innerHTML;
  var INTRO_CLOUD = 'Abra este endereço em qualquer aparelho <strong>com internet</strong> (não precisa ser a mesma rede) ou aponte a câmera para o QR code:';

  function renderConnect() {
    var local = conn === 'local';
    el.connectServer.hidden = local;
    el.connectLocal.hidden = !local;
    el.setupCloud.hidden = !(local && location.protocol !== 'file:' && window.Cloud);
    if (!local) {
      var url = cloudMode ? shareLink() : shareUrl();
      el.connectIntro.innerHTML = cloudMode ? INTRO_CLOUD : INTRO_SERVER;
      el.shareUrl.classList.toggle('long', cloudMode);
      setText(el.shareUrl, cloudMode ? url : url.replace(/\/$/, ''));
      if (url !== qrFor && window.qrcode) {
        el.qr.innerHTML = qrSvg(url);
        qrFor = url;
      }
      el.cloudExtras.hidden = !cloudMode;
      if (cloudMode) {
        setText(el.roomCode, Cloud.formatRoom(cloud.room));
        el.cloudProblem.hidden = !cloud.problem;
        setText(el.cloudProblem, cloud.problem);
      }
      var others = cloudMode ? [] : (serverInfo && serverInfo.addresses || []).filter(function (a) { return a.url !== url; });
      el.otherUrls.hidden = !others.length;
      el.otherUrls.textContent = '';
      if (others.length) {
        el.otherUrls.appendChild(document.createTextNode('Se não abrir, tente: '));
        others.forEach(function (a, i) {
          if (i) el.otherUrls.appendChild(document.createTextNode(' · '));
          var code = document.createElement('code');
          code.textContent = a.url.replace(/\/$/, '');
          el.otherUrls.appendChild(code);
        });
      }
    }
    renderDevices();
  }

  function renderDevices() {
    el.devices.textContent = '';
    setText(el.deviceCount, String(devices.length));
    devices.forEach(function (d) {
      var li = document.createElement('li');
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = 'var(--go)';
      var name = document.createElement('span');
      name.textContent = d.name || 'Aparelho';
      li.appendChild(dot);
      li.appendChild(name);
      if (d.id === clientId) {
        var mine = document.createElement('span');
        mine.className = 'me';
        mine.textContent = 'este aparelho';
        li.appendChild(mine);
      }
      el.devices.appendChild(li);
    });
  }

  function qrSvg(text) {
    var qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var q = 2;
    var size = n + q * 2;
    var d = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size +
      '" shape-rendering="crispEdges" role="img" aria-label="QR code"><path fill="#000" d="' + d + '"/></svg>';
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(area);
      if (ok) resolve();
      else reject(new Error('copy failed'));
    });
  }

  // --------------------------------------------------------------- input

  function mainPress() {
    if (PLAN && prefs.view === 'apres') agendaMainPress();
    else dispatch({ type: mainAction, target: state.mode });
  }

  function adjust(ms) {
    if (state.mode === 'timer') dispatch({ type: 'adjust', ms: ms });
  }

  function readNumber(input) {
    var n = parseInt(input.value, 10);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function buildControls() {
    PRESET_MINUTES.forEach(function (min) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.setAttribute('data-ms', String(min * MINUTE));
      b.title = 'Definir ' + min + ' min';
      b.appendChild(document.createTextNode(String(min)));
      var unit = document.createElement('small');
      unit.textContent = 'min';
      b.appendChild(unit);
      el.presets.appendChild(b);
    });
    QUICK_MESSAGES.forEach(function (text) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = text;
      el.quickMessages.appendChild(b);
    });
    [el.warnSel, el.dangerSel].forEach(function (select) {
      THRESHOLD_SECONDS.forEach(function (sec) {
        select.appendChild(new Option(sec ? Core.durationLabel(sec * SECOND) : 'Desligado', String(sec * SECOND)));
      });
    });
  }

  function bindEvents() {
    // Pointer clicks should not leave focus on a button, or Space would press it again.
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (b && e.detail > 0) b.blur();
    });
    ['touchend', 'click', 'keydown'].forEach(function (type) {
      document.addEventListener(type, function () {
        unlockAudio();
        updateWakeLock();
      }, true);
    });

    el.mainBtn.addEventListener('click', mainPress);
    el.resetBtn.addEventListener('click', function () { dispatch({ type: 'reset', target: state.mode }); });
    el.lapBtn.addEventListener('click', function () { dispatch({ type: 'lap' }); });
    segButtons.forEach(function (b) {
      b.addEventListener('click', function () { dispatch({ type: 'mode', mode: b.getAttribute('data-mode') }); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-adjust]'), function (b) {
      b.addEventListener('click', function () { adjust(Number(b.getAttribute('data-adjust'))); });
    });
    el.presets.addEventListener('click', function (e) {
      var b = e.target.closest('.preset');
      if (b) dispatch({ type: 'set', ms: Number(b.getAttribute('data-ms')) });
    });
    el.customForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var seconds = readNumber(el.inH) * 3600 + readNumber(el.inM) * 60 + readNumber(el.inS);
      if (!seconds) {
        toast('Digite um tempo maior que zero.', 'warn');
        return;
      }
      dispatch({ type: 'set', ms: Math.min(seconds * SECOND, Core.MAX_MS) });
      el.inH.value = el.inM.value = el.inS.value = '';
      if (document.activeElement) document.activeElement.blur();
    });

    el.messageForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = el.messageInput.value.trim();
      if (!text) return;
      dispatch({ type: 'message', text: text, flash: el.flashInput.checked });
      el.messageInput.value = '';
      el.messageInput.blur();
    });
    el.quickMessages.addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (b) dispatch({ type: 'message', text: b.textContent, flash: el.flashInput.checked });
    });
    el.clearMessageBtn.addEventListener('click', function () { dispatch({ type: 'message', text: '' }); });
    el.bannerClose.addEventListener('click', function () { dispatch({ type: 'message', text: '' }); });
    el.banner.addEventListener('animationend', function () { el.banner.classList.remove('flash'); });
    el.titleForm.addEventListener('submit', function (e) {
      e.preventDefault();
      dispatch({ type: 'title', text: el.titleInput.value });
      el.titleInput.blur();
    });

    el.statusBtn.addEventListener('click', function () {
      if (conn === 'setup') openRoomDialog(true);
      else openModal(el.connectModal);
    });
    el.connectBtn.addEventListener('click', function () {
      if (conn === 'setup') openRoomDialog(true);
      else openModal(el.connectModal);
    });
    el.changeRoomBtn.addEventListener('click', function () { openRoomDialog(false); });
    el.setupCloudBtn.addEventListener('click', function () {
      loadCloudSettings();
      openRoomDialog(false);
    });
    el.roomCreateBtn.addEventListener('click', function () { chooseRoom(Cloud.newRoom()); });
    el.roomJoinForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var room = Cloud.cleanRoom(el.roomInput.value);
      if (!room) {
        showRoomError('Código inválido: são 8 letras e números, como K7M2-Q9XR.');
        el.roomInput.focus();
        return;
      }
      chooseRoom(room);
    });
    el.roomLocalBtn.addEventListener('click', useOnlyThisDevice);
    el.settingsBtn.addEventListener('click', function () { openModal(el.settingsModal); });
    el.soundBtn.addEventListener('click', function () { setSound(!prefs.sound); });
    el.fullscreenBtn.addEventListener('click', toggleFullscreen);
    el.displayBtn.addEventListener('click', function () { setDisplayMode(true); });
    el.exitDisplayBtn.addEventListener('click', function () { setDisplayMode(false); });
    modals.forEach(function (m) {
      m.addEventListener('click', function (e) {
        if (e.target === m || (e.target.closest && e.target.closest('[data-close]'))) closeModals();
      });
    });
    el.copyBtn.addEventListener('click', function () {
      copyText(el.shareUrl.textContent).then(function () { toast('Endereço copiado'); }, function () {
        toast('Não deu para copiar; selecione o endereço e copie.', 'warn');
      });
    });

    el.warnSel.addEventListener('change', function () { dispatch({ type: 'settings', warnAt: Number(el.warnSel.value) }); });
    el.dangerSel.addEventListener('change', function () { dispatch({ type: 'settings', dangerAt: Number(el.dangerSel.value) }); });
    el.overtimeChk.addEventListener('change', function () { dispatch({ type: 'settings', overtime: el.overtimeChk.checked }); });
    el.soundChk.addEventListener('change', function () { setSound(el.soundChk.checked); });
    el.testSoundBtn.addEventListener('click', function () {
      if (!prefs.sound) setSound(true);
      unlockAudio();
      playSound('test');
    });
    el.clockChk.addEventListener('change', function () {
      prefs.clock = el.clockChk.checked;
      savePrefs();
      setClass(app, 'no-clock', !prefs.clock);
      clockText = '';
    });
    el.awakeChk.addEventListener('change', function () {
      prefs.awake = el.awakeChk.checked;
      savePrefs();
      updateWakeLock();
    });
    el.nameInput.addEventListener('change', function () {
      prefs.name = Core.cleanText(el.nameInput.value, Core.MAX_NAME);
      el.nameInput.value = prefs.name;
      savePrefs();
      if (link && link.rename) link.rename(); // the room's device list updates by itself
      else if (link && link.open) link.open(); // reconnect so others see the new name
      else if (conn === 'local') setDevices([{ id: clientId, name: deviceName(), since: Date.now() }]);
    });

    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', function () { setTimeout(onResize, 300); });
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    if (window.ResizeObserver) {
      var observer = new ResizeObserver(function () {
        measureDisplay();
        needFit = true;
        kick();
      });
      observer.observe(el.display);
      observer.observe(el.digitsWrap);
    }
  }

  function onVisible() {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    soundPrev = null; // never ring for something that happened while away
    if (link && link.wake) link.wake();
    hiddenAt = 0;
    updateWakeLock();
    kick();
  }

  function onKey(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    var target = e.target;
    var tag = target && target.tagName;
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!(target && target.isContentEditable);
    if (e.key === 'Escape') {
      if (typing) target.blur();
      if (anyModalOpen()) closeModals();
      else if (!typing && prefs.display) setDisplayMode(false);
      return;
    }
    if (typing || anyModalOpen()) return;
    if ((e.key === ' ' || e.key === 'Enter') && tag === 'BUTTON') return; // the focused button handles it
    var key = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
    var handled = true;
    switch (key) {
      case ' ':
      case 'Spacebar': mainPress(); break;
      case 'r':
        if (PLAN && prefs.view === 'apres') agendaReset();
        else dispatch({ type: 'reset', target: state.mode });
        break;
      case 'p': if (agendaNow().item) dispatch({ type: 'finish' }); break;
      case 'v':
      case 'l': if (state.mode === 'stopwatch') dispatch({ type: 'lap' }); break;
      case 't': dispatch({ type: 'mode', mode: 'timer' }); break;
      case 'c': dispatch({ type: 'mode', mode: 'stopwatch' }); break;
      case 'ArrowUp': adjust(MINUTE); break;
      case 'ArrowDown': adjust(-MINUTE); break;
      case 'ArrowRight': adjust(10 * SECOND); break;
      case 'ArrowLeft': adjust(-10 * SECOND); break;
      case 'e': setDisplayMode(!prefs.display); break;
      case 'f': if (!el.fullscreenBtn.hidden) toggleFullscreen(); break;
      case 'm': setSound(!prefs.sound); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }

  // ---------------------------------------------------------------- boot

  function boot() {
    buildControls();
    setClass(app, 'is-display', prefs.display);
    setClass(app, 'no-clock', !prefs.clock);
    el.clockChk.checked = prefs.clock;
    el.awakeChk.checked = prefs.awake;
    el.nameInput.value = prefs.name;
    el.nameInput.placeholder = guessDeviceName();
    if (!wakeLockSupported()) {
      el.awakeChk.checked = false;
      el.awakeChk.disabled = true;
      el.awakeNote.textContent = isIOS()
        ? 'No iPad/iPhone: Ajustes › Tela e Brilho › Bloqueio Automático › Nunca.'
        : 'Este navegador não permite. Ajuste o descanso de tela do aparelho.';
    }
    el.fullscreenBtn.hidden = standalone || !(document.fullscreenEnabled || document.webkitFullscreenEnabled);

    bindEvents();
    bindAgendaEvents();
    renderState({ snapshot: true });
    renderStatus();
    updateSoundButton();
    onResize();
    updateWakeLock();
    detectServer(0);
  }

  boot();
}());
