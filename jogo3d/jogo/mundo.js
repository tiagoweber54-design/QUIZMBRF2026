// Cenário: represa com margem irregular, relevo, água, céu, vegetação, píer e paliteiros.
// O pescador fica na ponta do píer, na origem, olhando para -z.
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ------------------------- geografia da represa ------------------------- */
const raio = th => 112 + 16 * Math.sin(3 * th + 1.1) + 8 * Math.sin(5 * th + 2.3) + 4 * Math.sin(9 * th + .4);
export const LAGO = { cx: 0, cz: 18 - raio(Math.PI / 2), maxD: 9 };
export const DECK_Y = .8;
export const JOGADOR = new THREE.Vector3(0, DECK_Y + 1.62, .6);
// galhadas: troncos submersos e paliteiros (onde a linha pode enroscar)
export const GALHADAS = [
  { x: -26, z: -42, r: 7 }, { x: 31, z: -63, r: 8 }, { x: -8, z: -88, r: 6 }, { x: 46, z: -24, r: 5 },
];
export const emGalhada = (x, z) => GALHADAS.some(g => (x - g.x) ** 2 + (z - g.z) ** 2 < g.r * g.r);

export function distMargem(x, z) { // > 0 fora da água, < 0 dentro
  const dx = x - LAGO.cx, dz = z - LAGO.cz;
  return Math.hypot(dx, dz) - raio(Math.atan2(dz, dx));
}
const ruido = (x, z) => Math.sin(x * .071 + Math.sin(z * .043) * 2) * Math.sin(z * .059 + Math.sin(x * .037) * 2);
export function alturaTerreno(x, z) {
  const s = distMargem(x, z);
  if (s >= 0) {
    const morro = (Math.sin(x * .013 + 1.7) + Math.sin(z * .017 + 1) + .6 * Math.sin((x + z) * .031)) * .5;
    return .25 + s * .07 + Math.max(0, morro + .3) * smooth(s / 45) * 16 + smooth(s / 140) * 22 + ruido(x, z) * smooth(s / 10) * 1.2;
  }
  const fundo = LAGO.maxD * smooth(-s / 44) * (.86 + .14 * ruido(x * 1.3, z * 1.3));
  let h = Math.max(-fundo, .25 + s * .14);
  for (const g of GALHADAS) { const d = Math.hypot(x - g.x, z - g.z); if (d < g.r * 1.4) h += .6 * (1 - d / (g.r * 1.4)); }
  return h;
}
export const depthAt = (x, z) => Math.max(0, -alturaTerreno(x, z));
export const onda = (x, z, t) => .028 * Math.sin(x * .6 + t * 1.3) + .018 * Math.sin(z * .8 - t * 1.1) + .01 * Math.sin((x - z) * 1.7 + t * 2.1);

