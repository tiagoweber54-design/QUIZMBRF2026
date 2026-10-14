// Pescaria 3D — lógica principal.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { criarPeixe } from '../peixes/gerador.js';
import { ESPECIES, POR_ID } from '../peixes/especies.js';
import { COMPORTAMENTO, ISCAS, LINHAS, PROFUNDIDADES } from './comportamento.js';
import { criarMundo, depthAt, emGalhada, onda, elevSol, JOGADOR } from './mundo.js';
import { Som } from './som.js';

/* ============================== utilidades ============================== */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x, m, s) => Math.exp(-((x - m) ** 2) / (2 * s * s));
const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
const fmtKg = kg => kg < 1 ? `${Math.round(kg * 1000)} g` : `${fmt(kg, 2)} kg`;
const fmtCm = m => m < 1 ? `${Math.round(m * 100)} cm` : `${fmt(m, 2)} m`;
const angDif = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const V = () => new THREE.Vector3();

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
};

/* ============================== renderizador ============================== */
const touch = matchMedia('(pointer:coarse)').matches;
const QUAL = store.get('pesca3d_qualidade', touch ? 'baixa' : 'alta');
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUAL === 'alta', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, QUAL === 'alta' ? 2 : 1.25));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .82;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setScissorTest(false);

const scene = new THREE.Scene();
const fogAr = new THREE.Fog(0xa9c4d6, 60, 1100);
const fogSub = new THREE.FogExp2(0x2f5a4a, .2);
scene.fog = fogAr;
const camera = new THREE.PerspectiveCamera(60, 1, .05, 6000);
camera.position.copy(JOGADOR); camera.rotation.order = 'YXZ'; camera.layers.enable(1); scene.add(camera);
const camSub = new THREE.PerspectiveCamera(55, 1.5, .03, 60); camSub.position.set(0, -1, -8);
const envTex = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;

const mundo = criarMundo(scene, renderer, { qualidade: QUAL });
// lanterna de cabeça (à noite)
const lanterna = new THREE.SpotLight(0xfff2d8, 0, 40, .5, .6, 1.2); lanterna.position.set(0, .1, 0); lanterna.target.position.set(0, -.6, -4);
camera.add(lanterna, lanterna.target);

/* ============================== estado ============================== */
const save = Object.assign({ log: {}, pts: 0, kg: 0, n: 0, soltos: 0 }, store.get('pesca3d_save', {}));
const persist = () => store.set('pesca3d_save', save);
const G = {
  estado: 'carregando', hora: 6.0, recolhendo: false, forca: 0, fdir: 1, freio: 2.5,
  isca: 'minhoca', prof: 2, linha: 1, pts: save.pts || 0,
  yaw: 0, pitch: -.06, varaA: .38, varaAlvo: .38, puxao: 0, tranco: 0,
  clima: null, climaT: 0, nuvens: .35, vento: 6, ventoAlvo: 6, mod: 1, statusT: 0, hudT: 0, luz: 1, dia: 1, pip: true,
};
const CLIMAS = [
  { nome: 'Ensolarado', nuvens: .08, vento: [2, 8], mod: .9, w: 3 },
  { nome: 'Parcialmente nublado', nuvens: .4, vento: [4, 12], mod: 1, w: 3 },
  { nome: 'Nublado', nuvens: .8, vento: [3, 10], mod: 1.15, w: 2 },
  { nome: 'Ventania', nuvens: .5, vento: [16, 26], mod: .75, w: .8 },
];
G.clima = CLIMAS[1];
const linha = () => LINHAS[G.linha];
const REEL = 1.6, SPOOL = 150, TEMPO = 1 / 60, NPEIXES = store.get('pesca3d_n', touch ? 18 : 24);

const diaF = () => smooth((elevSol(G.hora) + .1) / .35);
const ddF = () => Math.max(gauss(G.hora, 6.3, 1.3), gauss(G.hora, 18.3, 1.3));
const atividade = cb => { const d = diaF(); return clamp(cb.act.b + (cb.act.dd || 0) * ddF() + (cb.act.dia || 0) * d + (cb.act.noite || 0) * (1 - d), .08, 1.25); };
const periodo = h => h < 5 ? 'Madrugada' : h < 7 ? 'Amanhecer' : h < 11 ? 'Manhã' : h < 13 ? 'Meio-dia' : h < 17 ? 'Tarde' : h < 19 ? 'Entardecer' : 'Noite';
const dirYaw = (a, out = V()) => out.set(-Math.sin(a), 0, -Math.cos(a));

/* ============================== equipamento ============================== */
// isca / anzol
const isca = { pos: V(), naAgua: false, tem: true, tipo: 'minhoca', rig: 'boia', alvoProf: 1.5, soak: 0, movendo: false, toque: 0, splashT: 0, peixe: null, dip: 0, dipV: 0 };
const matBoia = [new THREE.MeshStandardMaterial({ color: 0xe8401c, roughness: .4 }), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: .4 })];
const boia = new THREE.Group();
{
  const a = new THREE.Mesh(new THREE.SphereGeometry(.022, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), matBoia[0]);
  const b = new THREE.Mesh(new THREE.SphereGeometry(.022, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), matBoia[1]); b.scale.y = 1.6;
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(.003, .003, .07), new THREE.MeshStandardMaterial({ color: 0x77ff88, emissive: 0x33ff55, emissiveIntensity: 0 })); ant.position.y = .05;
  boia.add(a, b, ant); boia.userData.antena = ant; boia.visible = false; scene.add(boia);
}
const chumbo = new THREE.Mesh(new THREE.SphereGeometry(.007, 10, 8), new THREE.MeshStandardMaterial({ color: 0x777b80, metalness: .6, roughness: .4 }));
const anzol = new THREE.Group(); anzol.add(chumbo); scene.add(anzol); anzol.visible = false;
const iscasMesh = {};
{
  const minh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V().set(-.03, 0, 0), V().set(-.01, .012, .005), V().set(.01, -.01, 0), V().set(.03, .006, -.005)]), 20, .0035, 6), new THREE.MeshStandardMaterial({ color: 0xc06070, roughness: .35 }));
  const milho = new THREE.Group(); for (let i = 0; i < 3; i++) { const g = new THREE.Mesh(new THREE.SphereGeometry(.005, 8, 6), new THREE.MeshStandardMaterial({ color: 0xf6c63a, roughness: .4 })); g.position.set((i - 1) * .008, (i % 2) * .004, 0); milho.add(g); }
  const massa = new THREE.Mesh(new THREE.SphereGeometry(.009, 12, 8), new THREE.MeshStandardMaterial({ color: 0xdccca0, roughness: .8 }));
  const art = new THREE.Group();
  { const corpo = new THREE.Mesh(new THREE.CapsuleGeometry(.008, .045, 6, 12), new THREE.MeshStandardMaterial({ color: 0xf0d038, roughness: .3, metalness: .2 })); corpo.rotation.z = Math.PI / 2;
    const cab = new THREE.Mesh(new THREE.SphereGeometry(.0085, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd02a2a, roughness: .3 })); cab.position.x = .025;
    const bico = new THREE.Mesh(new THREE.BoxGeometry(.012, .001, .01), new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: .6 })); bico.position.set(.036, -.004, 0); bico.rotation.z = -.5;
    art.add(corpo, cab, bico); }
  iscasMesh.minhoca = minh; iscasMesh.milho = milho; iscasMesh.massa = massa; iscasMesh.artificial = art;
  for (const k in iscasMesh) { iscasMesh[k].visible = false; anzol.add(iscasMesh[k]); }
}
let iscaViva = null; // lambari vivo (modelo real do gerador)
// linha
const NL = 40;
const linhaGeo = new THREE.BufferGeometry(); linhaGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NL * 3), 3));
const linhaMat = new THREE.LineBasicMaterial({ color: 0xe8f0ea, transparent: true, opacity: .75 });
const linhaObj = new THREE.Line(linhaGeo, linhaMat); linhaObj.frustumCulled = false; scene.add(linhaObj);
const lider = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]), linhaMat); lider.frustumCulled = false; scene.add(lider);
// vara (tubo afinado recalculado por quadro)
const VSEG = 28, VRAD = 8, VLEN = 2.4;
const varaGeo = new THREE.BufferGeometry();
{
  const idx = []; for (let i = 0; i < VSEG; i++) for (let j = 0; j < VRAD; j++) { const a = i * (VRAD + 1) + j, b = a + VRAD + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  varaGeo.setIndex(idx); varaGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((VSEG + 1) * (VRAD + 1) * 3), 3));
}
const vara = new THREE.Mesh(varaGeo, new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: .35, metalness: .3 })); vara.frustumCulled = false; scene.add(vara);
const carretilha = new THREE.Group();
{
  const m = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: .8, roughness: .3 });
  const corpo = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .05, 20), m); corpo.rotation.z = Math.PI / 2;
  const man = new THREE.Group(); const braco = new THREE.Mesh(new THREE.BoxGeometry(.006, .06, .01), m); braco.position.y = .03;
  const pega = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .025, 10), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: .6 })); pega.rotation.z = Math.PI / 2; pega.position.set(.015, .06, 0);
  man.add(braco, pega); man.position.x = .03; carretilha.add(corpo, man); carretilha.userData.manivela = man;
}
camera.add(carretilha);

