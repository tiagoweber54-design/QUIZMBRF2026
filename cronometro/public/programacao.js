/*
 * Programação do seminário — edite aqui para mudar nomes, tempos ou a ordem.
 *
 * Cada categoria tem:
 *   min    tempo padrão das apresentações dela, em minutos (Case 5S 8; CIQ PDCA e Kaizen 12)
 *   video  true = não é cronometrada (Paródia): aparece na lista, mas sem tempo nem pontos
 *
 * Cada apresentação tem:
 *   id     código interno (letras minúsculas, números e hífen; não repita)
 *   hora   horário previsto, só para mostrar
 *   cat    categoria (uma das de "categorias" acima)
 *   nome   setor ou nome da apresentação
 *   lider  líder ou nome do grupo
 *   min    (opcional) tempo só desta apresentação, em minutos; vale mais que o da categoria
 *
 * Mensagens automáticas na tela: na metade do tempo e quando falta 1 minuto.
 * Regra de pontos (no arquivo core.js): cada minuto COMPLETO acima do tempo
 * custa 1 ponto. Até 59 segundos acima não perde nada.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PROGRAMACAO = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {
    evento: 'Seminário de Gestão',
    categorias: [
      { id: 'case5s', nome: 'Case 5S', cor: '#2e9b4a', min: 8 },
      { id: 'ciq', nome: 'CIQ PDCA', cor: '#1d78d6', min: 12 },
      { id: 'kaizen', nome: 'Kaizen', cor: '#5b3fb5', min: 12 },
      { id: 'parodia', nome: 'Paródia', cor: '#e5502f', video: true } // é vídeo: sem cronômetro, fora dos tempos
    ],
    itens: [
      { id: 'p01', hora: '13:30', cat: 'case5s', nome: 'Carregamento', lider: 'Diogo Pereira' },
      { id: 'p02', hora: '13:38', cat: 'case5s', nome: 'PCP', lider: 'Juliano Pogere' },
      { id: 'p03', hora: '13:46', cat: 'case5s', nome: 'Mezanino 1T', lider: 'Rosangela Vieira' },
      { id: 'p04', hora: '13:54', cat: 'parodia', nome: 'Pernil 1T', lider: 'Ruan Schumacker' },
      { id: 'p05', hora: '13:57', cat: 'case5s', nome: 'Segurança RH', lider: 'Fernando da Silva' },
      { id: 'p06', hora: '14:05', cat: 'case5s', nome: 'Qualidade', lider: 'Daniela Habowiski' },
      { id: 'p07', hora: '14:13', cat: 'ciq', nome: 'Carregamento', lider: 'Maersk Hamburg' },
      { id: 'p08', hora: '14:16', cat: 'parodia', nome: 'Paleta 2T', lider: 'Alexandre Zapelini' },
      { id: 'p09', hora: '14:24', cat: 'ciq', nome: 'Higienização', lider: 'Tira Mancha' },
      { id: 'p10', hora: '14:36', cat: 'ciq', nome: 'PCP', lider: 'Esquadrão Classe A' },
      { id: 'p11', hora: '14:48', cat: 'ciq', nome: 'PCM', lider: 'PCM 4.0' },
      { id: 'p12', hora: '15:00', cat: 'parodia', nome: 'Carregamento', lider: 'Diogo Pereira' },
      { id: 'p13', hora: '15:03', cat: 'ciq', nome: 'Paleta 1T', lider: 'Visão e Ação' },
      { id: 'p14', hora: '15:15', cat: 'ciq', nome: 'SLC 2 1T', lider: 'Conquistadores Visionários' },
      { id: 'p15', hora: '15:27', cat: 'ciq', nome: 'Controladoria', lider: 'Galáticos' },
      { id: 'p16', hora: '15:59', cat: 'parodia', nome: 'Mezanino 1T', lider: 'Geferson Bet' },
      { id: 'p17', hora: '16:02', cat: 'kaizen', nome: 'Redução da família Pele', lider: 'Ruan Schumacker' },
      { id: 'p18', hora: '16:14', cat: 'kaizen', nome: 'Aumento Rendimento Família Carré', lider: 'Thayane, Alexandre e Adriano' },
      { id: 'p19', hora: '16:26', cat: 'kaizen', nome: 'Redução de reclamações na paletização', lider: 'Sueli Siqueira' },
      { id: 'p20', hora: '16:38', cat: 'parodia', nome: 'Paleta 1T', lider: 'Adriano Machado' },
      { id: 'p21', hora: '16:41', cat: 'kaizen', nome: 'Redução de perdas com linfadenite em carcaças suínas', lider: 'Tiago Weber e Filippe Meira' },
      { id: 'p22', hora: '16:53', cat: 'kaizen', nome: 'Redução de consumo de serra fita carne 3/4"', lider: 'Luan Valandro e Everton Mauri' },
      { id: 'p23', hora: '17:05', cat: 'kaizen', nome: 'Redução desvios para o DIF por carcaças com presença de pelos', lider: 'Laura Dambros e Daniel Freitas' },
      { id: 'p24', hora: '17:17', cat: 'parodia', nome: 'PCP', lider: 'Juliano Pogere' },
      { id: 'p25', hora: '17:20', cat: 'kaizen', nome: 'Aumento de eficiência Cooling', lider: 'Danimar Buffon' }
    ]
  };
}));
