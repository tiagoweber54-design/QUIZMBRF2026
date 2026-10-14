// Gerador procedural de peixes 3D (Three.js).
// Cada peixe é construído no espaço local com comprimento total = 1 (focinho em x=+0.5,
// fim da nadadeira caudal em x≈-0.5). Escale o grupo pelo comprimento real em metros.
import * as THREE from 'three';

const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x, m, s) => Math.exp(-((x - m) ** 2) / (2 * s * s));
function rng(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const hexRgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const rgba = (h, a = 1) => { const c = hexRgb(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
function mixHex(a, b, t) {
  const x = hexRgb(a), y = hexRgb(b);
  return '#' + x.map((v, i) => Math.round(lerp(v, y[i], t)).toString(16).padStart(2, '0')).join('');
}
const shadeHex = (h, k) => k < 0 ? mixHex(h, '#000000', -k) : mixHex(h, '#ffffff', k);
// interpolação cúbica monotônica (PCHIP) por pontos [t, valor]
export function pchip(pts) {
  const n = pts.length, x = pts.map(p => p[0]), y = pts.map(p => p[1]);
  const h = [], dl = [];
  for (let i = 0; i < n - 1; i++) { h[i] = x[i + 1] - x[i]; dl[i] = (y[i + 1] - y[i]) / h[i]; }
  const m = new Array(n).fill(0);
  m[0] = dl[0]; m[n - 1] = dl[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (dl[i - 1] * dl[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i]); }
  }
  return t => {
    if (t <= x[0]) return y[0]; if (t >= x[n - 1]) return y[n - 1];
    let i = 0; while (t > x[i + 1]) i++;
    const hh = h[i], u = (t - x[i]) / hh, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * y[i] + (u3 - 2 * u2 + u) * hh * m[i] + (-2 * u3 + 3 * u2) * y[i + 1] + (u3 - u2) * hh * m[i + 1];
  };
}
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/* ------------------------------------------------------------------ */
/* Modelo do corpo: perfis dorsal, ventral e largura ao longo de t      */
/* t = 0 no focinho, t = 1 no fim do pedúnculo caudal                  */
/* ------------------------------------------------------------------ */
const DEF_BODY = {
  D: .25, dposT: .35, dposB: .4, dposW: .3, topFrac: .55, ped: .32, pedY: 0,
  W: .6, Wp: .5, kTop: 2.2, kBot: 2, kW: 2.4, backT: 1.45, backB: 1.35, backW: 1.1,
  sf: .22, sfB: null, sfW: .3, cap: .035, nose: .55, noseLen: .24, rear: .1, side: 1,
  mouthY: 0, nTop: 2, nBot: 2.2, hump: null, belly: null, concave: 0, headW: null, cl: .2
};

export function modeloCorpo(body) {
  const b = { ...DEF_BODY, ...body };
  const bl = 1 - b.cl;
  // frente: parte da altura do focinho (sf) e cresce até o máximo; trás: afina de forma convexa
  const seg = (t, dp, k, back, y0, ym, yp, sf) => {
    if (t <= dp) { const u = t / dp; return lerp(y0, ym, sf + (1 - sf) * (1 - Math.pow(1 - u, k))); }
    const u = (t - dp) / (1 - dp); return lerp(ym, yp, Math.pow(u, back));
  };
  // arredondamento do focinho (calota)
  const capL = b.top ? (body.cap ?? .022) : b.cap;
  const cap = t => Math.sqrt(1 - Math.pow(1 - Math.min(1, t / capL), 2));
  const sfB = b.sfB ?? b.sf;
  const y0 = b.top ? (b.top[0][1] - b.bot[0][1]) / 2 * b.D : b.mouthY * b.D;
  const pedTop = b.D * b.ped * .5 + b.pedY * b.D, pedBot = b.D * b.ped * .5 - b.pedY * b.D;
  const fTop = b.top ? pchip(b.top) : null, fBot = b.bot ? pchip(b.bot) : null, fWid = b.wid ? pchip(b.wid) : null;
  const topR0 = t => {
    let v = seg(t, b.dposT, b.kTop, b.backT, y0, b.D * b.topFrac, pedTop, b.sf);
    if (b.hump) v += b.hump[0] * b.D * gauss(t, b.hump[1], b.hump[2]);
    if (b.concave) v -= b.concave * b.D * gauss(t, .1, .05) * smooth(t / .04);
    return v;
  };
  // afinamento do focinho e enchimento da parte traseira (silhuetas por pontos)
  const shp = t => lerp(b.nose, 1, Math.sqrt(smooth(t / b.noseLen))) * (1 + b.rear * Math.sin(Math.PI * clamp((t - .45) / .52, 0, 1)) ** 2);
  const topR = fTop ? (t => fTop(t) * b.D * shp(t)) : topR0;
  const botR0 = t => {
    let v = -seg(t, b.dposB, b.kBot, b.backB, -y0, b.D * (1 - b.topFrac), pedBot, sfB);
    if (b.belly) v -= b.belly[0] * b.D * gauss(t, b.belly[1], b.belly[2]);
    return v;
  };
  const botR = fBot ? (t => -fBot(t) * b.D * shp(t)) : botR0;
  const top = t => { const a = topR(t), z = botR(t), c = (a + z) / 2; return c + Math.max((a - z) / 2, 1e-5) * cap(t); };
  const bot = t => { const a = topR(t), z = botR(t), c = (a + z) / 2; return c - Math.max((a - z) / 2, 1e-5) * cap(t); };
  const wid = fWid ? (t => Math.max(fWid(t) * b.D * lerp(.8, 1, smooth(t / .16)) * cap(t), 0)) : t => {
    let v = seg(t, b.dposW, b.kW, b.backW, 0, b.W * b.D * .5, b.Wp * b.D * b.ped * .5, b.sfW);
    if (b.headW) v *= 1 + b.headW[0] * gauss(t, b.headW[1], b.headW[2]);
    return Math.max(v * cap(t), 0);
  };
  const X = t => .5 - t * bl;
  const pt = (t, th, out = new V3()) => {
    const tp = top(t), bt = bot(t), w = wid(t), c = (tp + bt) / 2, hh = Math.max((tp - bt) / 2, 1e-6);
    const s = Math.sin(th), co = Math.cos(th);
    const n = co >= 0 ? b.nTop : b.nBot;
    // side < 1 → flancos achatados e dorso/ventre em quilha (peixes comprimidos)
    const z = w * Math.sign(s) * Math.pow(Math.abs(s), 2 / n * b.side);
    const y = c + hh * Math.sign(co) * Math.pow(Math.abs(co), 2 / n);
    return out.set(X(t), y, z);
  };
  // comprimento de arco por radiano (para corrigir a proporção da textura)
  const dsdth = (t, th) => {
    const tp = top(t), bt = bot(t), hh = (tp - bt) / 2, w = wid(t);
    return Math.max(Math.hypot(hh * Math.sin(th), w * Math.cos(th)), 1e-4);
  };
  const center = t => (top(t) + bot(t)) / 2;
  const half = t => (top(t) - bot(t)) / 2;
  return { b, bl, top, bot, wid, X, pt, dsdth, center, half, y0 };
}

function geometriaCorpo(m, NT = 120, NA = 64) {
  const pos = [], uv = [], idx = [];
  const v = new V3();
  for (let i = 0; i <= NT; i++) {
    const u = i / NT, t = Math.pow(u, 1.35);
    for (let j = 0; j <= NA; j++) {
      const th = j / NA * Math.PI * 2;
      m.pt(t, th, v); pos.push(v.x, v.y, v.z); uv.push(t, j / NA);
    }
  }
  const row = NA + 1;
  for (let i = 0; i < NT; i++) for (let j = 0; j < NA; j++) {
    const a = i * row + j, b = a + row, c = b + 1, d = a + 1;
    idx.push(a, b, d, b, c, d);
  }
  // tampa da cauda
  const ci = pos.length / 3; pos.push(m.X(1), m.center(1), 0); uv.push(1, .5);
  const last = NT * row;
  for (let j = 0; j < NA; j++) idx.push(last + j, ci, last + j + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // costura dorsal: média das normais
  const n = g.attributes.normal;
  for (let i = 0; i <= NT; i++) {
    const a = i * row, b = a + NA;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  for (let j = 0; j <= NA; j++) n.setXYZ(j, 1, 0, 0);
  return g;
}

/* ------------------------------------------------------------------ */
/* Pintura da textura do corpo                                         */
/* ------------------------------------------------------------------ */
function pintarCorpo(sp, m, res) {
  const TW = res, SH = res / 4;          // meia textura (um lado)
  const side = document.createElement('canvas'); side.width = TW; side.height = SH;
  const bump = document.createElement('canvas'); bump.width = TW; bump.height = SH;
  const g = side.getContext('2d'), gb = bump.getContext('2d');
  const R = rng(hashStr(sp.id));
  const C = sp.colors;
  const px = t => t * TW;
  const py = h => Math.acos(clamp(h, -1, 1)) / Math.PI * SH;
  const rx = r => r / m.bl * TW;
  const ry = (r, t, h) => r / m.dsdth(t, Math.acos(clamp(h, -1, 1))) * SH / Math.PI;
  const blob = (ctx, t, h, r, color, a, hard = .45, rr = r) => {
    const x = px(t), y = py(h), sx = rx(r), sy = ry(rr, t, h);
    ctx.save(); ctx.translate(x, y); ctx.scale(Math.max(sx, .5), Math.max(sy, .5));
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gr.addColorStop(0, rgba(color, a)); gr.addColorStop(hard, rgba(color, a)); gr.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  };
  const softRect = (ctx, t0, t1, h0, h1, color, a) => {
    // retângulo suave em (t,h) desenhado como manchas sobrepostas
    const n = Math.ceil((t1 - t0) / .01);
    for (let i = 0; i <= n; i++) {
      const t = lerp(t0, t1, i / n);
      const y0 = py(h1), y1 = py(h0), x = px(t), w = TW / n * 1.6 + 2;
      const gr = ctx.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, rgba(color, 0)); gr.addColorStop(.25, rgba(color, a)); gr.addColorStop(.75, rgba(color, a)); gr.addColorStop(1, rgba(color, 0));
      const fade = smooth(Math.min(i / n, 1 - i / n) * 5);
      ctx.globalAlpha = fade; ctx.fillStyle = gr; ctx.fillRect(x - w / 2, y0, w, y1 - y0);
    }
    ctx.globalAlpha = 1;
  };

  // gradiente base dorso → flanco → ventre
  const stops = C.stops || [[0, C.back], [.3, C.back], [.48, C.flank], [.7, C.flank], [.86, C.belly], [1, C.belly]];
  let gr = g.createLinearGradient(0, 0, 0, SH);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr; g.fillRect(0, 0, TW, SH);
  // escurecimento leve na cabeça e no pedúnculo
  gr = g.createLinearGradient(0, 0, TW, 0);
  gr.addColorStop(0, 'rgba(0,0,0,.18)'); gr.addColorStop(.12, 'rgba(0,0,0,0)'); gr.addColorStop(.9, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.12)');
  g.fillStyle = gr; g.fillRect(0, 0, TW, SH);
  gb.fillStyle = '#808080'; gb.fillRect(0, 0, TW, SH);

  // padrões
  for (const p of sp.patterns || []) {
    const a = p.alpha ?? .7;
    if (p.type === 'tint') softRect(g, p.t[0], p.t[1], p.h[0], p.h[1], p.color, a);
    else if (p.type === 'bars') {
      for (const t of p.t) {
        const h0 = p.h?.[0] ?? -.3, h1 = p.h?.[1] ?? 1, n = 14;
        for (let i = 0; i <= n; i++) {
          const h = lerp(h0, h1, i / n), wob = p.wavy ? Math.sin(i * 1.3 + t * 40) * p.wavy : 0;
          blob(g, t + wob, h, p.w, p.color, a * (1 - .5 * Math.abs(i / n - .5)), .35, (h1 - h0) * .09 + p.w);
        }
      }
    } else if (p.type === 'spots' || p.type === 'mottle') {
      const n = p.n || 60;
      for (let i = 0; i < n; i++) {
        const t = lerp(p.tr?.[0] ?? .12, p.tr?.[1] ?? .97, R()), h = lerp(p.h?.[0] ?? -.4, p.h?.[1] ?? 1, R());
        const r = lerp(p.r[0], p.r[1], R());
        blob(g, t, h, r, p.color, a * lerp(.6, 1, R()), p.type === 'mottle' ? .2 : .7, r * (p.type === 'mottle' ? lerp(.6, 1.6, R()) : 1));
      }
    } else if (p.type === 'dotRows') {
      for (let k = 0; k < p.rows; k++) {
        const h = lerp(p.h[0], p.h[1], k / (p.rows - 1));
        for (let t = p.tr?.[0] ?? .2; t < (p.tr?.[1] ?? .98); t += p.step) blob(g, t + (k % 2) * p.step / 2, h, p.r, p.color, a, .6);
      }
    } else if (p.type === 'blob') blob(g, p.t, p.h, p.r, p.color, a, p.hard ?? .5, p.rr ?? p.r);
    else if (p.type === 'stripe') {
      const n = Math.ceil((p.t[1] - p.t[0]) / .004);
      for (let i = 0; i <= n; i++) { const t = lerp(p.t[0], p.t[1], i / n); blob(g, t, typeof p.h === 'function' ? p.h(t) : p.h, p.w * .7, p.color, a * smooth(Math.min(i, n - i) / 8), .5, p.w); }
    } else if (p.type === 'ocellus') {
      blob(g, p.t, p.h, p.r * 1.35, p.ring, a, .62); blob(g, p.t, p.h, p.r, p.color, 1, .8);
    } else if (p.type === 'reticulate') {
      g.strokeStyle = rgba(p.color, a); g.lineCap = 'round';
      for (const t0 of p.t) {
        g.lineWidth = rx(p.w); g.beginPath();
        for (let i = 0; i <= 20; i++) { const h = lerp(1, p.h0 ?? -.2, i / 20); const t = t0 + Math.sin(i * .9 + t0 * 30) * .012 + (R() - .5) * .004; i ? g.lineTo(px(t), py(h)) : g.moveTo(px(t), py(h)); }
        g.stroke();
        if (R() < .7) { const hh = lerp(.2, .7, R()); g.beginPath(); g.moveTo(px(t0), py(hh)); g.quadraticCurveTo(px(t0 + .025), py(hh + .15), px(t0 + .05), py(hh)); g.stroke(); }
      }
    } else if (p.type === 'sparkle') {
      for (let i = 0; i < (p.n || 300); i++) { const t = R() * .95 + .03, h = lerp(-.7, .9, R()); g.fillStyle = rgba(p.color || '#ffffff', a * R()); g.fillRect(px(t), py(h), 1.5, 1.5); }
    }
  }

  // escamas / placas
  const sc = sp.scales || { size: 0 };
  if (sc.size > 0) {
    const plates = sc.type === 'plates';
    const halfPer = Math.PI * m.dsdth(.35, Math.PI / 2) * .9;
    const rows = Math.max(4, Math.round(halfPer / (sc.size * (plates ? .9 : .62))));
    const cols = Math.round(m.bl / (sc.size * (plates ? .8 : .6)));
    const t0 = sc.from ?? .2;
    for (let c = cols; c >= 0; c--) {
      const t = t0 + (1 - t0) * c / cols;
      if (t > .995) continue;
      for (let r = 0; r <= rows; r++) {
        const th = (r + (c % 2) * .5) / rows * Math.PI; if (th > Math.PI) continue;
        const h = Math.cos(th), x = px(t), y = th / Math.PI * SH;
        const jit = plates ? lerp(.85, 1.15, R()) : 1;
        const sx = rx(sc.size * (plates ? .55 : .62) * jit), sy = ry(sc.size * (plates ? .62 : .55) * jit, t, h);
        // relevo
        gb.save(); gb.translate(x, y); gb.scale(sx, sy);
        const grd = gb.createRadialGradient(-.35, 0, 0, -.2, 0, 1.05);
        grd.addColorStop(0, plates ? '#b8b8b8' : '#a4a4a4'); grd.addColorStop(.75, '#8a8a8a'); grd.addColorStop(1, '#585858');
        gb.fillStyle = grd; gb.beginPath(); plates ? gb.ellipse(0, 0, 1.05, 1, 0, 0, Math.PI * 2) : gb.arc(0, 0, 1, 0, Math.PI * 2); gb.fill();
        if (plates) { gb.strokeStyle = '#d0d0d0'; gb.lineWidth = .12; gb.beginPath(); gb.moveTo(-.8, 0); gb.lineTo(.8, 0); gb.stroke(); }
        gb.restore();
        // contorno colorido
        const edgeK = sc.edgeColor ? smooth((t - (sc.edgeFrom ?? 0)) / .35) : 0;
        const ec = edgeK > 0 ? mixHex(sc.edge || '#000000', sc.edgeColor, edgeK) : (sc.edge || '#000000');
        g.save(); g.translate(x, y); g.scale(sx, sy);
        g.strokeStyle = rgba(ec, (sc.contrast ?? .25) * (edgeK > 0 ? lerp(.5, 1.8, edgeK) : 1));
        g.lineWidth = (plates ? .16 : .13) * (sc.line ?? 1);
        g.beginPath(); plates ? g.arc(0, 0, 1, -Math.PI * .6, Math.PI * .6) : g.arc(0, 0, 1, -Math.PI * .5, Math.PI * .5); g.stroke();
        if (sc.shine) { g.fillStyle = `rgba(255,255,255,${sc.shine * R()})`; g.beginPath(); g.arc(-.25, -.2, .5, 0, Math.PI * 2); g.fill(); }
        g.restore();
      }
    }
  } else {
    // pele (couro): textura sutil
    for (let i = 0; i < 2600; i++) { gb.fillStyle = R() < .5 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.06)'; gb.fillRect(R() * TW, R() * SH, 2, 2); }
  }

  // linha lateral
  if (sp.lateral !== false) {
    const lh = sp.lateralH ?? .28;
    const hAt = t => lerp(lh, .02, smooth((t - .2) / .7));
    g.strokeStyle = rgba(sp.lateralColor || shadeHex(C.flank, .35), .55); g.lineWidth = Math.max(1, SH * .006);
    gb.strokeStyle = '#6a6a6a'; gb.lineWidth = Math.max(1, SH * .008);
    for (const ctx of [g, gb]) { ctx.beginPath(); for (let t = .2; t <= 1; t += .01) { const x = px(t), y = py(hAt(t)); t === .2 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
  }
  // opérculo
  const op = sp.opercle ?? .22;
  for (const ctx of [g, gb]) {
    ctx.strokeStyle = ctx === g ? 'rgba(0,0,0,.16)' : '#5a5a5a'; ctx.lineWidth = Math.max(1.5, TW * .0022);
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const h = lerp(.75, -.8, i / 24); const t = op - .03 + .05 * Math.sin(i / 24 * Math.PI); i ? ctx.lineTo(px(t), py(h)) : ctx.moveTo(px(t), py(h)); }
    ctx.stroke();
  }
  // boca
  const mo = sp.mouth || {};
  if (mo.gape) {
    const y0 = m.y0;
    const slope = mo.slope ?? 0;
    for (const ctx of [g, gb]) {
      ctx.strokeStyle = ctx === g ? 'rgba(25,10,10,.85)' : '#303030'; ctx.lineWidth = Math.max(2, TW * .003);
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) {
        const t = .002 + mo.gape * i / 16, yy = y0 - slope * (t * m.bl);
        const h = clamp((yy - m.center(t)) / m.half(t), -.97, .97);
        i ? ctx.lineTo(px(t), py(h)) : ctx.moveTo(px(t), py(h));
      }
      ctx.stroke();
    }
  }

  // monta textura completa (lado direito em cima, esquerdo espelhado embaixo)
  const full = document.createElement('canvas'); full.width = TW; full.height = SH * 2;
  const fb = document.createElement('canvas'); fb.width = TW; fb.height = SH * 2;
  for (const [src, dst] of [[side, full], [bump, fb]]) {
    const c = dst.getContext('2d'); c.drawImage(src, 0, 0);
    c.save(); c.translate(0, SH * 2); c.scale(1, -1); c.drawImage(src, 0, 0); c.restore();
  }
  const map = new THREE.CanvasTexture(full); map.colorSpace = THREE.SRGBColorSpace; map.flipY = false;
  const bmp = new THREE.CanvasTexture(fb); bmp.flipY = false;
  for (const t of [map, bmp]) { t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; }
  return { map, bump: bmp, canvas: full };
}

/* ------------------------------------------------------------------ */
/* Nadadeiras                                                          */
/* ------------------------------------------------------------------ */
const PERFIS = {
  tri: s => s < .14 ? lerp(.55, 1, smooth(s / .14)) : lerp(1, .14, Math.pow((s - .14) / .86, .75)),
  falcate: s => s < .07 ? lerp(.6, 1, s / .07) : lerp(1, .16, Math.pow((s - .07) / .93, .42)),
  round: s => .25 + .75 * Math.pow(Math.sin(Math.PI * clamp(s * .86 + .1, 0, 1)), .7),
  long: s => .35 + .65 * Math.sin(Math.PI * (.18 + .7 * s)),
  low: s => .5 + .5 * Math.sin(Math.PI * clamp(s, 0, 1)),
  trailing: s => .3 + .7 * Math.pow(s, 1.6),
  sail: s => s < .08 ? lerp(.6, 1, s / .08) : lerp(1, .5, Math.pow((s - .08) / .92, 1.2)),
  spiny: s => {
    const n = .6;
    if (s < n) return .5 + .38 * Math.sin(Math.PI * Math.min(1, s / n * 1.15)) - .18 * (s / n) ** 3;
    return .42 + .58 * Math.sin(Math.PI * ((s - n) / (1 - n) * .85 + .12));
  },
  adipose: s => Math.pow(Math.sin(Math.PI * s), .65),
  adiposeLong: s => Math.pow(Math.min(1, Math.sin(Math.PI * s) * 2.2), .8),
  paired: s => .45 + .55 * Math.sin(Math.PI * clamp(s * .8 + .15, 0, 1)),
  pairedPointed: s => s < .2 ? lerp(.7, 1, s / .2) : lerp(1, .3, (s - .2) / .8),
};
function perfilCaudal(c) {
  const fd = c.fork ?? .5, asym = c.asym ?? 0;
  const base = s => {
    const e = Math.abs(2 * s - 1);
    switch (c.shape) {
      case 'round': return .55 + .45 * Math.sqrt(Math.max(0, 1 - e * e * .85));
      case 'truncate': return (.86 + .14 * e) * (e > .9 ? lerp(1, .8, (e - .9) / .1) : 1);
      case 'emarginate': return (.72 + .28 * Math.pow(e, 1.6)) * (e > .88 ? lerp(1, .78, (e - .88) / .12) : 1);
      case 'pointed': return .35 + .65 * Math.pow(1 - e, 1.1);
      case 'forkRound': { let v = fd + (1 - fd) * Math.pow(e, 1.2); if (e > .7) v *= lerp(1, .55, Math.pow((e - .7) / .3, 1.6)); return v; }
      default: { let v = fd + (1 - fd) * Math.pow(e, 1.35); if (e > .86) v *= lerp(1, .72, (e - .86) / .14); return v; }
    }
  };
  return s => base(s) * (1 + asym * (s - .5) * 2);
}

function geometriaNadadeira(P, D, L, { ns = 32, nr = 10, pleat = .018, rays = 14 } = {}) {
  const pos = [], uv = [], idx = [];
  const p = new V3(), d = new V3(), a = new V3(), b = new V3(), tan = new V3(), nrm = new V3();
  for (let i = 0; i <= ns; i++) {
    const s = i / ns;
    P(s, p); D(s, d); const len = L(s);
    P(Math.min(1, s + .02), a); P(Math.max(0, s - .02), b); tan.subVectors(a, b);
    if (tan.lengthSq() < 1e-10) tan.set(1, 0, 0);
    nrm.crossVectors(tan.normalize(), d).normalize();
    const pl = Math.sin(s * Math.PI * rays) * pleat * len;
    for (let j = 0; j <= nr; j++) {
      const r = j / nr;
      pos.push(p.x + d.x * len * r + nrm.x * pl * r, p.y + d.y * len * r + nrm.y * pl * r, p.z + d.z * len * r + nrm.z * pl * r);
      uv.push(s, r);
    }
  }
  const row = nr + 1;
  for (let i = 0; i < ns; i++) for (let j = 0; j < nr; j++) {
    const q = i * row + j; idx.push(q, q + row, q + 1, q + row, q + row + 1, q + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function pintarNadadeira(sp, c, rays, kind, res) {
  const W = res, H = res;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const R = rng(hashStr(sp.id + kind));
  const fc = { ...(sp.finColor || {}), ...c };
  const base = fc.color || mixHex(sp.colors.flank, sp.colors.back, .5);
  const tip = fc.tip || base;
  const a0 = fc.alpha ?? .78;
  if (kind === 'adipose' && !c.rays) {
    const col = c.color || mixHex(sp.colors.back, sp.colors.flank, .4);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, col); gr.addColorStop(1, c.tip || shadeHex(col, -.15));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    if (c.edge) { g.fillStyle = c.edge; g.fillRect(0, H * .8, W, H * .2); }
    return tex(cv);
  }
  // membrana
  let gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, rgba(base, Math.min(1, a0 + .15))); gr.addColorStop(.55, rgba(mixHex(base, tip, .5), a0)); gr.addColorStop(1, rgba(tip, a0 * .82));
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // faixas e listras
  if (fc.band) { g.fillStyle = rgba(fc.band.color, fc.band.alpha ?? .85); g.fillRect(0, H * fc.band.from, W, H * (fc.band.to - fc.band.from)); }
  if (fc.stripe) {
    const sw = W * (fc.stripe.w ?? .12);
    gr = g.createLinearGradient(W / 2 - sw, 0, W / 2 + sw, 0);
    gr.addColorStop(0, rgba(fc.stripe.color, 0)); gr.addColorStop(.3, rgba(fc.stripe.color, .95)); gr.addColorStop(.7, rgba(fc.stripe.color, .95)); gr.addColorStop(1, rgba(fc.stripe.color, 0));
    g.fillStyle = gr; g.fillRect(W / 2 - sw, 0, sw * 2, H * (fc.stripe.len ?? .9));
  }
  if (fc.lobes) { // pontas dos lobos coloridas (caudal)
    for (const x0 of [0, W * .72]) { gr = g.createLinearGradient(0, H * .3, 0, H); gr.addColorStop(0, rgba(fc.lobes, 0)); gr.addColorStop(1, rgba(fc.lobes, .9)); g.fillStyle = gr; g.fillRect(x0, H * .3, W * .28, H * .7); }
  }
  if (fc.spots) {
    const s = fc.spots;
    for (let i = 0; i < (s.n || 30); i++) {
      const k = Math.floor(R() * rays), x = (k + .5) / rays * W + (R() - .5) * W / rays * .6, y = lerp(.1, .92, R()) * H;
      g.fillStyle = rgba(s.color, s.alpha ?? .85); g.beginPath(); g.ellipse(x, y, W * (s.r ?? .018), H * (s.r ?? .018) * 1.3, 0, 0, Math.PI * 2); g.fill();
    }
  }
  if (fc.bars) {
    for (let k = 0; k < fc.bars.n; k++) { const y = (k + .5) / fc.bars.n * H; g.fillStyle = rgba(fc.bars.color, fc.bars.alpha ?? .6); g.fillRect(0, y - H * .03, W, H * .06); }
  }
  // raios
  const rc = fc.rayColor || shadeHex(base, -.35);
  for (let k = 0; k < rays; k++) {
    const x = (k + .5) / rays * W, dx = W / rays * .18, lw = Math.max(1, W / rays * .14);
    const strong = fc.spine && k === 0;
    g.strokeStyle = rgba(strong ? shadeHex(rc, -.3) : rc, strong ? 1 : .75);
    g.lineWidth = strong ? lw * 2.4 : lw;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H * .55); g.stroke();
    g.lineWidth = lw * .7;
    g.beginPath(); g.moveTo(x, H * .55); g.lineTo(x - dx, H); g.moveTo(x, H * .55); g.lineTo(x + dx, H); g.stroke();
  }
  if (fc.edge) {
    gr = g.createLinearGradient(0, H * (1 - (fc.edgeW ?? .14)), 0, H);
    gr.addColorStop(0, rgba(fc.edge, 0)); gr.addColorStop(.4, rgba(fc.edge, .95)); gr.addColorStop(1, rgba(fc.edge, .95));
    g.fillStyle = gr; g.fillRect(0, H * (1 - (fc.edgeW ?? .14)), W, H * (fc.edgeW ?? .14));
  }
  if (fc.ocellus) {
    const o = fc.ocellus, x = W * (o.s ?? .5), y = H * (o.r ?? .16), rr = W * (o.size ?? .13);
    g.fillStyle = rgba(o.ring || '#f2c040', .95); g.beginPath(); g.ellipse(x, y, rr * 1.3, rr * 1.3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = rgba(o.color || '#141408', 1); g.beginPath(); g.ellipse(x, y, rr, rr, 0, 0, Math.PI * 2); g.fill();
  }
  // borda franjada entre os raios
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k <= rays; k++) {
    const x = k / rays * W, d = H * (.05 + R() * .05);
    g.beginPath(); g.moveTo(x - W / rays * .45, H + 1); g.lineTo(x, H - d); g.lineTo(x + W / rays * .45, H + 1); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  return tex(cv);
}
function tex(cv) { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; return t; }

/* ------------------------------------------------------------------ */
/* Animação de natação (deformação no vertex shader)                  */
/* ------------------------------------------------------------------ */
const SWIM = `
uniform float uTime; uniform float uAmp; uniform float uFreq; uniform float uK; uniform float uTurn;
float swBx(float x){ return clamp(0.5 - x, 0.0, 1.3); }
float swZ(float x){ float bx=swBx(x); float a=uAmp*(0.03+bx*bx); return a*sin(uTime*uFreq - bx*uK) + uTurn*bx*bx; }
float swD(float x){ float bx=swBx(x); float a=uAmp*(0.03+bx*bx); float ph=uTime*uFreq-bx*uK;
  return -(uAmp*2.0*bx*sin(ph) - a*uK*cos(ph) + 2.0*uTurn*bx); }
`;
function patchNatacao(mat, U) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = SWIM + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        { float sl = swD(position.x); objectNormal = normalize(vec3(objectNormal.x - sl*objectNormal.z, objectNormal.y, objectNormal.z)); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.z += swZ(position.x);`);
  };
  mat.customProgramCacheKey = () => 'peixe-natacao';
  return mat;
}

/* ------------------------------------------------------------------ */
/* Montagem do peixe                                                   */
/* ------------------------------------------------------------------ */
export function criarPeixe(sp, opts = {}) {
  const res = opts.res ?? 2048, finRes = opts.finRes ?? Math.max(128, res / 4);
  const m = modeloCorpo(sp.body);
  const U = {
    uTime: { value: Math.random() * 10 }, uAmp: { value: sp.swim?.amp ?? .07 },
    uFreq: { value: sp.swim?.freq ?? 6 }, uK: { value: sp.swim?.k ?? 5.5 }, uTurn: { value: 0 }
  };
  const mats = [];
  const mk = (o) => { const mat = patchNatacao(new THREE.MeshPhysicalMaterial(o), U); mats.push(mat); return mat; };
  const grupo = new THREE.Group(); grupo.name = sp.id;

  // corpo
  const T = pintarCorpo(sp, m, res);
  const mt = sp.mat || {};
  const bodyMat = mk({
    map: T.map, bumpMap: T.bump, bumpScale: mt.bump ?? 2.2,
    roughness: mt.rough ?? .42, metalness: mt.metal ?? .12,
    clearcoat: mt.clear ?? .45, clearcoatRoughness: .32,
    iridescence: mt.irid ?? .25, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520],
    sheen: mt.sheen ?? 0, sheenColor: new THREE.Color(sp.colors.flank),
  });
  const corpo = new THREE.Mesh(geometriaCorpo(m, opts.nt ?? 120, opts.na ?? 64), bodyMat);
  corpo.name = 'corpo'; grupo.add(corpo);

  // nadadeiras
  const finMat = (c, rays, kind) => mk({
    map: pintarNadadeira(sp, c, rays, kind, finRes), transparent: true, side: THREE.DoubleSide,
    roughness: kind === 'adipose' ? .45 : .5, metalness: 0, clearcoat: .35, clearcoatRoughness: .4,
    depthWrite: kind === 'adipose', alphaTest: .02,
  });
  const addFin = (P, D, L, c, kind, raysN) => {
    const rays = raysN ?? c.rays ?? (kind === 'adipose' ? 1 : 12);
    const geo = geometriaNadadeira(P, D, L, { rays: kind === 'adipose' ? 0 : rays, pleat: kind === 'adipose' ? 0 : (c.pleat ?? .011) });
    const mesh = new THREE.Mesh(geo, finMat(c, rays, kind)); mesh.name = kind; mesh.renderOrder = kind === 'adipose' ? 0 : 2;
    grupo.add(mesh); return mesh;
  };
  const F = sp.fins || {};
  const lista = v => v ? (Array.isArray(v) ? v : [v]) : [];
  // dorsais (e adiposa)
  for (const [kind, arr] of [['dorsal', lista(F.dorsal)], ['adipose', lista(F.adipose)]]) {
    for (const c of arr) {
      const prof = PERFIS[c.shape || (kind === 'adipose' ? 'adipose' : 'tri')];
      const sw0 = c.sweep?.[0] ?? (kind === 'adipose' ? .5 : .32), sw1 = c.sweep?.[1] ?? (kind === 'adipose' ? 1.25 : 1.05);
      addFin(
        (s, o) => { const t = lerp(c.t[0], c.t[1], s); return o.set(m.X(t), m.top(t) - .003, 0); },
        (s, o) => { const a = lerp(sw0, sw1, s); return o.set(-Math.sin(a), Math.cos(a), 0); },
        s => c.h * prof(s), c, kind);
    }
  }
  // anal
  for (const c of lista(F.anal)) {
    const prof = PERFIS[c.shape || 'tri'], sw0 = c.sweep?.[0] ?? .4, sw1 = c.sweep?.[1] ?? 1.1;
    addFin(
      (s, o) => { const t = lerp(c.t[0], c.t[1], s); return o.set(m.X(t), m.bot(t) + .003, 0); },
      (s, o) => { const a = lerp(sw0, sw1, s); return o.set(-Math.sin(a), -Math.cos(a), 0); },
      s => c.h * prof(s), c, 'anal');
  }
  // caudal
  if (F.caudal) {
    const c = F.caudal, prof = perfilCaudal(c), spread = c.spread ?? (c.shape === 'round' || c.shape === 'pointed' ? .62 : .55);
    const cl = (c.len ?? m.b.cl) * 1.04, yb = m.bot(1), yt = m.top(1), tilt = c.tilt ?? 0;
    addFin(
      (s, o) => o.set(m.X(1) + .035, lerp(yb, yt, s) * 1.08 + (yt + yb) / 2 * -.08, 0),
      (s, o) => { const a = lerp(-spread, spread, s) + tilt; return o.set(-Math.cos(a), Math.sin(a), 0); },
      s => cl / Math.cos(spread * .55) * prof(s), c, 'caudal', c.rays ?? 18);
    if (c.filament) {
      const fl = c.filament;
      addFin(
        (s, o) => o.set(m.X(1) - cl * .85, yt + cl * .35 + s * .006, 0),
        (s, o) => o.set(-Math.cos(spread * .8), Math.sin(spread * .55), 0),
        s => fl * (1 - Math.abs(s - .5)), { ...c, ocellus: null, stripe: null }, 'caudal', 2);
    }
  }
  // peitorais e pélvicas (pares)
  for (const side of [1, -1]) {
    for (const c of lista(F.pectoral)) {
      const th0 = Math.PI / 2 + (c.y ?? .45);
      const base = c.base ?? .035;
      const prof = PERFIS[c.shape || 'paired'];
      addFin(
        (s, o) => { m.pt(c.t + s * base * .5, side > 0 ? th0 + s * .35 : 2 * Math.PI - th0 - s * .35, o); o.z -= side * .002; return o; },
        (s, o) => o.set(-1, -(c.drop ?? .25) + (s - .5) * (c.fan ?? .4), side * (c.out ?? .5)).normalize(),
        s => c.len * prof(s), c, 'pectoral');
    }
    for (const c of lista(F.pelvic)) {
      const th0 = Math.PI - (c.th ?? .35);
      const prof = PERFIS[c.shape || 'paired'];
      addFin(
        (s, o) => { m.pt(c.t + s * .035, side > 0 ? th0 : 2 * Math.PI - th0, o); o.y += .002; return o; },
        (s, o) => o.set(-1, -(c.drop ?? .6) + (s - .5) * .25, side * (c.out ?? .35)).normalize(),
        s => c.len * prof(s), c, 'pelvic');
    }
  }

  // olhos
  const E = sp.eye || { t: .09, y: .4, r: .02 };
  const eyeGeo = new THREE.SphereGeometry(1, 28, 20);
  const irisMat = mk({ color: E.iris || '#d8c060', roughness: .25, clearcoat: 1, clearcoatRoughness: .05 });
  const pupMat = mk({ color: '#050505', roughness: .05, clearcoat: 1, clearcoatRoughness: 0 });
  for (const side of [1, -1]) {
    const th = Math.acos(clamp(E.y, -.98, .98)), p = m.pt(E.t, side > 0 ? th : 2 * Math.PI - th);
    const n = new V3(0, p.y - m.center(E.t), p.z).normalize();
    n.x = .12; n.normalize();
    const eye = new THREE.Mesh(eyeGeo, irisMat); eye.scale.setScalar(E.r);
    eye.position.copy(p).addScaledVector(n, -E.r * (E.sunk ?? .45));
    const pup = new THREE.Mesh(eyeGeo, pupMat); pup.scale.setScalar(E.r * (E.pupil ?? .58));
    pup.position.copy(eye.position).addScaledVector(n, E.r * .52);
    grupo.add(eye, pup);
  }

  // barbilhões
  const barbMat = mk({ color: sp.barbelColor || shadeHex(sp.colors.back, -.1), roughness: .55, clearcoat: .3 });
  for (const bb of sp.barbels || []) {
    for (const side of [1, -1]) {
      for (let k = 0; k < (bb.n || 1); k++) {
        let p0, pts;
        const L = bb.len * (1 - k * .25);
        if (bb.at === 'max') {
          const t = (sp.mouth?.gape ?? .06) * .85;
          p0 = m.pt(t, side > 0 ? Math.PI * .58 : Math.PI * 1.42);
          pts = [p0, p0.clone().add(new V3(-.08 * L, -.02 * L, .32 * L * side)), p0.clone().add(new V3(-.5 * L, -.18 * L * (bb.droop ?? 1), .5 * L * side)), p0.clone().add(new V3(-.95 * L, -.32 * L * (bb.droop ?? 1), .42 * L * side))];
        } else if (bb.at === 'nasal') {
          p0 = m.pt(.025, side > 0 ? Math.PI * .3 : Math.PI * 1.7);
          pts = [p0, p0.clone().add(new V3(.1 * L, .4 * L, .2 * L * side)), p0.clone().add(new V3(-.2 * L, .7 * L, .4 * L * side))];
        } else if (bb.at === 'forward') {
          p0 = m.pt(.015, side > 0 ? Math.PI * .97 : Math.PI * 1.03);
          pts = [p0, p0.clone().add(new V3(.5 * L, -.05 * L, .05 * L * side)), p0.clone().add(new V3(1 * L, .1 * L, .1 * L * side))];
        } else { // queixo
          const t = .03 + k * .025;
          p0 = m.pt(t, side > 0 ? Math.PI * (.9 - k * .04) : Math.PI * (1.1 + k * .04));
          pts = [p0, p0.clone().add(new V3(-.15 * L, -.45 * L, .12 * L * side)), p0.clone().add(new V3(-.6 * L, -.8 * L, .25 * L * side))];
        }
        const geo = tuboAfilado(new THREE.CatmullRomCurve3(pts), bb.r * (1 - k * .2), bb.flat ?? 1);
        grupo.add(new THREE.Mesh(geo, barbMat));
      }
    }
  }

  // dentes
  if (sp.teeth) {
    const tm = mk({ color: '#f2efe6', roughness: .3, clearcoat: .6 });
    const cone = new THREE.ConeGeometry(1, 1, 8);
    const y0 = m.y0;
    const add = (p, s, len, rot) => { const c = new THREE.Mesh(cone, tm); c.scale.set(s, len, s); c.position.copy(p); c.rotation.z = rot; grupo.add(c); };
    if (sp.teeth === 'fangs') {
      for (const side of [1, -1]) { const p = new V3(m.X(.012), y0 + .004, side * .01); add(p, .006, .05, -.25); }
    } else {
      const n = sp.teeth === 'row' ? 8 : 5, gape = sp.mouth?.gape ?? .06;
      for (const side of [1, -1]) for (let i = 0; i < n; i++) {
        const t = .006 + gape * .8 * i / n, p = new V3(m.X(t), y0 - .002, side * m.wid(t) * .78);
        add(p, .0035 * (sp.teeth === 'row' ? 1.3 : 1), .012, side * 0);
      }
    }
  }
  // lábios / ventosa
  if (sp.extra === 'ventosa') {
    const d = mk({ color: '#8a6e56', roughness: .7 });
    const disc = new THREE.Mesh(new THREE.TorusGeometry(.028, .012, 10, 28), d);
    disc.position.set(m.X(.045), m.bot(.045) + .004, 0); disc.rotation.x = Math.PI / 2; disc.scale.set(1.2, 1, 1);
    grupo.add(disc);
  } else if (sp.extra === 'labios') {
    const d = mk({ color: '#a69a8a', roughness: .5, clearcoat: .4 });
    const lip = new THREE.Mesh(new THREE.TorusGeometry(.016, .007, 10, 24), d);
    const y0 = m.y0;
    lip.position.set(m.X(0) + .002, y0, 0); lip.rotation.y = Math.PI / 2; lip.scale.set(1, 1.15, 1);
    grupo.add(lip);
  }

  for (const mat of mats) if (opts.envIntensity != null) mat.envMapIntensity = opts.envIntensity;
  grupo.userData = {
    sp, modelo: m, uniforms: U, materiais: mats, textura: T.canvas,
    nadar(t, amp) { U.uTime.value = t; if (amp != null) U.uAmp.value = amp; },
    dispose() { grupo.traverse(o => { if (o.geometry) o.geometry.dispose(); }); for (const mat of mats) { mat.map?.dispose(); mat.bumpMap?.dispose(); mat.dispose(); } }
  };
  return grupo;
}

function tuboAfilado(curve, r, flat = 1, seg = 24, rs = 8) {
  const frames = curve.computeFrenetFrames(seg, false);
  const pos = [], idx = [], p = new V3();
  for (let i = 0; i <= seg; i++) {
    const u = i / seg; curve.getPointAt(u, p);
    const N = frames.normals[i], B = frames.binormals[i], rr = r * (1 - .85 * u);
    for (let j = 0; j <= rs; j++) {
      const a = j / rs * Math.PI * 2, cx = Math.cos(a) * rr, cy = Math.sin(a) * rr * flat;
      pos.push(p.x + N.x * cx + B.x * cy, p.y + N.y * cx + B.y * cy, p.z + N.z * cx + B.z * cy);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rs; j++) {
    const a = i * (rs + 1) + j, b = a + rs + 1; idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export { pintarCorpo, PERFIS };