/* ============================== partículas ============================== */
const ondulacoes = [];
const anelGeo = new THREE.RingGeometry(.9, 1, 40); anelGeo.rotateX(-Math.PI / 2);
function ondulacao(x, z, r = .3, v = 1.2) {
  const m = new THREE.Mesh(anelGeo, new THREE.MeshBasicMaterial({ color: 0xe8f4f0, transparent: true, opacity: .55, depthWrite: false }));
  m.position.set(x, .015, z); m.scale.setScalar(r); scene.add(m); ondulacoes.push({ m, v, a: .55 });
}
const gotas = [];
const gotaGeo = new THREE.SphereGeometry(1, 6, 4), gotaMat = new THREE.MeshBasicMaterial({ color: 0xdff0ee, transparent: true, opacity: .85 });
function respingo(x, z, s = .5) {
  for (let i = 0; i < 3; i++) ondulacao(x, z, .15 + i * .15, .8 + i * .5 + s);
  for (let i = 0; i < 10 + s * 25; i++) {
    const m = new THREE.Mesh(gotaGeo, gotaMat); m.scale.setScalar(rand(.006, .016) * (1 + s));
    m.position.set(x, .02, z); scene.add(m); gotas.push({ m, v: V().set(rand(-1, 1) * s * 1.6, rand(1.2, 3.2) * (.5 + s), rand(-1, 1) * s * 1.6) });
  }
}

/* ============================== peixes ============================== */
const peixes = [];
const filaReposicao = [];
function sortearEspecie() {
  let tot = 0; const ws = ESPECIES.map(s => { const cb = COMPORTAMENTO[s.id]; const w = cb.ab * (.5 + atividade(cb) * .6); tot += w; return w; });
  let r = Math.random() * tot; for (let i = 0; i < ESPECIES.length; i++) { r -= ws[i]; if (r <= 0) return ESPECIES[i]; }
  return ESPECIES[0];
}
function aplicarEnv(g, k = .8) { g.traverse(o => { if (o.material) { o.material.envMap = envTex; o.material.envMapIntensity = k; } }); }
function criarIndividuo(sp, local, entrando) {
  sp = sp || sortearEspecie();
  const cb = COMPORTAMENTO[sp.id];
  const L = lerp(sp.tl * .45, sp.tlMax * .97, Math.pow(Math.random(), 2.4));
  const kg = Math.min(sp.kgMax, cb.kgTl * Math.pow(L / sp.tl, 3.05));
  const mesh = criarPeixe(sp, { res: 512, finRes: 128, nt: 64, na: 36 });
  mesh.scale.setScalar(L); mesh.rotation.order = 'YZX'; aplicarEnv(mesh); scene.add(mesh);
  const f = { sp, cb, L, kg, mesh, pos: V(), vel: V(), alvo: V(), estado: 'vagando', tt: 0, cool: 0, paciencia: 0, nib: 0, nibT: 0, mordT: 0, yaw: rand(0, 6), ta: rand(0, 10) };
  if (local) f.pos.copy(local);
  else {
    for (let i = 0; i < 40; i++) {
      const x = rand(-70, 70), z = entrando ? rand(-110, -80) : rand(-95, -4), d = depthAt(x, z);
      if (d >= cb.d[0] + .4) { f.pos.set(x, 0, z); break; }
    }
    const dep = depthAt(f.pos.x, f.pos.z);
    f.pos.y = -(cb.fundo ? dep - rand(.15, .4) : clamp(rand(cb.d[0], cb.d[1]), .2, dep - .2));
  }
  escolherAlvo(f); peixes.push(f); return f;
}
function removerPeixe(f) { const i = peixes.indexOf(f); if (i >= 0) peixes.splice(i, 1); scene.remove(f.mesh); f.mesh.userData.dispose(); }
const PX = { x: JOGADOR.x, z: JOGADOR.z };
function escolherAlvo(f) {
  const cb = f.cb;
  if (G.estado === 'agua' && isca.naAgua && isca.tem && isca.tipo !== 'artificial') {
    const cheiro = Math.min(1, .2 + isca.soak / 30);
    if (Math.random() < .35 * cheiro * (cb.pref[isca.tipo] || 0) * atividade(cb)) {
      f.alvo.set(isca.pos.x + rand(-5, 5), 0, isca.pos.z + rand(-5, 5));
      const d = depthAt(f.alvo.x, f.alvo.z); f.alvo.y = -clamp(-isca.pos.y + rand(-.8, .8), .2, Math.max(.2, d - .2)); f.tt = rand(6, 14); return;
    }
  }
  let x = f.pos.x, z = f.pos.z;
  for (let i = 0; i < 12; i++) {
    x = clamp(f.pos.x + rand(-16, 16), -80, 80); z = clamp(f.pos.z + rand(-16, 16), -110, -3);
    const d = depthAt(x, z); if (d >= cb.d[0] + .35 && (cb.fundo || d <= cb.d[1] + 3.5)) break;
  }
  const d = depthAt(x, z);
  f.alvo.set(x, -(cb.fundo ? Math.max(.2, d - rand(.15, .4)) : clamp(rand(cb.d[0], cb.d[1]), .2, Math.max(.2, d - .2))), z);
  f.tt = rand(5, 16);
}
const _d = V();
function moverPeixe(f, alvo, spd, dt, giro = 2) {
  _d.subVectors(alvo, f.pos); const dist = _d.length() || 1, want = Math.min(spd, dist * 1.5), k = Math.min(1, dt * giro);
  f.vel.x += (_d.x / dist * want - f.vel.x) * k; f.vel.z += (_d.z / dist * want - f.vel.z) * k; f.vel.y += (_d.y / dist * want * .6 - f.vel.y) * k;
  const ox = f.pos.x, oz = f.pos.z;
  f.pos.addScaledVector(f.vel, dt);
  let dep = depthAt(f.pos.x, f.pos.z);
  if (dep < .3) { f.pos.x = ox; f.pos.z = oz; f.vel.multiplyScalar(-.3); f.tt = 0; dep = depthAt(ox, oz); }
  f.pos.y = clamp(f.pos.y, -Math.max(.15, dep - .1), -.12);
  return dist;
}
function orientar(f, dt, alvoYaw) {
  const h = Math.hypot(f.vel.x, f.vel.z);
  const y = alvoYaw ?? (h > .02 ? Math.atan2(-f.vel.z, f.vel.x) : f.yaw);
  f.yaw += angDif(f.yaw, y) * Math.min(1, dt * 4);
  f.mesh.position.copy(f.pos);
  f.mesh.rotation.set(0, f.yaw, clamp(f.vel.y / (h + .05), -.5, .5) * .6);
  f.ta += dt * (1 + Math.min(2, (h + Math.abs(f.vel.y)) / Math.max(.15, f.cb.forca * .4)) * 1.4);
  f.mesh.userData.nadar(f.ta);
}
const noseOff = f => f.L * .47;
function atualizarPeixe(f, dt) {
  if (f.estado === 'fisgado' || f.estado === 'capturado') return;
  const cb = f.cb;
  f.cool = Math.max(0, f.cool - dt);
  if (f.estado === 'vagando' || f.estado === 'fugindo') {
    f.tt -= dt;
    const spd = (.25 + .35 * cb.forca) * (.35 + .5 * atividade(cb)) * (f.estado === 'fugindo' ? 3.2 : 1);
    const dist = moverPeixe(f, f.alvo, spd, dt);
    if (f.tt <= 0 || dist < .4) { if (f.estado === 'fugindo' && f.cool <= 0) f.estado = 'vagando'; escolherAlvo(f); }
    if (f.estado === 'vagando') considerarIsca(f, dt);
    orientar(f, dt); return;
  }
  const lure = isca.tipo === 'artificial';
  if (G.estado !== 'agua' || !isca.naAgua || !isca.tem) { if (isca.peixe === f) isca.peixe = null; f.estado = 'vagando'; escolherAlvo(f); orientar(f, dt); return; }
  const lado = _d.subVectors(f.pos, isca.pos).setY(0); if (lado.lengthSq() < 1e-4) lado.set(1, 0, 0); lado.normalize();
  const yawIsca = Math.atan2(lado.z, -lado.x); // virado para a isca
  if (f.estado === 'aproximando') {
    const ocupado = isca.peixe && isca.peixe !== f;
    const off = noseOff(f) * (ocupado ? 3 : 1);
    const alvo = V().copy(isca.pos).addScaledVector(lado, off); if (ocupado) alvo.y += .2;
    const dist = moverPeixe(f, alvo, lure ? (.6 + cb.forca) * 1.2 : (.25 + .35 * cb.forca) * .95, dt, lure ? 4 : 2);
    f.paciencia -= dt * (ocupado ? 1.5 : 1) * (lure && !isca.movendo && isca.toque <= 0 ? 2 : 1);
    const dj = Math.hypot(isca.pos.x - PX.x, isca.pos.z - PX.z);
    if (f.paciencia <= 0 || (lure && dj < 3)) { f.estado = 'vagando'; f.cool = rand(6, 14); escolherAlvo(f); orientar(f, dt); return; }
    if (!ocupado && dist < .1 + f.L * .08) {
      isca.peixe = f;
      if (lure) iniciarMordida(f); else { f.estado = 'beliscando'; f.nib = randi(cb.nib[0], cb.nib[1]); f.nibT = rand(.4, 1.4); }
    }
    orientar(f, dt, yawIsca); return;
  }
  const grudar = k => { f.pos.lerp(V().copy(isca.pos).addScaledVector(lado, noseOff(f)), Math.min(1, dt * k)); f.vel.set(0, 0, 0); };
  if (f.estado === 'beliscando') {
    if (isca.movendo && !lure) { assustar(f, .35, 'O peixe largou a isca em movimento'); return; }
    grudar(6); f.nibT -= dt;
    if (f.nibT <= 0) { if (f.nib > 0) { f.nib--; f.nibT = rand(.45, 1.5); beliscada(); } else iniciarMordida(f); }
    orientar(f, dt, yawIsca); f.ta += dt * 4; return;
  }
  if (f.estado === 'mordendo') {
    f.mordT -= dt;
    isca.pos.y = Math.max(-(depthAt(isca.pos.x, isca.pos.z) - .1), isca.pos.y - .25 * dt);
    isca.pos.addScaledVector(lado, -.2 * dt);
    grudar(8); orientar(f, dt, yawIsca); f.ta += dt * 8;
    if (f.mordT <= 0) {
      if (lure) { if (Math.random() < .35) { fisgar(f); return; } assustar(f, 0, 'Cuspiu a isca artificial'); }
      else assustar(f, .55 + (cb.rouba || 0), 'O peixe soltou a isca');
    }
  }
}
function considerarIsca(f, dt) {
  if (G.estado !== 'agua' || !isca.naAgua || !isca.tem || f.cool > 0) return;
  const cb = f.cb, lure = isca.tipo === 'artificial', pref = cb.pref[isca.tipo] || 0;
  if (pref < .02) return;
  const dist = Math.hypot(isca.pos.x - f.pos.x, isca.pos.z - f.pos.z, (isca.pos.y - f.pos.y) * 1.6);
  const sentido = 3 + cb.forca * 2.5;
  const alcance = sentido * (lure ? (isca.movendo || isca.toque > 0 ? 1.5 : isca.splashT > 0 ? 1.7 : .5) : Math.min(1.35, .35 + isca.soak / 16));
  if (dist > alcance) return;
  const prof = -isca.pos.y, fit = cb.fundo ? (depthAt(isca.pos.x, isca.pos.z) - prof < .6 ? 1 : .25) : (prof >= cb.d[0] - .3 && prof <= cb.d[1] + .3 ? 1 : .35);
  const noiteLure = lure ? 1 - .55 * (1 - diaF()) : 1;
  const p = pref * atividade(cb) * G.mod * linha().vis * fit * noiteLure * .55;
  if (Math.random() < p * dt) { f.estado = 'aproximando'; f.paciencia = lure ? rand(3, 7) : rand(8, 18); }
}
function assustar(f, roubo, msg) {
  if (isca.peixe === f) isca.peixe = null;
  f.estado = 'fugindo'; f.cool = rand(10, 22);
  const lado = V().subVectors(f.pos, isca.pos).setY(0).normalize();
  f.alvo.copy(f.pos).addScaledVector(lado, rand(6, 12)); const d = depthAt(f.alvo.x, f.alvo.z); f.alvo.y = -clamp(-f.pos.y + rand(.2, 1), .2, Math.max(.25, d - .2)); f.tt = rand(4, 8);
  isca.dipV += 1.5;
  if (roubo && Math.random() < roubo && isca.tipo !== 'artificial') { isca.tem = false; toast('A isca foi roubada!', 'Recolha a linha para iscar de novo'); }
  else if (msg) status(msg, 2.2);
}
function beliscada() { isca.dipV -= 3.2; G.puxao = Math.max(G.puxao, .12); Som.belisco(.25); status('Beliscando… espere afundar', 1.4); }
function iniciarMordida(f) {
  f.estado = 'mordendo'; f.mordT = f.cb.jan * rand(.85, 1.25) * (isca.tipo === 'artificial' ? 1 : 1.1);
  if (isca.tipo === 'artificial') {
    G.puxao = .9; Som.baque(.7); ondulacao(isca.pos.x, isca.pos.z, .3, 2); toast('PANCADA!', 'Fisgue agora!');
    if (G.recolhendo && Math.random() < .45) fisgar(f);
  } else { isca.dipV += 6; G.puxao = .45; Som.ploc(); toast(isca.rig === 'boia' ? 'AFUNDOU!' : 'PUXOU!', 'Fisgue agora!'); }
}