/* --------------------------- mapa de normais --------------------------- */
function normaisAgua(n = 256) {
  const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
  const img = g.createImageData(n, n), R = rng(9);
  const ondas = Array.from({ length: 14 }, () => ({ kx: Math.round((R() - .5) * 16), ky: Math.round((R() - .5) * 16), a: R() * .6 + .2, p: R() * 6.28 }));
  const H = (x, y) => ondas.reduce((s, w) => s + w.a * Math.sin((w.kx * x + w.ky * y) / n * Math.PI * 2 + w.p), 0);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = H(x + 1, y) - H(x - 1, y), dy = H(x, y + 1) - H(x, y - 1);
    const nx = -dx * .9, ny = -dy * .9, nz = 1, l = Math.hypot(nx, ny, nz), i = (y * n + x) * 4;
    img.data[i] = (nx / l * .5 + .5) * 255; img.data[i + 1] = (ny / l * .5 + .5) * 255; img.data[i + 2] = (nz / l * .5 + .5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

/* ------------------------------ construção ------------------------------ */
export function criarMundo(scene, renderer, { qualidade = 'alta' } = {}) {
  const R = rng(2024);
  const mundo = { scene };

  // terreno
  const N = qualidade === 'alta' ? 260 : 160, S = 640;
  const geo = new THREE.PlaneGeometry(S, S, N, N); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
  const cLodo = new THREE.Color('#4a4430'), cFundo = new THREE.Color('#2a2c1e'), cAreia = new THREE.Color('#a8956a'),
    cGrama = new THREE.Color('#5d7a34'), cMato = new THREE.Color('#3f5a28'), cTerra = new THREE.Color('#7a6240'), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i) - 40, h = alturaTerreno(x, z);
    pos.setXYZ(i, x, h, z);
    if (h < -.1) tmp.copy(cLodo).lerp(cFundo, smooth(-h / 6));
    else if (h < .7) tmp.copy(cAreia).lerp(cTerra, .3 + .3 * R());
    else tmp.copy(cGrama).lerp(cMato, smooth((h - 2) / 18) * .8 + R() * .15).lerp(cTerra, Math.max(0, ruido(x * 2, z * 2)) * .35);
    cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3)); geo.computeVertexNormals();
  const terreno = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 }));
  scene.add(terreno); mundo.terreno = terreno;

  // água
  const normais = normaisAgua();
  if (qualidade === 'alta') {
    const agua = new Water(new THREE.PlaneGeometry(2000, 2000), {
      textureWidth: 512, textureHeight: 512, waterNormals: normais, sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: 0xffffff, waterColor: 0x1d3a2e, distortionScale: 2.2, fog: true, alpha: 1,
    });
    agua.rotation.x = -Math.PI / 2; agua.material.uniforms.size.value = 2.2;
    mundo.agua = agua;
  } else {
    normais.repeat.set(160, 160);
    const agua = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x4f7468, roughness: .22, metalness: 0, normalMap: normais, normalScale: new THREE.Vector2(.5, .5) }));
    agua.rotation.x = -Math.PI / 2; mundo.agua = agua; mundo.normaisBaixa = normais;
  }
  scene.add(mundo.agua);
  // superfície vista de baixo (câmera subaquática)
  const sob = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({ color: 0x8fc8b0, side: THREE.BackSide, fog: true }));
  sob.rotation.x = -Math.PI / 2; sob.position.y = -.01; sob.visible = false; scene.add(sob); mundo.sobAgua = sob;

  // céu
  const sky = new Sky(); sky.scale.setScalar(4500); scene.add(sky); mundo.sky = sky;
  // noite azul-escura: mistura no final do shader do céu
  sky.material.uniforms.uNoite = { value: 0 };
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float uNoite;')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( mix( retColor * 0.5, vec3( 0.012, 0.022, 0.05 ) + retColor * 0.08, uNoite ), 1.0 );');
  const su = sky.material.uniforms; su.turbidity.value = 6; su.rayleigh.value = 1.6; su.mieCoefficient.value = .005; su.mieDirectionalG.value = .82;
  // estrelas
  const sp = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) { const a = R() * Math.PI * 2, e = Math.asin(R() * .95 + .03), r = 3500; sp.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const estrelas = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  estrelas.layers.set(1); // fora do reflexo da água
  scene.add(estrelas); mundo.estrelas = estrelas;
  const lua = new THREE.Mesh(new THREE.SphereGeometry(40, 24, 16), new THREE.MeshBasicMaterial({ color: 0xeef2ff, fog: false, transparent: true }));
  scene.add(lua); mundo.lua = lua;

  // luzes
  mundo.sol = new THREE.DirectionalLight(0xffffff, 2.5); scene.add(mundo.sol, mundo.sol.target);
  mundo.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x3a4a2a, .8); scene.add(mundo.hemi);
  mundo.luaLuz = new THREE.DirectionalLight(0x8fa8ff, 0); scene.add(mundo.luaLuz);

  // vegetação: árvores
  const ok = (x, z, a, b) => { const s = distMargem(x, z); return s > a && s < b && !(Math.abs(x) < 6 && z > 8 && z < 45); };
  const pontos = (n, a, b, hMax = 60) => { const out = []; let tries = 0; while (out.length < n && tries++ < n * 30) { const x = (R() - .5) * 600, z = (R() - .5) * 600 - 40; if (ok(x, z, a, b) && alturaTerreno(x, z) < hMax) out.push([x, z]); } return out; };
  const tronco = new THREE.CylinderGeometry(.18, .3, 1, 6); tronco.translate(0, .5, 0);
  const copaR = new THREE.IcosahedronGeometry(1, 1);
  { const p = copaR.attributes.position; for (let i = 0; i < p.count; i++) { const k = .8 + R() * .35; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * .8, p.getZ(i) * k); } copaR.computeVertexNormals(); }
  const copaC = new THREE.ConeGeometry(1, 1, 7); copaC.translate(0, .5, 0);
  const arv = pontos(qualidade === 'alta' ? 1100 : 500, 7, 260);
  const mTr = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }), mCo = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95, flatShading: true });
  const iTr = new THREE.InstancedMesh(tronco, mTr, arv.length), iR = new THREE.InstancedMesh(copaR, mCo, arv.length), iC = new THREE.InstancedMesh(copaC, mCo, arv.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), Sc = new THREE.Vector3(), cor = new THREE.Color();
  let nR = 0, nC = 0;
  arv.forEach(([x, z], i) => {
    const y = alturaTerreno(x, z) - .2, h = 5 + R() * 9;
    M.compose(V.set(x, y, z), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6), Sc.set(1 + h * .03, h * .55, 1 + h * .03)); iTr.setMatrixAt(i, M);
    cor.setHSL(.22 + R() * .1, .35 + R() * .25, .16 + R() * .12);
    if (R() < .72) { const w = h * (.35 + R() * .2); M.compose(V.set(x, y + h * .62, z), Q, Sc.set(w, w * .85, w)); iR.setMatrixAt(nR, M); iR.setColorAt(nR++, cor); }
    else { const w = h * .22; M.compose(V.set(x, y + h * .3, z), Q, Sc.set(w, h * .9, w)); iC.setMatrixAt(nC, M); iC.setColorAt(nC++, cor.offsetHSL(.03, 0, -.03)); }
  });
  iR.count = nR; iC.count = nC; scene.add(iTr, iR, iC);

  // taboas na margem
  const tab = pontos(qualidade === 'alta' ? 2600 : 1200, -3.5, 1.2, 1);
  const tg = new THREE.ConeGeometry(.025, 1, 3); tg.translate(0, .5, 0);
  const iTab = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9 }), tab.length);
  tab.forEach(([x, z], i) => {
    const y = Math.min(alturaTerreno(x, z), 0) - .05, h = 1.2 + R() * 1.4;
    M.compose(V.set(x, y, z), Q.setFromEuler(new THREE.Euler((R() - .5) * .3, R() * 6, (R() - .5) * .3)), Sc.set(1, h - y, 1)); iTab.setMatrixAt(i, M);
    iTab.setColorAt(i, cor.setHSL(.2 + R() * .06, .4, .22 + R() * .1));
  });
  scene.add(iTab);

  // aguapés (manchas na água rasa)
  const agp = [];
  for (let k = 0; k < 18; k++) { const [cx, cz] = pontos(1, -14, -3, 0)[0] || [0, -200]; for (let i = 0; i < 40; i++) agp.push([cx + (R() - .5) * 7, cz + (R() - .5) * 7]); }
  const ag = new THREE.CircleGeometry(.22, 9); ag.rotateX(-Math.PI / 2);
  const iAg = new THREE.InstancedMesh(ag, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .6 }), agp.length);
  agp.forEach(([x, z], i) => { M.compose(V.set(x, .025, z), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6), Sc.setScalar(.7 + R() * .8)); iAg.setMatrixAt(i, M); iAg.setColorAt(i, cor.setHSL(.27, .45, .2 + R() * .08)); });
  scene.add(iAg);

  // plantas submersas (vistas na câmera subaquática)
  const sub = pontos(900, -26, -2, 0);
  const pg = new THREE.PlaneGeometry(.25, 1, 1, 3); pg.translate(0, .5, 0);
  const iSub = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .8, side: THREE.DoubleSide }), sub.length);
  sub.forEach(([x, z], i) => { const y = alturaTerreno(x, z), h = Math.min(-y - .2, .6 + R() * 1.8); M.compose(V.set(x, y, z), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6), Sc.set(1, Math.max(.2, h), 1)); iSub.setMatrixAt(i, M); iSub.setColorAt(i, cor.setHSL(.28 + R() * .08, .5, .16 + R() * .1)); });
  scene.add(iSub);

  // paliteiros e galhadas
  const madeira = new THREE.MeshStandardMaterial({ color: 0x6e6658, roughness: 1 });
  const galhos = new THREE.Group();
  const galho = (a, b, r) => {
    const d = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(new THREE.CylinderGeometry(r * .6, r, d.length(), 6), madeira);
    m.position.copy(a).addScaledVector(d, .5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); galhos.add(m);
  };
  for (const g of GALHADAS) {
    for (let k = 0; k < 7; k++) {
      const x = g.x + (R() - .5) * g.r * 1.4, z = g.z + (R() - .5) * g.r * 1.4, base = new THREE.Vector3(x, alturaTerreno(x, z) - .3, z);
      const top = new THREE.Vector3(x + (R() - .5), R() < .6 ? 1.2 + R() * 3.5 : -.6 - R(), z + (R() - .5));
      galho(base, top, .12 + R() * .1);
      for (let j = 0; j < 3; j++) { const p = base.clone().lerp(top, .4 + R() * .5), q = p.clone().add(new THREE.Vector3((R() - .5) * 2.5, R() * 1.2, (R() - .5) * 2.5)); galho(p, q, .05); }
    }
  }
  scene.add(galhos);

  // píer
  const madP = new THREE.MeshStandardMaterial({ color: 0x8a6a46, roughness: .9 }), madE = new THREE.MeshStandardMaterial({ color: 0x5e452c, roughness: 1 });
  const pier = new THREE.Group();
  for (let z = -1.2; z < 24; z += .32) {
    const tb = new THREE.Mesh(new THREE.BoxGeometry(2.4, .05, .28), madP); tb.position.set((R() - .5) * .03, DECK_Y, z); tb.rotation.y = (R() - .5) * .01;
    tb.material = R() < .3 ? madE : madP; pier.add(tb);
  }
  for (const z of [-1.1, 3, 7, 11, 15, 19, 23]) for (const x of [-1.15, 1.15]) {
    const yb = alturaTerreno(x, z) - .5, p = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, DECK_Y - yb), madE); p.position.set(x, (DECK_Y + yb) / 2, z); pier.add(p);
  }
  for (const x of [-1.15, 1.15]) { const v = new THREE.Mesh(new THREE.BoxGeometry(.12, .15, 25), madE); v.position.set(x, DECK_Y - .1, 11.4); pier.add(v); }
  // balde e caixa de pesca
  const balde = new THREE.Mesh(new THREE.CylinderGeometry(.16, .13, .3, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x3d6f9a, side: THREE.DoubleSide, roughness: .5 }));
  balde.position.set(-.75, DECK_Y + .17, 1.6); pier.add(balde);
  const caixa = new THREE.Mesh(new THREE.BoxGeometry(.45, .22, .25), new THREE.MeshStandardMaterial({ color: 0xa83a2a, roughness: .5 })); caixa.position.set(.8, DECK_Y + .13, 1.9); caixa.rotation.y = .3; pier.add(caixa);
  scene.add(pier);

  mundo.atualizarCeu = atualizarCeu.bind(null, mundo);
  return mundo;
}

