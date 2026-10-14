'use strict';

/*
 * Checks firebase-rules.json against the Realtime Database emulator.
 * Skipped unless the emulator is running; from the cronometro folder:
 *
 *   npx firebase-tools emulators:exec --only database --project demo-cronometro \
 *     "node --test test/rules.test.js"
 *
 * (firebase.json points the emulator at firebase-rules.json.)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/core.js');

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const NS = process.env.FIREBASE_DATABASE_NAMESPACE || 'demo-cronometro-default-rtdb';
const skip = HOST ? false : 'emulador do Firebase não está rodando (veja o topo deste arquivo)';

const ROOM = 'K7M2Q9XR';

async function call(method, path, body) {
  const res = await fetch('http://' + HOST + '/' + path + '.json?ns=' + NS, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, ok: res.ok, data: await res.json().catch(() => null) };
}

const put = (path, body) => call('PUT', path, body);
const allowed = (r, what) => assert.equal(r.ok, true, what + ' deveria ser aceito: ' + JSON.stringify(r));
const denied = (r, what) => assert.equal(r.status, 401, what + ' deveria ser recusado: ' + JSON.stringify(r));

// Same random numbers every run.
function prng(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomText(rand, max) {
  const pieces = ['Faltam 5 minutos', '😀', 'Conclua', '  espaços  ', 'a'.repeat(30), 'ção — ü', "<script>'\"</script>", '\n', 'Logística'];
  let out = '';
  while (out.length < max * rand() * 1.5) out += pieces[Math.floor(rand() * pieces.length)];
  return out;
}

function randomCommand(rand) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const target = pick(['timer', 'stopwatch']);
  const id = 'p' + String(1 + Math.floor(rand() * 25)).padStart(2, '0');
  switch (pick(['start', 'start', 'pause', 'reset', 'restart', 'set', 'adjust', 'adjust', 'lap', 'lap', 'mode', 'title', 'message', 'settings',
    'select', 'select', 'select', 'finish', 'finish', 'finish', 'clearResult', 'alert', 'alert'])) {
    case 'select': return { type: 'select', id, ms: (1 + Math.floor(rand() * 15)) * 60000, force: rand() < 0.5 };
    case 'finish': return { type: 'finish' };
    case 'alert': return { type: 'alert', kind: pick(['half', 'last']), text: pick(['Metade do tempo: faltam 4 minutos', 'Falta 1 minuto']) };
    case 'clearResult': return { type: 'clearResult', id: rand() < 0.1 ? '*' : id };
    case 'start': return { type: 'start', target };
    case 'pause': return { type: 'pause', target };
    case 'reset': return { type: 'reset', target };
    case 'restart': return { type: 'restart', target };
    case 'set': return { type: 'set', ms: Math.floor(rand() * 7200) * 1000 - 1000, start: rand() < 0.5 };
    case 'adjust': return { type: 'adjust', ms: pick([-60000, -10000, 10000, 60000, 1500]) };
    case 'lap': return { type: 'lap' };
    case 'mode': return { type: 'mode', mode: pick(['timer', 'stopwatch', 'timer']) };
    case 'title': return { type: 'title', text: randomText(rand, 100) };
    case 'message': return { type: 'message', text: randomText(rand, 200), flash: rand() < 0.5 };
    default: return { type: 'settings', warnAt: pick([0, 10000, 120000, 3600000]), dangerAt: pick([0, 5000, 60000]), overtime: rand() < 0.5 };
  }
}

test('every state the app can produce is accepted', { skip }, async () => {
  const rand = prng(42);
  const clients = [{ id: 'tab-1', name: 'iPad · Safari' }, { id: 'a'.repeat(16), name: 'Notebook do Tiago' }, null];
  let state = core.initialState();
  let now = 1700000000000;
  let writes = 0;
  let maxLaps = 0;
  for (let i = 0; i < 1500; i++) {
    now += Math.floor(rand() * 4000);
    state = core.apply(state, randomCommand(rand), now, clients[Math.floor(rand() * clients.length)]);
    if (i % 3 === 0 || i < 40) {
      // The database drops empty lists and nulls, exactly like this round trip does.
      const res = await put('salas/' + ROOM + '/estado', JSON.parse(JSON.stringify(state)));
      allowed(res, 'estado #' + i + ' ' + JSON.stringify(state).slice(0, 200));
      writes++;
    }
    maxLaps = Math.max(maxLaps, state.stopwatch.laps.length);
  }
  assert.ok(writes > 400);
  assert.ok(maxLaps >= 5, 'o teste deve passar por cronômetros com várias voltas (teve ' + maxLaps + ')');

  // What comes back is the same state, once normalized.
  const back = await call('GET', 'salas/' + ROOM + '/estado');
  assert.equal(back.status, 200);
  assert.equal(core.normalize(back.data).rev > 0, true);
});

test('the longest texts the app allows are accepted, emoji included', { skip }, async () => {
  let state = core.apply(core.initialState(), { type: 'title', text: '😀'.repeat(200) }, 1700000000000, { id: '😀'.repeat(100), name: '😀'.repeat(60) });
  state = core.apply(state, { type: 'message', text: '😀'.repeat(300), flash: true }, 1700000001000, { id: '😀'.repeat(100), name: '😀'.repeat(60) });
  assert.equal(Array.from(state.title).length, core.MAX_TITLE);
  assert.equal(Array.from(state.message.text).length, core.MAX_MESSAGE);
  allowed(await put('salas/' + ROOM + '/estado', state), 'textos longos com emoji');
  allowed(await put('salas/' + ROOM + '/aparelhos/dev1', { nome: '😀'.repeat(core.MAX_NAME) }), 'nome longo com emoji');
});

test('a day of presentations, with points lost, is accepted', { skip }, async () => {
  let state = core.initialState();
  let now = 1700000000000;
  for (let n = 1; n <= 25; n++) {
    const id = 'p' + String(n).padStart(2, '0');
    state = core.apply(state, { type: 'select', id, ms: 8 * 60000 }, now, { id: 'op', name: 'iPhone · Safari' });
    state = core.apply(state, { type: 'start', target: 'timer' }, now, null);
    now += 8 * 60000 + (n % 4) * 70000;
    state = core.apply(state, { type: 'finish' }, now, { id: 'op', name: 'iPhone · Safari' });
    allowed(await put('salas/' + ROOM + '/estado', state), 'depois da apresentação ' + n);
  }
  assert.equal(Object.keys(state.agenda.results).length, 25);
  assert.ok(Object.values(state.agenda.results).some((r) => r.points > 0));
});

test('the automatic messages (half time, last minute) are accepted', { skip }, async () => {
  const who = { id: 'op', name: 'iPhone' };
  let state = core.apply(core.initialState(), { type: 'select', id: 'p09', ms: 12 * 60000 }, 1700000000000, who);
  state = core.apply(state, { type: 'start', target: 'timer' }, 1700000000000, who);
  state = core.apply(state, { type: 'alert', kind: 'half', text: 'Metade do tempo: faltam 6 minutos' }, 1700000000000 + 6 * 60000, who);
  assert.equal(state.agenda.sent.half, true);
  assert.ok(state.message.until);
  allowed(await put('salas/' + ROOM + '/estado', state), 'depois do aviso da metade');
  state = core.apply(state, { type: 'alert', kind: 'last', text: 'Falta 1 minuto' }, 1700000000000 + 11 * 60000, who);
  assert.deepEqual(state.agenda.sent, { half: true, last: true });
  allowed(await put('salas/' + ROOM + '/estado', state), 'depois do aviso de 1 minuto');
});

test('a full lap list (99 laps) is accepted', { skip }, async () => {
  let state = core.apply(core.initialState(), { type: 'mode', mode: 'stopwatch' }, 1700000000000, null);
  state = core.apply(state, { type: 'start', target: 'stopwatch' }, 1700000000000, null);
  for (let i = 0; i < 120; i++) state = core.apply(state, { type: 'lap' }, 1700000000000 + 1000 * (i + 1), null);
  assert.equal(state.stopwatch.laps.length, core.MAX_LAPS);
  allowed(await put('salas/' + ROOM + '/estado', state), '99 voltas');
});

test('devices can list themselves in the room', { skip }, async () => {
  allowed(await put('salas/' + ROOM + '/aparelhos/abc123', { nome: 'iPhone · Safari', desde: 1700000000000 }), 'aparelho');
  allowed(await put('salas/' + ROOM + '/aparelhos/abc123/nome', 'Outro nome'), 'novo nome');
  allowed(await call('DELETE', 'salas/' + ROOM + '/aparelhos/abc123'), 'saída do aparelho');
});

test('bad rooms and bad places are refused', { skip }, async () => {
  const valid = core.initialState();
  denied(await put('salas/abc/estado', valid), 'sala curta');
  denied(await put('salas/k7m2q9xr/estado', valid), 'sala em minúsculas');
  denied(await put('salas/K7M2Q9XR1/estado', valid), 'sala longa demais');
  denied(await put('salas/K7M2-Q9X/estado', valid), 'sala com hífen');
  denied(await put('outros/x', { a: 1 }), 'outro caminho');
  denied(await put('salas/' + ROOM + '/segredo', 'x'), 'dado fora do formato');
  denied(await call('GET', 'salas'), 'listar as salas');
  denied(await call('GET', ''), 'ler o banco inteiro');
});

test('bad data inside a room is refused', { skip }, async () => {
  const base = JSON.parse(JSON.stringify(core.initialState()));
  const bad = (mutate, what) => {
    const copy = JSON.parse(JSON.stringify(base));
    mutate(copy);
    return put('salas/' + ROOM + '/estado', copy).then((r) => denied(r, what));
  };
  allowed(await put('salas/' + ROOM + '/estado', base), 'estado inicial');
  await bad((s) => { s.hack = 1; }, 'campo desconhecido');
  await bad((s) => { s.title = 'x'.repeat(161); }, 'título com 161 unidades');
  await bad((s) => { s.message.text = 'x'.repeat(281); }, 'mensagem com 281 unidades');
  await bad((s) => { s.mode = 'outro'; }, 'tela inválida');
  await bad((s) => { s.rev = 'abc'; }, 'rev que não é número');
  await bad((s) => { delete s.timer; }, 'sem temporizador');
  await bad((s) => { s.timer.extra = 1; }, 'campo extra no temporizador');
  await bad((s) => { s.settings.overtime = 'sim'; }, 'ajuste que não é verdadeiro/falso');
  await bad((s) => { s.stopwatch.laps = { 100: 5 }; }, 'volta número 100');
  await bad((s) => { s.stopwatch.laps = { 0: 'a' }; }, 'volta que não é número');
  await bad((s) => { s.last = { type: 'x'.repeat(21), at: 1 }; }, 'tipo longo demais');
  await bad((s) => { s.last = { type: 'start', by: { id: 'a', name: 'n'.repeat(81) } }; }, 'nome longo demais');
  const withAgenda = (agenda) => (s) => { s.agenda = agenda; };
  const goodResult = { used: 1000, allowed: 2000, points: 0 };
  await bad(withAgenda({ current: 'x'.repeat(25) }), 'id da apresentação longo demais');
  await bad(withAgenda({ results: { 'MAIÚSCULA': goodResult } }), 'id com caracteres inválidos');
  await bad(withAgenda({ results: { p01: { used: 1000, allowed: 2000 } } }), 'resultado sem pontos');
  await bad(withAgenda({ results: { p01: { used: 'x', allowed: 2000, points: 0 } } }), 'tempo que não é número');
  await bad(withAgenda({ results: { p01: { ...goodResult, extra: 1 } } }), 'campo extra no resultado');
  await bad(withAgenda({ results: { p01: { ...goodResult, by: 'n'.repeat(81) } } }), 'nome longo demais no resultado');
  await bad(withAgenda({ outro: 1 }), 'campo extra na agenda');
  await bad(withAgenda({ sent: { half: 'sim' } }), 'aviso enviado que não é verdadeiro/falso');
  await bad(withAgenda({ sent: { half: true, extra: true } }), 'campo extra nos avisos enviados');
  await bad((s) => { s.message.until = 'amanhã'; }, 'validade da mensagem que não é número');
  await bad((s) => { s.message.until = 5; s.message.extra = 1; }, 'campo extra na mensagem');
  denied(await put('salas/' + ROOM + '/aparelhos/abc', { desde: 1 }), 'aparelho sem nome');
  denied(await put('salas/' + ROOM + '/aparelhos/abc', { nome: 'n'.repeat(81) }), 'aparelho com nome longo');
  denied(await put('salas/' + ROOM + '/aparelhos/abc', { nome: 'ok', extra: 1 }), 'aparelho com campo extra');
  denied(await put('salas/' + ROOM + '/aparelhos/' + 'i'.repeat(129), { nome: 'ok' }), 'identificador longo demais');
});