/* ============================== ações ============================== */
let voo = null, briga = null, exibicao = null;
function pressionar() {
  Som.init();
  if (!['ocioso', 'agua', 'briga'].includes(G.estado)) return;
  if (G.estado === 'ocioso') { G.estado = 'carregando'; G.forca = 0; G.fdir = 1; return; }
  if (G.estado === 'agua') { fisgada(); G.recolhendo = true; return; }
  if (G.estado === 'briga') G.recolhendo = true;
}
function soltar() { if (G.estado === 'carregando') arremessar(); G.recolhendo = false; }
function arremessar() {
  const p = G.forca;
  if (p < .04) { G.estado = 'ocioso'; return; }
  const dir = dirYaw(G.yaw), lat = V().set(-dir.z, 0, dir.x);
  const dist = 4 + p * 46;
  const alvo = V().set(PX.x, 0, PX.z).addScaledVector(dir, dist + rand(-1, 1)).addScaledVector(lat, rand(-1.2, 1.2) + G.vento * .05 * Math.sin(G.yaw * 3));
  voo = { t: 0, dur: .55 + p * .8, de: pontaVara(), para: alvo, h: 2 + p * 9 };
  G.estado = 'voando'; G.varaAlvo = .12; G.varaA = 1.8; Som.zunido();
  isca.tipo = G.isca;
  isca.rig = G.isca === 'artificial' ? 'artificial' : (PROFUNDIDADES[G.prof] === 'fundo' ? 'fundo' : 'boia');
  status(`Arremesso de ${Math.round(dist)} m`, 1.5);
}
function fisgada() {
  G.tranco = 1; Som.zunido(.5);
  if (G.estado !== 'agua') return;
  const f = isca.peixe, lure = isca.tipo === 'artificial';
  if (f && f.estado === 'mordendo') {
    const ch = (lure ? .92 : .85) * (isca.rig === 'boia' ? 1 : .95);
    if (Math.random() < ch) { fisgar(f); return; }
    toast('Errou a fisgada!'); assustar(f, lure ? 0 : .5); return;
  }
  if (f && f.estado === 'beliscando') {
    if (Math.random() < (f.sp.id === 'lambari' ? .3 : .1)) { fisgar(f); return; }
    status('Fisgada antecipada: o peixe se assustou', 2.2); assustar(f, .35); return;
  }
  const dj = V().set(PX.x - isca.pos.x, 0, PX.z - isca.pos.z).normalize();
  if (lure) { isca.toque = .7; isca.pos.addScaledVector(dj, .35); isca.pos.y = Math.min(-.25, isca.pos.y + .2); }
  else { isca.pos.addScaledVector(dj, .25); for (const g of peixes) if (g.estado === 'aproximando' && Math.random() < .3) { g.estado = 'fugindo'; g.cool = 8; g.tt = 4; } }
}
function fisgar(f) {
  const d = Math.hypot(isca.pos.x - PX.x, isca.pos.z - PX.z);
  isca.peixe = null; isca.naAgua = false;
  f.estado = 'fisgado';
  const ang = Math.atan2(-(f.pos.x - PX.x), -(f.pos.z - PX.z));
  briga = { f, linha: d + 1.5, dist: d + 1.5, est: 1, run: 1.1, runAlvo: 1.25, runT: rand(1.2, 2.4), pico: f.cb.forca * f.kg * .2, T: 0, bamba: 0, ar: false, arT: 0, arDur: 0, arH: 0, prof: -f.pos.y, ang, angV: rand(-.15, .15), t0: performance.now(), arrancadas: 0, catrAcc: 0, freioAcc: 0, avisoT: 0, deslizando: false, ruim: false };
  G.estado = 'briga'; Som.baque(1);
  const k = f.kg;
  toast('FISGADO!', k < .15 ? 'Parece pequeno…' : k < 1 ? 'Peixe na linha!' : k < 4 ? 'Peixe bom! Cuidado com o freio' : k < 15 ? 'Peixe GRANDE! Deixe o freio trabalhar' : 'MONSTRO! Segure firme');
  $('painel').classList.add('briga'); atualizarUI();
}
function fimBriga() { briga = null; G.estado = 'ocioso'; G.recolhendo = false; isca.tem = true; $('painel').classList.remove('briga'); atualizarUI(); }
function perderPeixe(t, sub, rompeu) {
  const f = briga.f; f.estado = 'fugindo'; f.cool = 40; f.alvo.copy(f.pos).add(V().set(rand(-8, 8), 0, -10)); f.alvo.y = -1; f.tt = 6;
  f.pos.y = Math.min(f.pos.y, -.2);
  toast(t, sub); if (rompeu) { Som.estalo(); if (isca.tipo === 'artificial') status('Artificial perdida. Amarrei outra.', 3); }
  fimBriga();
}