/* ------------------------------ ciclo do dia ------------------------------ */
export const elevSol = h => Math.sin((h - 6.1) / 12.2 * Math.PI);
const C = (h) => new THREE.Color(h);
function atualizarCeu(m, hora, nuvens, t, camPos) {
  const e = elevSol(hora);
  // sol nasce a leste (+x), passa ao norte (−z, à frente do pescador) e se põe a oeste
  const phi = (hora - 6.1) / 12.2 * Math.PI;
  const sunDir = new THREE.Vector3(Math.cos(phi), Math.sin(phi) * .9, -.5).normalize();
  const su = m.sky.material.uniforms;
  su.sunPosition.value.copy(sunDir);
  su.uNoite.value = 1 - smooth((e + .12) / .22);
  su.turbidity.value = 4 + nuvens * 12; su.rayleigh.value = 1.2 + nuvens * 1.6 + (1 - smooth(e * 3)) * 1.2;
  const dia = smooth((e + .08) / .35), crep = Math.max(0, 1 - Math.abs(e) * 5) * (e > -.2 ? 1 : 0);
  const luz = clamp(.06 + .94 * dia, 0, 1) * (1 - .3 * nuvens);
  m.sol.position.copy(sunDir).multiplyScalar(300).add(camPos); m.sol.target.position.copy(camPos);
  m.sol.color.copy(C('#fff4e2')).lerp(C('#ff9a55'), crep * .8); m.sol.intensity = 2.8 * dia * (1 - .55 * nuvens);
  m.hemi.intensity = .15 + .85 * luz; m.hemi.color.copy(C('#cfe6ff')).lerp(C('#ffc49a'), crep * .5).lerp(C('#2a3456'), 1 - dia);
  m.hemi.groundColor.copy(C('#3a4a2a')).lerp(C('#0c1018'), 1 - dia);
  // lua oposta ao sol
  const md = sunDir.clone().multiplyScalar(-1); md.y = Math.max(md.y, .12);
  m.lua.position.copy(md).normalize().multiplyScalar(3200).add(camPos); m.lua.material.opacity = 1 - dia * .9;
  m.luaLuz.position.copy(m.lua.position); m.luaLuz.intensity = .35 * (1 - dia) * (1 - nuvens * .7);
  m.estrelas.material.opacity = (1 - smooth((e + .15) / .2)) * (1 - nuvens * .9); m.estrelas.position.copy(camPos);
  m.sky.position.copy(camPos);
  // neblina e cor do horizonte
  const fog = C('#a9c4d6').lerp(C('#e8a070'), crep * .7).lerp(C('#0a1020'), 1 - dia).lerp(C('#8a949c').multiplyScalar(luz + .1), nuvens * .5);
  m.scene.fog.color.copy(fog);
  if (m.agua.material.uniforms) {
    const u = m.agua.material.uniforms;
    u.sunDirection.value.copy(sunDir.y > 0 ? sunDir : md.normalize()); u.time.value = t * .5;
    u.sunColor.value.copy(m.sol.color).multiplyScalar(dia * (1 - nuvens * .7) + (1 - dia) * .15);
    u.waterColor.value.copy(C('#1d3a2e')).multiplyScalar(.25 + .75 * luz);
  } else if (m.normaisBaixa) { m.normaisBaixa.offset.set(t * .004, t * .003); m.agua.material.color.copy(C('#4f7468')).multiplyScalar(.3 + .7 * luz); }
  return { luz, dia, sunDir };
}
