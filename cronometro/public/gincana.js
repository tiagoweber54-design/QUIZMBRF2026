/*
 * Reunião de Líderes — Gincana de 19/11/2026 (13:30 às 15:30).
 * Edite aqui nomes, tempos, pontos e equipes.
 *
 * Cada plano (Sol ou Chuva) tem:
 *   equipes     as 4 equipes (os códigos laranja, verde, amarelo e azul não mudam)
 *   categorias  os locais (cor da bordinha no tablet)
 *   itens       as 9 brincadeiras, na ordem oficial:
 *     id      código interno (letras minúsculas, números e hífen; não repita)
 *     hora    horário previsto, só para mostrar
 *     cat     local
 *     nome    nome da brincadeira
 *     lider   regra de pontos (aparece abaixo do nome)
 *     min     tempo da brincadeira, em minutos
 *     pts     pontos que a brincadeira vale (0 = sem limite fixo)
 *     passo   quanto cada toque em + / − soma ou tira
 *
 * Os horários são previstos: 13:30 começa o Desfile e há uns 15 min de deslocamento
 * entre os locais. Quem manda no tempo é o cronômetro.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GINCANA = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var equipes = [
    { id: 'laranja', nome: 'Laranja', lider: 'Daniele H.', cor: '#f59e0b', tinta: '#1b1300' },
    { id: 'verde', nome: 'Verde', lider: 'Diogo P.', cor: '#7ac70c', tinta: '#112200' },
    { id: 'amarelo', nome: 'Amarelo', lider: 'Adriano S.', cor: '#fde047', tinta: '#2a2300' },
    { id: 'azul', nome: 'Azul', lider: 'Taciane S.', cor: '#93c5fd', tinta: '#0b1f3a' }
  ];

  return {
    evento: 'Reunião de Líderes 19/11/2026',
    eventos: [
      {
        id: 'sol',
        nome: 'Gincana · Plano Sol',
        curto: '☀️ Plano Sol',
        gincana: true,
        penalidade: false, // só marca o tempo; não perde ponto por estourar
        equipes: equipes,
        categorias: [
          { id: 'salao', nome: 'Salão', cor: '#6a4c93' },
          { id: 'vermelhinho', nome: 'Vermelhinho', cor: '#c0392b' },
          { id: 'campo', nome: 'Campo', cor: '#0e7c86' }
        ],
        itens: [
          { id: 'g01', hora: '13:30', cat: 'salao', nome: 'Desfile', lider: '20 pts (10 cabelo + 10 roupa)', min: 10, pts: 20, passo: 10 },
          { id: 'g02', hora: '13:40', cat: 'salao', nome: 'Grito de Guerra', lider: '10 pts fixos por apresentação', min: 5, pts: 10, passo: 10 },
          { id: 'g03', hora: '13:45', cat: 'salao', nome: 'Dança das Cadeiras', lider: '30 pts (tira 2 cadeiras por vez até a metade)', min: 12, pts: 30, passo: 30 },
          { id: 'g04', hora: '14:04', cat: 'vermelhinho', nome: 'Mistura de Calçados', lider: '40 pts (1ª equipe calçada e amarrada)', min: 12, pts: 40, passo: 40 },
          { id: 'g05', hora: '14:16', cat: 'vermelhinho', nome: 'Balão no Pé', lider: '30 pts (último balão intacto no pé)', min: 12, pts: 30, passo: 30 },
          { id: 'g06', hora: '14:28', cat: 'vermelhinho', nome: 'Dança da Laranja', lider: '30 pts (4 duplas por equipe; última dupla)', min: 12, pts: 30, passo: 30 },
          { id: 'g07', hora: '14:40', cat: 'vermelhinho', nome: 'Pênalti Trave Móvel', lider: '10 pts por gol (5 chutes; máx. 50 pts)', min: 15, pts: 50, passo: 10 },
          { id: 'g08', hora: '15:03', cat: 'campo', nome: 'Prego no Toco', lider: '50 pts (1ª equipe a cravar inteiro)', min: 12, pts: 50, passo: 50 },
          { id: 'g09', hora: '15:15', cat: 'campo', nome: 'Balão com Água', lider: '60 pts (duplas; passo para trás)', min: 15, pts: 60, passo: 60 }
        ]
      },
      {
        id: 'chuva',
        nome: 'Gincana · Plano Chuva',
        curto: '🌧️ Plano Chuva',
        gincana: true,
        penalidade: false,
        equipes: equipes,
        categorias: [
          { id: 'salao', nome: 'Salão', cor: '#6a4c93' },
          { id: 'vermelhinho', nome: 'Vermelhinho', cor: '#c0392b' }
        ],
        itens: [
          { id: 'c01', hora: '13:30', cat: 'salao', nome: 'Desfile', lider: '20 pts (10 cabelo + 10 roupa)', min: 10, pts: 20, passo: 10 },
          { id: 'c02', hora: '13:40', cat: 'salao', nome: 'Grito de Guerra', lider: '10 pts fixos por apresentação', min: 5, pts: 10, passo: 10 },
          { id: 'c03', hora: '13:45', cat: 'salao', nome: 'Dança das Cadeiras', lider: '30 pts (tira 2 cadeiras por vez até a metade)', min: 12, pts: 30, passo: 30 },
          { id: 'c04', hora: '14:12', cat: 'vermelhinho', nome: 'Mistura de Calçados', lider: '40 pts (1ª equipe calçada e amarrada)', min: 12, pts: 40, passo: 40 },
          { id: 'c05', hora: '14:24', cat: 'vermelhinho', nome: 'Balão no Pé', lider: '30 pts (último balão intacto no pé)', min: 12, pts: 30, passo: 30 },
          { id: 'c06', hora: '14:36', cat: 'vermelhinho', nome: 'Dança da Laranja', lider: '30 pts (4 duplas por equipe; última dupla)', min: 12, pts: 30, passo: 30 },
          { id: 'c07', hora: '14:48', cat: 'vermelhinho', nome: 'Pênalti Trave Móvel', lider: '10 pts por gol (5 chutes; máx. 50 pts)', min: 15, pts: 50, passo: 10 },
          { id: 'c08', hora: '15:03', cat: 'vermelhinho', nome: 'Jogo da Mímica', lider: '5 pts por acerto (sem falar)', min: 15, pts: 0, passo: 5 },
          { id: 'c09', hora: '15:18', cat: 'vermelhinho', nome: 'Prego no Toco', lider: '50 pts (1ª equipe a cravar inteiro)', min: 12, pts: 50, passo: 50 }
        ]
      }
    ]
  };
}));