/* ============================== vara e linha ============================== */
const BUTT = V().set(.3, -.36, -.34);
const _a = V(), _b = V(), _c = V(), _t = V();
function dirVaraLocal(out = V()) { const s = .06, a = G.varaA - G.tranco * .5 + G.puxao * .2 * Math.sin(performance.now() * .04); return out.set(Math.sin(s) * Math.cos(a), Math.sin(a), -Math.cos(s) * Math.cos(a)); }
function alvoLinha() {
  if (G.estado === 'briga' && briga) return briga.f.mesh.position;
  if (G.estado === 'agua') return isca.rig === 'boia' ? boia.position : isca.pos;
  return null;
}
function flexao() {
  if (G.estado === 'briga' && briga) return clamp(briga.T / linha().kg, 0, 1) * .95 + .05;
  if (G.estado === 'agua') { const f = isca.peixe; let b = .05 + (G.recolhendo ? .05 : 0); if (f && f.estado === 'mordendo') b += isca.rig === 'boia' ? .12 : .35; return b + G.puxao * .3; }
  return .02;
}
let pontaAtual = V();
function pontaVara() { return pontaAtual.clone(); }
function atualizarVara() {
  camera.updateMatrixWorld();
  const dl = dirVaraLocal();
  const butt = camera.localToWorld(_a.copy(BUTT)), reto = camera.localToWorld(_b.copy(BUTT).addScaledVector(dl, VLEN));
  const base = camera.localToWorld(_c.copy(BUTT).addScaledVector(dl, -.4));
  const tgt = alvoLinha(), b = flexao();
  const tip = reto.clone();
  if (tgt) { _t.subVectors(tgt, reto).normalize(); tip.addScaledVector(_t, b * VLEN * .38); tip.y -= b * VLEN * .06; }
  else tip.y -= .04;
  pontaAtual.copy(tip);
  const ctrl = butt.clone().lerp(reto, .55);
  const curva = new THREE.QuadraticBezierCurve3(base, ctrl, tip);
  const pos = varaGeo.attributes.position, up = V().set(0, 1, 0), T = V(), N = V(), B = V(), P = V();
  for (let i = 0; i <= VSEG; i++) {
    const u = i / VSEG; curva.getPoint(u, P); curva.getTangent(u, T);
    N.crossVectors(T, up).normalize(); B.crossVectors(N, T).normalize();
    const r = u < .16 ? .014 : lerp(.008, .0022, (u - .16) / .84);
    for (let j = 0; j <= VRAD; j++) {
      const a = j / VRAD * Math.PI * 2, cx = Math.cos(a) * r, cy = Math.sin(a) * r;
      pos.setXYZ(i * (VRAD + 1) + j, P.x + N.x * cx + B.x * cy, P.y + N.y * cx + B.y * cy, P.z + N.z * cx + B.z * cy);
    }
  }
  pos.needsUpdate = true; varaGeo.computeVertexNormals(); varaGeo.computeBoundingSphere();
  // carretilha (presa à câmera, logo à frente da mão)
  carretilha.position.copy(BUTT).addScaledVector(dl, .22).add(_t.set(0, -.045, 0));
  carretilha.rotation.set(Math.asin(dl.y) * .8, 0, 0);
  if (G.recolhendo) carretilha.userData.manivela.rotation.x -= .5;
}
const _lp = V();
function atualizarLinha(tempo) {
  const pos = linhaGeo.attributes.position, tip = pontaAtual;
  let fim = null, sag = 0;
  if (G.estado === 'voando' && voo) { fim = isca.pos; sag = .2; }
  else if (G.estado === 'agua') { fim = isca.rig === 'boia' ? boia.position : _lp.set(isca.pos.x, 0, isca.pos.z); sag = G.recolhendo ? .05 : .35; }
  else if (G.estado === 'briga' && briga) { const f = briga.f; fim = _lp.copy(f.mesh.position).add(V().set(Math.cos(f.yaw), 0, -Math.sin(f.yaw)).multiplyScalar(f.L * .47)); sag = clamp(1 - briga.T / (.4 + .2 * f.kg), 0, 1) * .6 + (briga.linha - briga.dist) * .4; }
  else { fim = _lp.copy(tip).add(V().set(0, -.28, 0)); }
  const dist = tip.distanceTo(fim);
  for (let i = 0; i < NL; i++) {
    const u = i / (NL - 1);
    const x = lerp(tip.x, fim.x, u), z = lerp(tip.z, fim.z, u);
    let y = lerp(tip.y, fim.y, u) - Math.sin(u * Math.PI) * sag * dist * .08;
    if (G.estado === 'agua' && isca.rig !== 'boia') y = Math.max(y, lerp(tip.y, fim.y, u) - 1) ;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  // líder (boia → anzol)
  const lp = lider.geometry.attributes.position;
  if (G.estado === 'agua' && isca.rig === 'boia') { lp.setXYZ(0, boia.position.x, boia.position.y - .02, boia.position.z); lp.setXYZ(1, isca.pos.x, isca.pos.y, isca.pos.z); lider.visible = true; }
  else if (G.estado === 'agua') { lp.setXYZ(0, isca.pos.x, 0, isca.pos.z); lp.setXYZ(1, isca.pos.x, isca.pos.y, isca.pos.z); lider.visible = true; }
  else lider.visible = false;
  lp.needsUpdate = true;
  linhaMat.opacity = .45 + .4 * G.luz;
}

/* ============================== atualização ============================== */
function atualizar(dt, t) {
  G.hora = (G.hora + dt * TEMPO) % 24;
  atualizarClima(dt);
  const ceu = mundo.atualizarCeu(G.hora, G.nuvens, t, camera.position);
  G.luz = ceu.luz; G.dia = ceu.dia;
  renderer.toneMappingExposure = lerp(.5, .85, G.dia);
  if (mundo.agua.material.uniforms) mundo.agua.material.uniforms.distortionScale.value = 1.2 + G.vento * .12;
  lanterna.intensity = (1 - G.dia) * 30;
  boia.userData.antena.material.emissiveIntensity = (1 - G.dia) * 3;
  // vara
  G.tranco = Math.max(0, G.tranco - dt * 4); G.puxao = Math.max(0, G.puxao - dt * 2.2);
  if (G.estado === 'ocioso') G.varaAlvo = .38;
  if (G.estado === 'carregando') {
    G.forca += dt * .95 * G.fdir; if (G.forca >= 1) { G.forca = 1; G.fdir = -1; } if (G.forca <= 0) { G.forca = 0; G.fdir = 1; }
    G.varaAlvo = .55 + G.forca * 1.35;
  }
  if (G.estado === 'agua') G.varaAlvo = G.recolhendo ? .2 : .27;
  if (G.estado === 'briga') G.varaAlvo = .45 + Math.min(.35, briga.T / linha().kg * .4);
  G.varaA += (G.varaAlvo - G.varaA) * Math.min(1, dt * (G.estado === 'voando' ? 14 : 5));
  if (G.estado === 'voando') {
    voo.t += dt / voo.dur; const u = Math.min(1, voo.t);
    isca.pos.lerpVectors(voo.de, voo.para, u); isca.pos.y = lerp(voo.de.y, 0, u) + voo.h * 4 * u * (1 - u);
    if (voo.t >= 1) aterrissar();
  }
  if (G.estado === 'agua') atualizarIsca(dt);
  if (G.estado === 'briga') atualizarBriga(dt);
  // boia (mola)
  const alvoDip = (isca.peixe && isca.peixe.estado === 'mordendo' && isca.tipo !== 'artificial') ? 1 : 0;
  isca.dipV += ((alvoDip - isca.dip) * 40 - isca.dipV * 7) * dt; isca.dip += isca.dipV * dt;
  for (const f of peixes) atualizarPeixe(f, dt);
  for (let i = filaReposicao.length - 1; i >= 0; i--) { filaReposicao[i] -= dt; if (filaReposicao[i] <= 0) { filaReposicao.splice(i, 1); if (peixes.length < NPEIXES) criarIndividuo(null, null, true); } }
  // partículas
  for (let i = ondulacoes.length - 1; i >= 0; i--) { const o = ondulacoes[i]; o.m.scale.multiplyScalar(1 + dt * o.v); o.a -= dt * .5; o.m.material.opacity = Math.max(0, o.a); if (o.a <= 0) { scene.remove(o.m); o.m.material.dispose(); ondulacoes.splice(i, 1); } }
  for (let i = gotas.length - 1; i >= 0; i--) { const g = gotas[i]; g.v.y -= 9.8 * dt; g.m.position.addScaledVector(g.v, dt); if (g.m.position.y < 0) { scene.remove(g.m); gotas.splice(i, 1); } }
  if (G.estado === 'agua' && isca.rig === 'boia' && Math.random() < dt * .4) ondulacao(boia.position.x, boia.position.z, .05, .8);
  if (G.estado === 'agua' && isca.tipo === 'artificial' && isca.movendo && isca.pos.y > -.4 && Math.random() < dt * 6) ondulacao(isca.pos.x, isca.pos.z, .04, 1.5);
  posicionarEquipamento(t);
  atualizarVara(); atualizarLinha(t);
  if (exibicao) atualizarExibicao(dt);
  Som.ambiente(dt, G.dia, G.vento);
  G.statusT -= dt; if (G.statusT <= 0) status(statusPadrao(), 0);
  G.hudT -= dt; if (G.hudT <= 0) { G.hudT = .25; atualizarHUD(); }
}
function atualizarClima(dt) {
  G.climaT -= dt * TEMPO;
  if (G.climaT <= 0) {
    let tot = CLIMAS.reduce((s, w) => s + w.w, 0), r = Math.random() * tot, w = CLIMAS[0];
    for (const c of CLIMAS) { r -= c.w; if (r <= 0) { w = c; break; } }
    G.clima = w; G.climaT = rand(1.5, 4); G.ventoAlvo = rand(w.vento[0], w.vento[1]);
  }
  const k = Math.min(1, dt * .08); G.nuvens += (G.clima.nuvens - G.nuvens) * k; G.vento += (G.ventoAlvo - G.vento) * k; G.mod = G.clima.mod;
}
function aterrissar() {
  const fundo = depthAt(isca.pos.x, isca.pos.z);
  voo = null;
  if (fundo < .25) { toast('Caiu na margem!', 'Arremesse para a água'); G.estado = 'ocioso'; return; }
  isca.naAgua = true; isca.tem = true; isca.soak = 0; isca.peixe = null; isca.splashT = 2; isca.dip = 0; isca.dipV = 0;
  const dv = PROFUNDIDADES[G.prof]; isca.alvoProf = dv === 'fundo' ? 99 : dv; isca.pos.y = 0;
  G.estado = 'agua'; respingo(isca.pos.x, isca.pos.z, isca.tipo === 'artificial' ? .35 : .25); Som.respingo(.35);
  status(isca.tipo === 'artificial' ? 'Segure para recolher a artificial; toques rápidos trabalham a isca' : 'Aguarde a boia… toque para fisgar, segure para recolher', 4);
}
function atualizarIsca(dt) {
  const lure = isca.tipo === 'artificial', fundo = depthAt(isca.pos.x, isca.pos.z) - .1;
  isca.soak += dt; isca.splashT = Math.max(0, isca.splashT - dt); isca.toque = Math.max(0, isca.toque - dt); isca.movendo = false;
  const dj = V().set(PX.x - isca.pos.x, 0, PX.z - isca.pos.z); const hd = dj.length(); dj.normalize();
  if (G.recolhendo) {
    const v = lure ? 1.3 : 1.55;
    isca.pos.addScaledVector(dj, v * dt); isca.movendo = true; catraca(v * dt);
    const alvo = lure ? Math.min(.8, fundo) : Math.max(.2, Math.min(isca.alvoProf, fundo) * .55);
    isca.pos.y += (-alvo - isca.pos.y) * Math.min(1, dt * 1.3);
  } else {
    const alvo = lure ? fundo : Math.min(isca.alvoProf, fundo);
    if (-isca.pos.y < alvo) isca.pos.y = Math.max(-alvo, isca.pos.y - (lure ? .32 : .6) * dt); else isca.pos.y = Math.min(-alvo, isca.pos.y + .4 * dt);
    if (isca.rig === 'boia' && !isca.peixe) { isca.pos.x += Math.sin(G.hora * 7) * G.vento * .0008 * dt; }
  }
  isca.pos.y = Math.max(isca.pos.y, -fundo);
  if (lure && G.recolhendo && emGalhada(isca.pos.x, isca.pos.z) && -isca.pos.y > fundo - .6 && Math.random() < .35 * dt) {
    toast('Enroscou na galhada!', 'A linha arrebentou e a artificial ficou lá'); Som.estalo(); G.estado = 'ocioso'; G.recolhendo = false; isca.naAgua = false; isca.peixe = null; return;
  }
  if (hd < 2.6 || depthAt(isca.pos.x, isca.pos.z) < .2) {
    isca.naAgua = false; if (isca.peixe) { isca.peixe.estado = 'vagando'; isca.peixe = null; }
    G.estado = 'ocioso'; G.recolhendo = false;
    if (!isca.tem) { isca.tem = true; status('Isca reposta no anzol', 2); }
  }
}
function catraca(d) { G.catr = (G.catr || 0) + d; if (G.catr > .09) { G.catr = 0; Som.catraca(); } }
function escolherCorrida(F) {
  const s = F.est, r = Math.random();
  if (s > .5) F.runAlvo = r < .25 ? 1.3 : r < .6 ? .9 : r < .85 ? .5 : -.4;
  else if (s > .2) F.runAlvo = r < .12 ? 1.1 : r < .45 ? .6 : r < .82 ? .25 : -.35;
  else F.runAlvo = r < .3 ? .3 : r < .75 ? .12 : -.2;
  F.runT = rand(.8, 2.6); F.angV = rand(-.3, .3) * Math.max(.2, F.runAlvo);
  const mp = puxadaMax(F.f);
  if (F.runAlvo >= 1.1) { F.pico = Math.max(F.pico, .22 * mp * s); if (F.f.kg > .8) status('Ele arrancou! Deixe o freio trabalhar', 1.6); }
}
const puxadaMax = f => f.cb.forca * Math.pow(f.kg, .88) + .08;
function atualizarBriga(dt) {
  const F = briga, f = F.f, cb = f.cb, L = linha(), mp = puxadaMax(f);
  F.runT -= dt; if (F.runT <= 0) escolherCorrida(F);
  F.run += (F.runAlvo - F.run) * Math.min(1, dt * 2.5);
  const estF = .3 + .7 * F.est;
  let puxa = F.run > 0 ? mp * F.run * estF : 0; if (F.ar) puxa *= .25;
  const rec = G.recolhendo, freio = G.freio;
  if (F.run < 0 && !F.ar) F.dist = Math.max(1, F.dist + F.run * 1.3 * estF * dt);
  else if (F.linha - F.dist > .05) F.dist = Math.min(F.linha, F.dist + F.run * 1.7 * dt);
  const tenso = F.linha - F.dist <= .05;
  let Tn = 0; F.deslizando = false;
  if (tenso) {
    const carga = rec ? (.12 + .06 * Math.pow(f.kg, .9)) * (.4 + .6 * F.est) : 0, base = puxa + carga;
    if (base > freio) {
      const v = Math.min(7, .35 + (base - freio) / mp * 4);
      F.linha += v * dt; F.dist = F.linha; F.deslizando = true; Tn = freio + F.pico;
      F.freioAcc += dt; if (F.freioAcc > .028) { F.freioAcc = 0; Som.freio(v); }
    } else {
      Tn = base + F.pico;
      if (rec) { const v = REEL * (1 - .75 * Math.min(1, base / freio)); F.linha -= v * dt; F.dist = F.linha; catraca(v * dt); }
    }
  } else if (rec) { const v = REEL * 1.1 * dt; F.linha = Math.max(F.dist, F.linha - v); catraca(v); }
  F.pico = Math.max(0, F.pico - dt * (F.pico * 3 + .05));
  F.T += (Tn - F.T) * Math.min(1, dt * 12);
  if (Tn > L.kg) { perderPeixe('A LINHA ARREBENTOU!', G.freio >= L.kg * .7 ? 'Freio apertado demais para essa linha' : 'Pico de tensão na arrancada', true); return; }
  if (F.linha > SPOOL) { perderPeixe('O CARRETEL ESVAZIOU!', 'O peixe levou toda a linha: aperte mais o freio', true); return; }
  F.est -= dt * (.006 + .075 * (Tn / (mp + .05))); if (Tn < .15 * mp) F.est += dt * .02; F.est = clamp(F.est, 0, 1);
  // posição do peixe
  F.ang += F.angV * dt * (.3 + Math.max(0, F.run));
  const dir = dirYaw(F.ang), horiz = Math.max(.8, F.dist - .5);
  const nx = PX.x + dir.x * horiz, nz = PX.z + dir.z * horiz;
  if (depthAt(nx, nz) < .4) { F.angV = -F.angV - Math.sign(F.angV || 1) * .1; }
  const fundo = depthAt(nx, nz) - .15;
  const alvoP = F.est < .25 ? .35 : F.run > .8 ? Math.min(cb.d[1] + 1, fundo - .2) : F.run < .2 ? Math.max(.4, F.prof - .6) : F.prof;
  F.prof += (clamp(alvoP, .25, Math.max(.3, fundo)) - F.prof) * Math.min(1, dt * .9); F.prof = Math.min(F.prof, Math.max(.25, fundo));
  const old = V().copy(f.pos);
  f.pos.set(nx, -F.prof, nz);
  if (F.ar) { const u = F.arT / F.arDur; f.pos.y = Math.sin(u * Math.PI) * F.arH - .1; }
  f.vel.subVectors(f.pos, old).divideScalar(Math.max(dt, 1e-3));
  const olha = F.run > .15 ? F.ang : F.ang + Math.PI;
  const yawAlvo = Math.atan2(dirYaw(olha).z * -1, dirYaw(olha).x) + F.angV * .8;
  f.yaw += angDif(f.yaw, yawAlvo) * Math.min(1, dt * 5);
  f.mesh.position.copy(f.pos);
  const tilt = F.ar ? (F.arT / F.arDur - .5) * -1.6 : 0;
  f.mesh.rotation.set(0, f.yaw, tilt);
  f.ta += dt * (3 + Math.abs(F.run) * 6); f.mesh.userData.nadar(f.ta, (f.sp.swim?.amp ?? .07) * (1 + Math.abs(F.run) * .8));
  // salto
  if (cb.salto && !F.ar && F.prof < 2 && F.run > .4 && F.est > .2 && Math.random() < cb.salto * .22 * dt) {
    F.ar = true; F.arT = 0; F.arDur = rand(.7, 1.1); F.arH = clamp(.25 + f.L * .6, .3, 1.6); F.ruim = false;
    respingo(f.pos.x, f.pos.z, .7); Som.respingo(.6); toast('SALTOU!', 'Pare de recolher!');
  }
  if (F.ar) {
    F.arT += dt; if (rec && F.T > .25 * mp) F.ruim = true;
    if (F.arT >= F.arDur) { F.ar = false; respingo(f.pos.x, f.pos.z, .9); Som.respingo(.8); if (F.ruim && Math.random() < .4) { perderPeixe('Soltou no salto!', 'Com a linha tensa no salto o anzol escapa'); return; } }
  } else if (F.prof < .5 && Math.random() < dt * 2) ondulacao(f.pos.x, f.pos.z, .1 + f.L * .2, 1.5);
  // linha bamba
  if (!tenso || F.T < .03 + .04 * mp) F.bamba += dt; else F.bamba = Math.max(0, F.bamba - dt * 2);
  if (F.bamba > 1.7 && Math.random() < .4 * dt) { perderPeixe('O peixe escapou', 'A linha ficou bamba e o anzol soltou'); return; }
  if (emGalhada(nx, nz) && F.prof > fundo - 1.8 && F.run > .6 && Math.random() < .2 * cb.estrutura * dt) { perderPeixe('ENROSCOU NA GALHADA!', 'O peixe correu para os galhos e a linha arrebentou', true); return; }
  if (F.dist <= 2.4) {
    if (F.est > .35 && f.kg > 1.2 && F.arrancadas < 3) {
      F.arrancadas++; F.dist = F.linha = 3; F.runAlvo = 1.3; F.run = 1.1; F.runT = 1.6; F.pico = mp * .3 * F.est;
      toast('Viu o píer e arrancou!', 'Ainda não está cansado');
    } else { pousar(); return; }
  }
  F.avisoT -= dt;
  if (F.avisoT <= 0) {
    F.avisoT = .6;
    if (F.deslizando) status('Freio cantando: o peixe está tirando linha', .7);
    else if (F.bamba > .7) status('Linha bamba! Recolha!', .7);
    else if (Tn > L.kg * .82) status('Tensão perigosa! Alivie o freio (↓)', .7);
  }
}
function posicionarEquipamento(t) {
  const naAgua = G.estado === 'agua', voando = G.estado === 'voando';
  const mostraBoia = (naAgua || voando) && isca.rig === 'boia';
  boia.visible = mostraBoia || G.estado === 'ocioso' || G.estado === 'carregando' ? (G.isca !== 'artificial' && PROFUNDIDADES[G.prof] !== 'fundo') || mostraBoia : false;
  const dCam = camera.position.distanceTo(boia.position);
  boia.scale.setScalar(Math.max(1, dCam / 5));
  if (naAgua && isca.rig === 'boia') {
    boia.position.set(isca.pos.x, onda(isca.pos.x, isca.pos.z, t) - isca.dip * .05 * boia.scale.x, isca.pos.z);
    if (!isca.peixe) { isca.pos.x += (boia.position.x - isca.pos.x) * .1; }
  } else if (voando) boia.position.copy(isca.pos);
  else if (!naAgua) boia.position.copy(pontaAtual).add(V().set(0, -.3, 0));
  anzol.visible = naAgua || voando;
  anzol.position.copy(isca.pos);
  const mostrar = isca.tem ? (naAgua || voando ? isca.tipo : null) : null;
  for (const k in iscasMesh) iscasMesh[k].visible = k === mostrar;
  chumbo.visible = isca.tipo !== 'artificial';
  if (naAgua) {
    const dj = V().set(PX.x - isca.pos.x, 0, PX.z - isca.pos.z).normalize();
    anzol.rotation.set(0, Math.atan2(-dj.z, dj.x), 0);
  }
  // isca viva: modelo do lambari
  if (mostrar === 'vivo') {
    if (!iscaViva) { iscaViva = criarPeixe(POR_ID['lambari'], { res: 256, finRes: 64, nt: 40, na: 24 }); iscaViva.scale.setScalar(.09); aplicarEnv(iscaViva); scene.add(iscaViva); }
    iscaViva.visible = true; iscaViva.position.copy(isca.pos); iscaViva.rotation.y = t * .6; iscaViva.userData.nadar(t * 2);
  } else if (iscaViva) iscaViva.visible = false;
}

/* ============================== captura ============================== */
function pousar() {
  const F = briga, f = F.f, secs = (performance.now() - F.t0) / 1000;
  f.estado = 'capturado'; f.mesh.visible = false;
  respingo(PX.x, PX.z - 1.5, .4); Som.respingo(.4);
  fimBriga(); G.estado = 'capturado';
  const m = criarPeixe(f.sp, { res: 1024 }); m.scale.setScalar(f.L); aplicarEnv(m, 1);
  const d = clamp(f.L / (.62 * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect), .3, 6);
  m.position.set(0, -.02 - d * .08, -d); camera.add(m);
  exibicao = { f, m, t: 0, secs };
  mostrarCaptura(f, secs);
}
function atualizarExibicao(dt) { exibicao.t += dt; exibicao.m.rotation.y = Math.sin(exibicao.t * .7) * .45; exibicao.m.userData.nadar(exibicao.t * 1.5, .03); }
const pontos = f => Math.round((COMPORTAMENTO[f.sp.id].ab < 2 ? 60 : 12) * (.5 + 1.6 * f.L / f.sp.tlMax) + f.kg * 6);
function mostrarCaptura(f, secs) {
  const rec = save.log[f.sp.id], novo = !rec, recorde = rec && f.kg > rec.best;
  $('cNome').innerHTML = f.sp.nome + (novo ? '<span class="badge">NOVA ESPÉCIE</span>' : recorde ? '<span class="badge">RECORDE!</span>' : '');
  $('cSci').textContent = f.sp.sci;
  $('cKg').textContent = fmtKg(f.kg); $('cLen').textContent = fmtCm(f.L); $('cTempo').textContent = `${Math.round(secs)} s`;
  const p = pontos(f); $('cPts').textContent = p; G.ptsPendentes = p;
  $('cDica').textContent = f.sp.dica;
  const e = save.log[f.sp.id] || { n: 0, best: 0, bestLen: 0 }; e.n++; if (f.kg > e.best) { e.best = f.kg; e.bestLen = f.L; } save.log[f.sp.id] = e;
  save.n++; save.kg += f.kg; persist();
  $('mCaptura').classList.add('on');
}
function fecharCaptura(soltar) {
  const { f, m } = exibicao; camera.remove(m); m.userData.dispose(); exibicao = null;
  let p = G.ptsPendentes || 0;
  if (soltar) {
    p = Math.round(p * 1.2); save.soltos++;
    f.estado = 'fugindo'; f.cool = 90; f.mesh.visible = true; f.pos.set(PX.x + rand(-1, 1), -.4, PX.z - 2.5); f.alvo.set(rand(-20, 20), -1.5, -30); f.tt = 12;
    toast('Peixe solto', 'Boa prática!'); respingo(f.pos.x, f.pos.z, .4);
  } else { removerPeixe(f); filaReposicao.push(rand(10, 25)); toast('No viveiro!'); }
  G.pts += p; save.pts = G.pts; persist();
  $('mCaptura').classList.remove('on'); G.estado = 'ocioso'; atualizarUI();
}

/* ============================== interface ============================== */
function toast(t, sub) { const el = $('toast'); el.innerHTML = t + (sub ? `<small>${sub}</small>` : ''); el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 1900); }
function status(s, dur) { $('status').textContent = s; G.statusT = dur || 0; }
function statusPadrao() {
  switch (G.estado) {
    case 'ocioso': return touch ? 'Arraste para mirar · segure o botão para arremessar' : 'Arraste o mouse para mirar · segure Espaço para arremessar';
    case 'carregando': return 'Solte para arremessar';
    case 'agua': return isca.tipo === 'artificial' ? 'Segure para recolher · toques rápidos trabalham a isca' : (isca.tem ? 'Aguardando… toque para fisgar, segure para recolher' : 'Sem isca! Segure para recolher');
    case 'briga': return 'Segure para recolher · ↑↓ ou ± ajustam o freio';
    default: return '';
  }
}
const ROTULO = { ocioso: 'Arremessar', carregando: 'Solte!', voando: '…', agua: 'Fisgar / recolher', briga: 'Recolher', capturado: '—', carregando2: '' };
function atualizarHUD() {
  const h = Math.floor(G.hora), m = Math.floor((G.hora - h) * 60);
  $('hRelogio').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  $('hPeriodo').textContent = periodo(G.hora);
  const temp = Math.round(19 + 8 * diaF() + gauss(G.hora, 14, 3) * 2);
  $('hClima').textContent = `${G.clima.nome} · ${temp}°C · vento ${Math.round(G.vento)} km/h`;
  $('hPts').textContent = G.pts.toLocaleString('pt-BR');
  $('acaoTxt').textContent = ROTULO[G.estado] || '';
  $('pip').hidden = !(G.pip && (G.estado === 'agua' || G.estado === 'briga'));
  if (G.estado === 'agua') $('pipInfo').textContent = `${fmt(-isca.pos.y, 1)} m de profundidade · fundo ${fmt(depthAt(isca.pos.x, isca.pos.z), 1)} m`;
  if (G.estado === 'briga' && briga) {
    const Lk = linha().kg, F = briga, p = clamp(F.T / Lk, 0, 1), el = $('mFill');
    el.style.width = (p * 100) + '%'; el.style.background = p < .55 ? 'var(--ok)' : p < .82 ? 'var(--aviso)' : 'var(--ruim)';
    $('mFreio').style.left = `calc(${clamp(G.freio / Lk, 0, 1) * 100}% - 1.5px)`;
    $('mT').textContent = fmt(F.T); $('mL').textContent = Math.round(F.linha); $('mMax').textContent = Lk;
    $('mSente').textContent = F.deslizando ? 'freio cantando' : F.ar ? 'salto!' : F.bamba > .6 ? 'linha bamba' : F.est < .25 ? 'peixe cansado' : F.run < 0 ? 'vindo na sua direção' : 'puxando';
    $('pipInfo').textContent = `Linha fora: ${Math.round(F.linha)} m`;
  }
}
const podeEquipar = () => G.estado === 'ocioso' || G.estado === 'intro';
function montarUI() {
  const ob = $('oIsca'); ob.innerHTML = '';
  for (const b of ISCAS) { const e = document.createElement('button'); e.textContent = `${b.ic} ${b.nome}`; e.dataset.id = b.id; e.onclick = () => { if (podeEquipar()) { G.isca = b.id; atualizarUI(); } }; ob.appendChild(e); }
  const ol = $('oLinha'); ol.innerHTML = '';
  for (const l of LINHAS) { const e = document.createElement('button'); e.textContent = `${l.nome} · ${l.kg} kg`; e.onclick = () => { if (podeEquipar()) { G.linha = l.id; atualizarUI(); } }; ol.appendChild(e); }
  $('pMenos').onclick = () => { if (podeEquipar()) { G.prof = Math.max(0, G.prof - 1); atualizarUI(); } };
  $('pMais').onclick = () => { if (podeEquipar()) { G.prof = Math.min(PROFUNDIDADES.length - 1, G.prof + 1); atualizarUI(); } };
  $('fMenos').onclick = () => definirFreio(G.freio - .5);
  $('fMais').onclick = () => definirFreio(G.freio + .5);
  atualizarUI();
}
function definirFreio(v) { G.freio = clamp(Math.round(v * 2) / 2, .5, 25); atualizarUI(); Som.catraca(); }
function atualizarUI() {
  [...$('oIsca').children].forEach(b => b.classList.toggle('sel', b.dataset.id === G.isca));
  [...$('oLinha').children].forEach((b, i) => b.classList.toggle('sel', i === G.linha));
  const lure = G.isca === 'artificial', dv = PROFUNDIDADES[G.prof];
  $('pVal').textContent = lure ? '—' : dv === 'fundo' ? 'Fundo' : `${fmt(dv, 1)} m`;
  $('pDica').textContent = lure ? 'isca de meia-água' : dv === 'fundo' ? 'chumbada no fundo' : 'abaixo da boia';
  $('pMenos').disabled = $('pMais').disabled = lure || !podeEquipar();
  $('fVal').textContent = `${fmt(G.freio, 1)} kg`;
  const r = G.freio / linha().kg;
  $('fDica').textContent = r >= 1 ? 'acima da resistência da linha' : r > .6 ? 'apertado' : r < .15 ? 'muito frouxo' : 'ideal ≈ 1/3 da linha';
  $('fDica').className = 'dica' + (r >= 1 ? ' ruim' : r > .6 ? ' aviso' : '');
  document.querySelectorAll('#oIsca button,#oLinha button').forEach(b => b.disabled = !podeEquipar());
}
function mostrarCaderno() {
  const sp = Object.keys(save.log).length;
  $('cadStats').innerHTML = `<div class="stat"><span>Pontos</span><b>${G.pts.toLocaleString('pt-BR')}</b></div><div class="stat"><span>Peixes</span><b>${save.n}</b></div><div class="stat"><span>Total</span><b>${fmtKg(save.kg)}</b></div><div class="stat"><span>Espécies</span><b>${sp}/${ESPECIES.length}</b></div>`;
  const gr = $('cadLista'); gr.innerHTML = '';
  for (const s of ESPECIES) {
    const e = save.log[s.id], cb = COMPORTAMENTO[s.id], d = document.createElement('div'); d.className = 'esp' + (e ? '' : ' nao');
    const top = Object.entries(cb.pref).sort((a, b) => b[1] - a[1])[0][0];
    const quando = cb.act.noite > .4 ? 'à noite' : cb.act.dd > .55 ? 'no amanhecer e no entardecer' : cb.act.dia > .5 ? 'de dia' : 'o dia todo';
    d.innerHTML = e ? `<b>${s.nome}</b><span>${e.n}× · recorde ${fmtKg(e.best)} · ${fmtCm(e.bestLen)}</span>`
      : `<b>???</b><span>Dica: ${ISCAS.find(i => i.id === top).nome.toLowerCase()}, ${quando}${cb.fundo ? ', no fundo' : ''}</span>`;
    gr.appendChild(d);
  }
  $('mCaderno').classList.add('on');
}

