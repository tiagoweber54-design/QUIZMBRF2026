// Comportamento de pesca de cada espécie (usado pela IA dos peixes e pela briga).
// d: faixa de profundidade preferida (m) · fundo: vive junto ao fundo
// pref: atração por isca (0–1) · act: atividade base/amanhecer-entardecer/dia/noite
// ab: abundância relativa · forca: puxada por kg · kgTl: peso no comprimento típico
// nib: beliscadas antes de morder · jan: janela de fisgada (s) · salto: tendência a saltar
// estrutura: tendência a correr para a galhada · rouba: chance extra de roubar a isca

const P = (minhoca, milho, massa, vivo, artificial) => ({ minhoca, milho, massa, vivo, artificial });

export const COMPORTAMENTO = {
  'tucunare-acu':     { d: [.3, 3],   forca: 1.1,  pref: P(.1, 0, 0, .85, 1),   act: { b: .25, dd: .4, dia: .7, noite: -.45 }, ab: 3,   salto: .5,  kgTl: 3.2, nib: [0, 0], jan: .6,  estrutura: .8 },
  'tucunare-amarelo': { d: [.3, 3],   forca: 1.05, pref: P(.1, 0, 0, .85, 1),   act: { b: .25, dd: .4, dia: .75, noite: -.45 }, ab: 7,  salto: .45, kgTl: .9,  nib: [0, 0], jan: .6,  estrutura: .8 },
  'tucunare-azul':    { d: [.3, 3.5], forca: 1.1,  pref: P(.1, 0, 0, .85, 1),   act: { b: .25, dd: .4, dia: .7, noite: -.45 }, ab: 5,   salto: .45, kgTl: 1.8, nib: [0, 0], jan: .6,  estrutura: .8 },
  'apaiari':          { d: [.3, 2.5], forca: .8,   pref: P(.7, .1, .2, .5, .5), act: { b: .4, dd: .3, dia: .4, noite: -.2 },   ab: 5,   salto: .1,  kgTl: .35, nib: [1, 2], jan: .7,  estrutura: .6 },
  'dourado':          { d: [.5, 4],   forca: 1.3,  pref: P(.1, 0, 0, .95, .95), act: { b: .3, dd: .6, dia: .5, noite: -.35 },  ab: 3,   salto: .8,  kgTl: 3.5, nib: [0, 0], jan: .5,  estrutura: .4 },
  'matrinxa':         { d: [.3, 3],   forca: 1.15, pref: P(.4, .7, .6, .3, .5), act: { b: .35, dd: .4, dia: .5, noite: -.3 },  ab: 6,   salto: .4,  kgTl: 1.1, nib: [1, 3], jan: .55, estrutura: .3 },
  'piraputanga':      { d: [.3, 2.5], forca: 1.1,  pref: P(.4, .7, .5, .2, .5), act: { b: .35, dd: .4, dia: .5, noite: -.3 },  ab: 6,   salto: .4,  kgTl: .55, nib: [1, 3], jan: .55, estrutura: .3 },
  'curimbata':        { d: [1, 6],    forca: .9,   pref: P(.4, .5, .9, 0, 0),   act: { b: .45, dd: .3, dia: .2, noite: .1 },   ab: 8,   salto: .05, kgTl: 1.1, nib: [2, 5], jan: .7,  estrutura: .3, fundo: true },
  'piau-tres-pintas': { d: [.6, 4],   forca: 1.0,  pref: P(.55, .75, .8, .05, .03), act: { b: .45, dd: .4, dia: .3, noite: -.2 }, ab: 9, salto: .05, kgTl: .3, nib: [2, 5], jan: .5, estrutura: .3 },
  'lambari':          { d: [.2, 2.2], forca: 1.6,  pref: P(.9, .35, .85, 0, .03), act: { b: .5, dd: .35, dia: .3, noite: -.4 }, ab: 20, salto: 0,   kgTl: .015, nib: [2, 6], jan: .42, estrutura: .2 },
  'traira':           { d: [.2, 2.5], forca: .7,   pref: P(.35, 0, .02, .95, .75), act: { b: .25, dd: .7, dia: -.1, noite: .55 }, ab: 9, salto: .05, kgTl: .7, nib: [0, 1], jan: 1.3, estrutura: 1 },
  'trairao':          { d: [.3, 3],   forca: .85,  pref: P(.2, 0, 0, .95, .8),  act: { b: .2, dd: .6, dia: -.1, noite: .5 },   ab: 2,   salto: .05, kgTl: 4,   nib: [0, 1], jan: 1.2, estrutura: 1 },
  'cachorra':         { d: [.5, 4],   forca: 1.15, pref: P(.1, 0, 0, .9, .9),   act: { b: .3, dd: .5, dia: .5, noite: -.3 },   ab: 3,   salto: .6,  kgTl: .9,  nib: [0, 0], jan: .45, estrutura: .3 },
  'bicuda':           { d: [.2, 1.5], forca: 1.0,  pref: P(.1, 0, 0, .8, .95),  act: { b: .3, dd: .4, dia: .6, noite: -.4 },   ab: 3,   salto: .7,  kgTl: 1.2, nib: [0, 0], jan: .45, estrutura: .3 },
  'tambaqui':         { d: [1.5, 6],  forca: .9,   pref: P(.15, .85, .8, .05, .02), act: { b: .45, dd: .35, dia: .35, noite: 0 }, ab: 4, salto: 0,  kgTl: 6,   nib: [1, 3], jan: .85, estrutura: .5 },
  'pacu':             { d: [1, 5],    forca: .95,  pref: P(.25, .95, .7, .05, .05), act: { b: .45, dd: .3, dia: .4, noite: -.1 }, ab: 6, salto: .05, kgTl: 3,  nib: [1, 3], jan: .8,  estrutura: .4 },
  'pirapitinga':      { d: [1, 5],    forca: .95,  pref: P(.2, .9, .7, .05, .05), act: { b: .45, dd: .3, dia: .4, noite: -.1 }, ab: 4, salto: .05, kgTl: 4.5, nib: [1, 3], jan: .8,  estrutura: .4 },
  'piranha-vermelha': { d: [.5, 4],   forca: 1.0,  pref: P(.6, 0, .2, .75, .1), act: { b: .4, dd: .3, dia: .5, noite: -.2 },   ab: 8,   salto: .05, kgTl: .4,  nib: [2, 4], jan: .5,  estrutura: .3, rouba: .35 },
  'pintado':          { d: [2.5, 9],  forca: .85,  pref: P(.45, 0, .1, .95, .1), act: { b: .15, dd: .5, dia: -.25, noite: .9 }, ab: 2,  salto: 0,   kgTl: 8,   nib: [0, 2], jan: 1.1, estrutura: .9, fundo: true },
  'cachara':          { d: [2, 9],    forca: .85,  pref: P(.4, 0, .1, .95, .1), act: { b: .15, dd: .5, dia: -.25, noite: .85 }, ab: 2,  salto: 0,   kgTl: 6,   nib: [0, 2], jan: 1.1, estrutura: .9, fundo: true },
  'jau':              { d: [4, 9],    forca: .95,  pref: P(.2, 0, 0, .9, 0),    act: { b: .15, dd: .4, dia: -.2, noite: .7 },  ab: 1,   salto: 0,   kgTl: 18,  nib: [0, 1], jan: 1.2, estrutura: 1, fundo: true },
  'piraiba':          { d: [5, 9],    forca: .9,   pref: P(.1, 0, 0, .9, 0),    act: { b: .2, dd: .4, dia: -.1, noite: .6 },   ab: .5,  salto: 0,   kgTl: 45,  nib: [0, 1], jan: 1.2, estrutura: .7, fundo: true },
  'pirarara':         { d: [3, 9],    forca: .95,  pref: P(.3, .3, .4, .8, 0),  act: { b: .25, dd: .4, dia: 0, noite: .5 },    ab: 1.5, salto: 0,   kgTl: 14,  nib: [0, 2], jan: 1.1, estrutura: .8, fundo: true },
  'jundia':           { d: [1, 9],    forca: .8,   pref: P(.95, .1, .4, .5, 0), act: { b: .3, dd: .4, dia: -.1, noite: .6 },   ab: 8,   salto: 0,   kgTl: .45, nib: [1, 3], jan: .8,  estrutura: .5, fundo: true },
  'mandi':            { d: [1, 9],    forca: .8,   pref: P(.95, .2, .6, .3, 0), act: { b: .35, dd: .4, dia: -.1, noite: .6 },  ab: 10,  salto: 0,   kgTl: .18, nib: [2, 5], jan: .6,  estrutura: .3, fundo: true },
  'barbado':          { d: [2, 9],    forca: .85,  pref: P(.6, 0, .1, .8, 0),   act: { b: .25, dd: .4, dia: -.2, noite: .7 },  ab: 3,   salto: 0,   kgTl: 2.2, nib: [0, 2], jan: .9,  estrutura: .5, fundo: true },
  'cascudo':          { d: [.5, 6],   forca: .6,   pref: P(.2, .3, .4, 0, 0),   act: { b: .35, dd: .2, dia: 0, noite: .3 },    ab: 4,   salto: 0,   kgTl: .4,  nib: [3, 6], jan: .9,  estrutura: .6, fundo: true },
  'pirarucu':         { d: [.5, 5],   forca: 1.1,  pref: P(.05, 0, 0, .8, .6),  act: { b: .3, dd: .3, dia: .4, noite: -.1 },   ab: .6,  salto: .3,  kgTl: 60,  nib: [0, 0], jan: .7,  estrutura: .4 },
  'aruana':           { d: [0, 1.2],  forca: 1.0,  pref: P(.4, 0, 0, .6, .85),  act: { b: .3, dd: .3, dia: .5, noite: -.3 },   ab: 3,   salto: .6,  kgTl: 2,   nib: [0, 0], jan: .5,  estrutura: .4 },
  'corvina':          { d: [1, 6],    forca: 1.0,  pref: P(.6, 0, .1, .9, .7),  act: { b: .3, dd: .5, dia: .1, noite: .4 },   ab: 5,   salto: .1,  kgTl: 1.1, nib: [0, 2], jan: .6,  estrutura: .3 },
};

export const ISCAS = [
  { id: 'minhoca', nome: 'Minhoca', ic: '🪱' },
  { id: 'milho', nome: 'Milho', ic: '🌽' },
  { id: 'massa', nome: 'Massa', ic: '🍞' },
  { id: 'vivo', nome: 'Isca viva', ic: '🐟' },
  { id: 'artificial', nome: 'Artificial', ic: '🪝' },
];
export const LINHAS = [
  { id: 0, nome: 'Mono 0,25 mm', kg: 5, vis: 1 },
  { id: 1, nome: 'Mono 0,35 mm', kg: 9, vis: .86 },
  { id: 2, nome: 'Mono 0,50 mm', kg: 16, vis: .66 },
  { id: 3, nome: 'Multi 50 lb', kg: 23, vis: .55 },
];
export const PROFUNDIDADES = [.5, 1, 1.5, 2, 3, 4, 5, 6, 'fundo'];
