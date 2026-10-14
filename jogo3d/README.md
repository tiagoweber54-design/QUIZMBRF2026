# Pescaria 3D — modelos dos peixes

Primeira etapa do jogo de pescaria realista em 3D: **30 espécies brasileiras**
modeladas proceduralmente com [Three.js](https://threejs.org) (sem arquivos de modelo
externos, tudo gerado em código).

Abra `catalogo.html` por um servidor local (módulos ES não carregam via `file://`):

```bash
python3 -m http.server 8000
# http://localhost:8000/jogo3d/catalogo.html
```

## Arquivos

| Arquivo | O que faz |
|---|---|
| `peixes/gerador.js` | Gerador: corpo, nadadeiras, olhos, barbilhões, dentes, texturas e animação de natação |
| `peixes/especies.js` | Dados das 30 espécies: silhueta, cores, padrões, nadadeiras e ficha de pesca |
| `catalogo.html` | Visualizador: aquário com cáusticas, régua em tamanho real, modo "Todos" e modo "Malha" |

## Como cada peixe é construído

- **Corpo**: lofting de seções transversais ao longo do comprimento. A silhueta vem de
  pontos de controle (perfil dorsal, ventral e largura) interpolados com PCHIP; a seção é
  uma superelipse/lente (flancos achatados nos peixes comprimidos, ventre plano nos bagres).
- **Textura** pintada em canvas no espaço UV: degradê dorso→ventre, faixas, pintas,
  reticulado, ocelos, linha lateral, opérculo, boca e escamas/placas (com mapa de relevo).
- **Nadadeiras**: malhas de raios (raios + membrana translúcida com pregas), com formatos
  bifurcada, truncada, arredondada, lanceolada, falcada, espinhosa (ciclídeos), vela
  (cascudo) e adiposa carnosa.
- **Detalhes**: olhos com íris e pupila, barbilhões afilados (achatados no barbado),
  caninos da cachorra, dentes da piranha e da traíra, lábios do curimbatá, ventosa do cascudo.
- **Natação**: onda lateral no vertex shader (amplitude cresce até a cauda), com
  frequência e comprimento de onda por espécie.

```js
import { criarPeixe } from './peixes/gerador.js';
import { POR_ID } from './peixes/especies.js';
const peixe = criarPeixe(POR_ID['dourado'], { res: 1024 });
peixe.scale.setScalar(0.7);          // comprimento total em metros
scene.add(peixe);
// no laço de animação:
peixe.userData.nadar(tempoEmSegundos);
```

## Espécies

Ciclídeos: tucunaré-açu, tucunaré-amarelo, tucunaré-azul, apaiari ·
Characiformes: dourado, matrinxã, piraputanga, curimbatá, piau-três-pintas, lambari,
traíra, trairão, cachorra, bicuda ·
Serrasalmídeos: tambaqui, pacu, pirapitinga, piranha-vermelha ·
Bagres: pintado, cachara, jaú, piraíba, pirarara, jundiá, mandi-amarelo, barbado, cascudo ·
Outros: pirarucu, aruanã, corvina.