/* ============================== entrada ============================== */
const modalAberto = () => document.querySelector('.modal.on');
let arrasto = null;
canvas.addEventListener('pointerdown', e => { if (modalAberto()) return; arrasto = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture?.(e.pointerId); Som.init(); });
canvas.addEventListener('pointermove', e => {
  if (!arrasto || arrasto.id !== e.pointerId || G.estado === 'capturado') return;
  const k = e.pointerType === 'touch' ? .0055 : .0042;
  G.yaw += (e.clientX - arrasto.x) * k; G.pitch = clamp(G.pitch - (e.clientY - arrasto.y) * k, -.7, .55);
  arrasto.x = e.clientX; arrasto.y = e.clientY;
});
const fimArrasto = () => { arrasto = null; };
canvas.addEventListener('pointerup', fimArrasto); canvas.addEventListener('pointercancel', fimArrasto);
const bA = $('acao');
bA.addEventListener('pointerdown', e => { e.preventDefault(); bA.setPointerCapture?.(e.pointerId); bA.classList.add('ativo'); pressionar(); });
const solta = () => { bA.classList.remove('ativo'); soltar(); };
bA.addEventListener('pointerup', solta); bA.addEventListener('pointercancel', solta);
addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat && !modalAberto()) pressionar(); }
  else if (e.code === 'ArrowUp' || e.key === '+') { e.preventDefault(); definirFreio(G.freio + .5); }
  else if (e.code === 'ArrowDown' || e.key === '-') { e.preventDefault(); definirFreio(G.freio - .5); }
  else if (e.code === 'ArrowLeft') G.yaw -= .05; else if (e.code === 'ArrowRight') G.yaw += .05;
});
addEventListener('keyup', e => { if (e.code === 'Space') { e.preventDefault(); soltar(); } });
addEventListener('wheel', e => { if (modalAberto() || e.target !== canvas) return; definirFreio(G.freio + (e.deltaY < 0 ? .5 : -.5)); }, { passive: true });
addEventListener('blur', () => soltar());
document.addEventListener('click', e => { if (e.target.tagName === 'BUTTON' && e.target.id !== 'acao') e.target.blur(); });
$('bComecar').onclick = () => { Som.init(); $('mIntro').classList.remove('on'); if (G.estado === 'intro') G.estado = 'ocioso'; atualizarUI(); };
$('bAjuda').onclick = () => { $('bComecar').textContent = 'Voltar à pescaria'; $('mIntro').classList.add('on'); if (G.estado === 'carregando') G.estado = 'ocioso'; soltar(); };
$('bCaderno').onclick = () => { soltar(); mostrarCaderno(); };
$('bFecharCad').onclick = () => $('mCaderno').classList.remove('on');
$('bZerar').onclick = () => { $('bZerar').hidden = true; $('bConfirmaZerar').hidden = false; };
$('bConfirmaZerar').onclick = () => { Object.assign(save, { log: {}, pts: 0, kg: 0, n: 0, soltos: 0 }); G.pts = 0; persist(); $('bZerar').hidden = false; $('bConfirmaZerar').hidden = true; mostrarCaderno(); };
$('bSom').onclick = () => { Som.init(); $('bSom').textContent = Som.alternar() ? '🔊' : '🔇'; };
$('bCam').onclick = () => { G.pip = !G.pip; $('bCam').classList.toggle('on', G.pip); atualizarHUD(); };
$('bQual').textContent = QUAL === 'alta' ? 'Gráficos: alto' : 'Gráficos: leve';
$('bQual').onclick = () => { store.set('pesca3d_qualidade', QUAL === 'alta' ? 'baixa' : 'alta'); location.reload(); };
$('bGuardar').onclick = () => fecharCaptura(false);
$('bSoltar').onclick = () => fecharCaptura(true);
const painelMin = v => { $('painel').classList.toggle('min', v); $('bPainel').textContent = v ? 'equipar' : 'recolher'; redimensionar(); };
$('bPainel').onclick = () => painelMin(!$('painel').classList.contains('min'));
if (touch || innerWidth < 760) painelMin(true);

