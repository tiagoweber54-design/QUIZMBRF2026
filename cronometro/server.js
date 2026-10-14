#!/usr/bin/env node
/*
 * Cronômetro Sync — local network server.
 *
 * Serves the app in ./public and keeps the one shared timer state. Devices get
 * every change over Server-Sent Events and send commands with POST, so any
 * phone, tablet or computer on the same network can start, pause or adjust
 * the timer. Only Node.js built-ins are used: no `npm install` needed.
 *
 *   node server.js [--porta=3000] [--abrir] [--sem-qr]
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const core = require('./public/core.js');
const { version: VERSION } = require('./package.json');

const APP_ID = 'cronometro-sync';
const DEFAULT_PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_STATE_FILE = path.join(__dirname, 'estado.json');
const PING_MS = 10000;
const MAX_BODY = 16 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// Adapters that are rarely the network the phones are on.
const VIRTUAL_IFACE = /virtual|vmnet|vbox|vethernet|hyper-v|wsl|docker|br-|veth|utun|tailscale|zerotier|hamachi|loopback|bluetooth/i;

const ACTION_LABEL = {
  start: 'iniciar', pause: 'pausar', reset: 'zerar', restart: 'reiniciar', set: 'definir tempo',
  adjust: 'ajustar tempo', lap: 'marcar volta', mode: 'trocar tela', title: 'título',
  message: 'mensagem', settings: 'ajustes'
};

function createTimerServer(options) {
  const opts = options || {};
  const stateFile = opts.stateFile === undefined ? DEFAULT_STATE_FILE : opts.stateFile; // null: keep in memory only
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const instance = crypto.randomBytes(6).toString('hex');
  const clients = new Map(); // tab id -> { id, name, since, res }
  let state = loadState(stateFile, log);
  let saveTimer = null;
  let clientsTimer = null;

  const server = http.createServer((req, res) => {
    try {
      route(req, res);
    } catch (err) {
      log('Erro: ' + (err && err.stack || err));
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
      else res.end();
    }
  });
  server.keepAliveTimeout = 65000;

  const pinger = setInterval(() => broadcast('ping', { t: Date.now() }), PING_MS);
  pinger.unref();
  server.on('close', () => {
    clearInterval(pinger);
    flushState();
  });

  function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p === '/api/events' && req.method === 'GET') return openEvents(req, res, url);
    if (p === '/api/command' && req.method === 'POST') return handleCommand(req, res);
    if (p === '/api/state' && req.method === 'GET') return sendJson(res, 200, payload());
    if (p === '/api/time') return sendJson(res, 200, { t: Date.now() });
    if (p === '/api/info') return sendJson(res, 200, info());
    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not_found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Método não permitido');
    return serveStatic(p, req, res);
  }

  function payload(extra) {
    return Object.assign({ state, serverTime: Date.now(), instance }, extra);
  }

  function info() {
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : null;
    return { app: APP_ID, version: VERSION, instance, port, addresses: lanAddresses(port), time: Date.now() };
  }

  // ------------------------------------------------------------ live updates

  function openEvents(req, res, url) {
    const id = core.cleanText(url.searchParams.get('id') || '', 64) || crypto.randomBytes(6).toString('hex');
    const name = core.cleanText(url.searchParams.get('name') || '', core.MAX_NAME) || deviceFromUserAgent(req.headers['user-agent']);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    // Padding makes some mobile browsers and proxies deliver events right away.
    res.write(':' + ' '.repeat(2048) + '\nretry: 2000\n\n');
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true, 15000);
    req.socket.setTimeout(0);

    const previous = clients.get(id); // same tab reconnecting: drop the stale stream
    if (previous) previous.res.end();
    const client = { id, name, since: Date.now(), res };
    clients.set(id, client);
    writeEvent(res, 'state', payload({ snapshot: true }));
    writeEvent(res, 'clients', { clients: clientList() });
    announceClients();

    const drop = () => {
      if (clients.get(id) !== client) return;
      clients.delete(id);
      announceClients();
    };
    req.on('close', drop);
    res.on('error', drop);
  }

  function writeEvent(res, event, data) {
    res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
  }

  function broadcast(event, data) {
    clients.forEach((c) => writeEvent(c.res, event, data));
  }

  function clientList() {
    return Array.from(clients.values()).map((c) => ({ id: c.id, name: c.name, since: c.since }));
  }

  // Coalesces bursts of (re)connections into one update.
  function announceClients() {
    if (clientsTimer) return;
    clientsTimer = setTimeout(() => {
      clientsTimer = null;
      broadcast('clients', { clients: clientList() });
    }, 80);
  }

  // ---------------------------------------------------------------- commands

  function handleCommand(req, res) {
    const type = String(req.headers['content-type'] || '');
    // Requiring JSON keeps other web pages from posting commands across origins.
    if (!/^application\/json\b/i.test(type)) return sendJson(res, 415, { error: 'expected_json' });
    readBody(req, MAX_BODY).then((body) => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch (e) {
        return sendJson(res, 400, { error: 'invalid_json' });
      }
      const cmd = msg && msg.cmd;
      if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') {
        return sendJson(res, 400, { error: 'invalid_command' });
      }
      const from = msg.client && typeof msg.client === 'object' ? msg.client : {};
      const by = {
        id: core.cleanText(String(from.id || ''), 64),
        name: core.cleanText(String(from.name || ''), core.MAX_NAME) || deviceFromUserAgent(req.headers['user-agent'])
      };
      const next = core.apply(state, cmd, Date.now(), by);
      const changed = next !== state;
      if (changed) {
        state = next;
        scheduleSave();
        broadcast('state', payload());
        log(by.name + ' → ' + describe(cmd));
      }
      sendJson(res, 200, payload({ ok: true, changed }));
    }, (err) => {
      sendJson(res, err.status || 400, { error: err.status === 413 ? 'too_large' : 'bad_request' });
    }).catch((err) => {
      log('Erro: ' + (err && err.stack || err));
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
    });
  }

  function describe(cmd) {
    let text = ACTION_LABEL[cmd.type] || cmd.type;
    if (cmd.type === 'set' || cmd.type === 'adjust') text += ' ' + (cmd.ms < 0 ? '−' : '') + core.durationLabel(cmd.ms || 0);
    if (cmd.type === 'mode') text += ' (' + (cmd.mode === 'stopwatch' ? 'cronômetro' : 'temporizador') + ')';
    if (cmd.target && cmd.type !== 'mode') text += ' (' + (cmd.target === 'stopwatch' ? 'cronômetro' : 'temporizador') + ')';
    return text;
  }

  // ------------------------------------------------------------- persistence

  function scheduleSave() {
    if (!stateFile) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const tmp = stateFile + '.tmp';
      fs.writeFile(tmp, JSON.stringify(state), (err) => {
        if (err) return log('Não foi possível salvar o estado: ' + err.message);
        fs.rename(tmp, stateFile, (err2) => {
          if (err2) log('Não foi possível salvar o estado: ' + err2.message);
        });
      });
    }, 250);
  }

  function flushState() {
    if (!stateFile || !saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      fs.writeFileSync(stateFile, JSON.stringify(state));
    } catch (err) {
      log('Não foi possível salvar o estado: ' + err.message);
    }
  }

  function closeClients() {
    clients.forEach((c) => c.res.end());
    clients.clear();
  }

  return {
    server,
    instance,
    getState: () => state,
    getClients: clientList,
    flush: flushState,
    close(callback) {
      closeClients();
      server.close(callback);
    }
  };
}

// -------------------------------------------------------------------- helpers

function loadState(file, log) {
  if (!file) return core.initialState();
  try {
    const text = fs.readFileSync(file, 'utf8');
    return core.normalize(JSON.parse(text));
  } catch (err) {
    if (err.code !== 'ENOENT') log('Estado salvo ilegível (' + err.message + '); começando do zero.');
    return core.initialState();
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) reject(Object.assign(new Error('too large'), { status: 413 }));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

function serveStatic(pathname, req, res) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (e) {
    return sendText(res, 400, 'Endereço inválido');
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || rel.indexOf('\0') !== -1) return sendText(res, 404, 'Não encontrado');
  fs.readFile(file, (err, data) => {
    if (err) return sendText(res, 404, 'Não encontrado');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

// IPv4 addresses other devices can use to reach this computer, best first.
function lanAddresses(port) {
  const list = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach((name) => {
    (ifaces[name] || []).forEach((a) => {
      const family = typeof a.family === 'number' ? 'IPv' + a.family : a.family;
      if (family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) return;
      list.push({
        name,
        address: a.address,
        url: 'http://' + a.address + (port ? ':' + port : '') + '/',
        virtual: VIRTUAL_IFACE.test(name)
      });
    });
  });
  const rank = (a) => (a.virtual ? 10 : 0) + (/^192\.168\./.test(a.address) ? 0 : /^10\./.test(a.address) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 3);
  return list.sort((a, b) => rank(a) - rank(b));
}

function deviceFromUserAgent(ua) {
  ua = String(ua || '');
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Celular Android' : 'Tablet Android';
  if (/Windows/.test(ua)) return 'PC Windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Aparelho';
}

// ------------------------------------------------------------- command line

function parseArgs(argv) {
  const args = { open: false, qr: true, port: null, host: null };
  argv.forEach((arg) => {
    const m = /^--?([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) return;
    const key = m[1].toLowerCase();
    if (key === 'abrir' || key === 'open') args.open = true;
    else if (key === 'sem-qr' || key === 'no-qr') args.qr = false;
    else if ((key === 'porta' || key === 'port') && m[2]) args.port = parseInt(m[2], 10) || null;
    else if (key === 'host' && m[2]) args.host = m[2];
  });
  return args;
}

function openBrowser(url) {
  let child;
  try {
    if (process.platform === 'win32') {
      child = spawn('cmd.exe', ['/c', 'start ""', '"' + url + '"'], { windowsVerbatimArguments: true, stdio: 'ignore', detached: true });
    } else {
      child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true });
    }
    child.on('error', () => {});
    child.unref();
  } catch (e) {
    // Opening the browser is a convenience; the URL is printed anyway.
  }
}

function isOurServer(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/info', timeout: 1500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).app === APP_ID);
        } catch (e) {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

// QR code drawn with half blocks, black on white, so a phone camera can scan it.
function terminalQr(text) {
  const qrcode = require('./public/vendor/qrcode.js');
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
  const lines = [];
  for (let r = -quiet; r < n + quiet; r += 2) {
    let line = '';
    for (let c = -quiet; c < n + quiet; c++) {
      const top = dark(r, c);
      const bottom = dark(r + 1, c);
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push('    \x1b[30;47m' + line + '\x1b[0m');
  }
  return lines.join('\n');
}

function timestamp() {
  const d = new Date();
  return core.pad2(d.getHours()) + ':' + core.pad2(d.getMinutes()) + ':' + core.pad2(d.getSeconds());
}

function printBanner(port, args) {
  const addresses = lanAddresses(port);
  const main = addresses[0];
  const out = [''];
  out.push('  ⏱  Cronômetro Sync está funcionando!');
  out.push('');
  if (main) {
    out.push('  Nos outros aparelhos (iPad, iPhone, outro PC) conectados à MESMA rede Wi-Fi,');
    out.push('  abra no navegador:');
    out.push('');
    out.push('      \x1b[1m' + main.url.replace(/\/$/, '') + '\x1b[0m');
    out.push('');
    if (args.qr && process.stdout.isTTY) {
      out.push('  ou aponte a câmera do iPhone/iPad para o código:');
      out.push('');
      out.push(terminalQr(main.url));
      out.push('');
    }
    if (addresses.length > 1) {
      out.push('  Outros endereços deste computador (se o de cima não abrir):');
      addresses.slice(1).forEach((a) => out.push('      ' + a.url.replace(/\/$/, '') + '   (' + a.name + ')'));
      out.push('');
    }
  } else {
    out.push('  \x1b[33mEste computador não parece estar conectado a uma rede.\x1b[0m');
    out.push('  Conecte-o ao Wi-Fi (o mesmo do iPad/iPhone) e abra este programa de novo.');
    out.push('');
  }
  out.push('  Neste computador: http://localhost:' + port);
  out.push('');
  out.push('  Deixe esta janela aberta enquanto estiver usando. Para encerrar: Ctrl + C');
  out.push('');
  console.log(out.join('\n'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const firstPort = args.port || parseInt(process.env.PORT, 10) || DEFAULT_PORT;
  const host = args.host || process.env.HOST || null;
  const app = createTimerServer({ log: (line) => console.log('  [' + timestamp() + '] ' + line) });

  const listen = (port, attempt) => {
    const onListening = () => {
      app.server.removeListener('error', onError);
      const actual = app.server.address().port;
      printBanner(actual, args);
      if (args.open) openBrowser('http://localhost:' + actual + '/');
    };
    const onError = (err) => {
      app.server.removeListener('listening', onListening);
      if (err.code === 'EADDRINUSE' && attempt < 10) {
        isOurServer(port).then((ours) => {
          if (!ours) return listen(port + 1, attempt + 1);
          console.log('\n  O Cronômetro Sync já está aberto em http://localhost:' + port + ' (outra janela).\n');
          if (args.open) openBrowser('http://localhost:' + port + '/');
          process.exit(0);
        });
        return;
      }
      if (err.code === 'EACCES') console.error('\n  Sem permissão para usar a porta ' + port + '. Tente: node server.js --porta=8080\n');
      else console.error('\n  Não foi possível iniciar o servidor: ' + err.message + '\n');
      process.exit(1);
    };
    app.server.once('error', onError);
    app.server.once('listening', onListening);
    // No host: every IPv4 and IPv6 address, so "localhost" always reaches us.
    if (host) app.server.listen(port, host);
    else app.server.listen(port);
  };
  listen(firstPort, 0);

  const shutdown = () => {
    console.log('\n  Encerrando… até a próxima!\n');
    app.flush();
    app.close(() => process.exit(0)); // ends the live streams cleanly
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown); // console window closed (Windows)
  // During a presentation, staying up beats crashing on an unexpected error.
  process.on('uncaughtException', (err) => console.error('  Erro inesperado:', err && err.stack || err));
}

if (require.main === module) main();

module.exports = { createTimerServer, lanAddresses, deviceFromUserAgent, parseArgs, APP_ID };