/* ============================== render ============================== */
function redimensionar() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 72 : 60; camera.updateProjectionMatrix();
  BUTT.x = clamp(.32 * camera.aspect, .1, .3); // em retrato a vara entra mais ao centro
  document.documentElement.style.setProperty('--painelH', $('painel').offsetHeight + 'px');
}
addEventListener('resize', redimensionar);
const corSub = new THREE.Color();
const _cs = V();
function renderizarPip() {
  const el = $('pip'); if (el.hidden) return;
  const r = el.getBoundingClientRect(); if (r.width < 10) return;
  let alvo, raio;
  if (G.estado === 'briga' && briga) { alvo = briga.f.pos; raio = 1.2 + briga.f.L * 1.4; }
  else { alvo = isca.pos; raio = 1.4; }
  const dj = V().set(alvo.x - PX.x, 0, alvo.z - PX.z).normalize(), lat = V().set(-dj.z, 0, dj.x);
  _cs.copy(alvo).addScaledVector(lat, raio).addScaledVector(dj, -raio * .4);
  const fundo = depthAt(_cs.x, _cs.z);
  _cs.y = clamp(alvo.y + .15, -Math.max(.3, fundo - .25), -.2);
  camSub.position.lerp(_cs, .15); camSub.lookAt(alvo);
  camSub.aspect = r.width / r.height; camSub.updateProjectionMatrix();
  // ambiente subaquático
  const ar = { fog: scene.fog, bg: scene.background };
  corSub.set(0x2f5a4a).multiplyScalar(.12 + .88 * G.luz); fogSub.color.copy(corSub);
  scene.fog = fogSub; scene.background = corSub;
  mundo.agua.visible = false; mundo.sky.visible = false; mundo.estrelas.visible = false; mundo.lua.visible = false; mundo.sobAgua.visible = true;
  mundo.sobAgua.material.color.set(0x9fd0bc).multiplyScalar(.15 + .85 * G.luz);
  vara.visible = false; carretilha.visible = false;
  for (const f of peixes) f.mesh.visible = f.estado !== 'capturado';
  const H = innerHeight;
  renderer.setScissorTest(true);
  renderer.setViewport(r.left, H - r.bottom, r.width, r.height); renderer.setScissor(r.left, H - r.bottom, r.width, r.height);
  renderer.render(scene, camSub);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
  scene.fog = ar.fog; scene.background = ar.bg;
  mundo.agua.visible = true; mundo.sky.visible = true; mundo.estrelas.visible = true; mundo.lua.visible = true; mundo.sobAgua.visible = false;
  vara.visible = true; carretilha.visible = true;
}
let ultimo = performance.now(), T = 0;
function quadro(agora) {
  const dt = Math.min(.05, (agora - ultimo) / 1000); ultimo = agora;
  const pausado = G.estado === 'intro' || G.estado === 'carregando-mundo' || (modalAberto() && G.estado !== 'capturado');
  if (!pausado) { T += dt; atualizar(dt, T); }
  else { mundo.atualizarCeu(G.hora, G.nuvens, T, camera.position); atualizarVara(); atualizarLinha(T); }
  camera.rotation.set(G.pitch, G.yaw, 0);
  for (const f of peixes) f.mesh.visible = f.estado !== 'capturado' && (f.pos.y > -.25 || (briga && briga.f === f && briga.ar));
  renderer.render(scene, camera);
  renderizarPip();
  requestAnimationFrame(quadro);
}

/* ============================== início ============================== */
async function iniciar() {
  redimensionar(); montarUI();
  $('carga').hidden = false;
  for (let i = 0; i < NPEIXES; i++) {
    criarIndividuo();
    $('cargaTxt').textContent = `Soltando peixes na represa… ${i + 1}/${NPEIXES}`;
    await new Promise(r => requestAnimationFrame(r));
  }
  $('carga').hidden = true;
  G.estado = 'intro';
  atualizarHUD();
}
G.estado = 'carregando-mundo';
requestAnimationFrame(quadro);
iniciar();
window.__jogo = { G, isca, peixes, camera, get briga() { return briga; }, fisgar, criarIndividuo, POR_ID, pousar: () => pousar() };
