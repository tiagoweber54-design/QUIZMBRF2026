# ⏱️ Cronômetro Sync

Cronômetro e temporizador para apresentações que você controla de **vários aparelhos ao mesmo tempo**: deixe o tempo aberto no iPad e inicie, pause, zere ou some tempo pelo iPhone, pelo PC ou pelo próprio iPad. Toda mudança aparece na hora em todas as telas.

<p align="center">
  <img src="docs/ipad.png" alt="O cronômetro na tela do iPad" width="560">
  &nbsp;
  <img src="docs/iphone.png" alt="O mesmo cronômetro sendo controlado pelo iPhone" width="190">
</p>

- Funciona na rede Wi-Fi local, **sem internet**.
- No iPad e no iPhone não é preciso instalar nada: abre no Safari (ou Chrome).
- Todas as telas mostram exatamente o mesmo segundo, mesmo que os relógios dos aparelhos estejam diferentes.
- Se o programa do computador for fechado e aberto de novo, o tempo continua de onde estava.

## Como funciona

O computador (Windows ou Mac) roda um programinha que guarda o tempo. O iPad, o iPhone e o próprio PC abrem o endereço dele no navegador e ficam sincronizados:

```
                    mesma rede Wi-Fi
   ┌────────────────────┼─────────────────────┐
   PC (roda o programa)  iPad (tela do tempo)   iPhone (controle)
```

## Primeira vez (uns 5 minutos)

1. **Instale o Node.js** no computador: entre em <https://nodejs.org>, baixe a versão **LTS** e instale (Avançar, Avançar…).
2. **Baixe esta pasta**: na página do repositório no GitHub, botão verde **Code → Download ZIP**. **Descompacte** o arquivo.
3. Abra a pasta `cronometro`.

## Toda vez que for usar

1. No computador, dê dois cliques em:
   - **Windows:** `INICIAR-WINDOWS.bat`
   - **Mac:** `INICIAR-MAC.command`

   Na primeira vez, o computador pode pedir permissões:
   - **Windows:** no aviso do Firewall, marque **Redes privadas** e clique em **Permitir acesso**.
   - **Mac:** se disser que o arquivo é de um desenvolvedor não identificado, vá em **Ajustes do Sistema → Privacidade e Segurança → Abrir Mesmo Assim**. Se perguntar se o “node” pode aceitar conexões, clique em **Permitir**.
2. Abre uma janela com o endereço (por exemplo `http://192.168.0.15:3000`) e um **QR code**. O cronômetro também abre no navegador do PC.
3. No **iPad** e no **iPhone**, conectados ao **mesmo Wi-Fi** do computador: abra a **Câmera**, aponte para o QR code e toque no link — ou digite o endereço no Safari.
   No app, o botão de **QR code** no topo mostra o código e o endereço de novo.
4. Pronto: qualquer aparelho controla. O topo de cada tela mostra quantos aparelhos estão conectados.

Deixe a janela do programa aberta enquanto estiver usando. Para encerrar, feche a janela.

## Dicas para o iPad

| Quero… | Como |
|---|---|
| Tela cheia, como um app | No Safari: botão **Compartilhar → Adicionar à Tela de Início**. Depois abra pelo ícone. |
| Que a tela não apague | **Ajustes → Tela e Brilho → Bloqueio Automático → Nunca** |
| Só o tempo, sem botões | Botão de **monitor** no topo (ou tecla **E**). Para voltar, toque no **×** no canto. |
| Ouvir o alarme | Toque uma vez em qualquer lugar da tela — o iPad só libera o som depois de um toque. |

## O que dá para fazer

**Temporizador** (contagem regressiva)
- Tempos rápidos de 1 a 60 minutos ou qualquer tempo (horas, minutos e segundos).
- **−1 min, −10 s, +10 s, +1 min** a qualquer momento, inclusive com o tempo correndo.
- Fica **amarelo** e depois **vermelho** quando está acabando (você escolhe quando, em Ajustes).
- No zero: tela vermelha piscando e alarme. Continua contando o tempo excedido (−00:35) — ou para no zero, se preferir.
- Mostra a hora em que vai terminar (“Termina às 14:45”).

**Cronômetro**: iniciar, pausar e marcar voltas, com a volta mais rápida em verde e a mais lenta em vermelho.

**Mensagem na tela**: mande um aviso para quem está apresentando (“Faltam 5 minutos”, “Conclua, por favor”…), que pode piscar para chamar atenção.

**Título**: nome da apresentação ou de quem está falando, acima do tempo.

Cada aparelho liga ou desliga o próprio som, sem mexer nos outros. Quando alguém muda algo, os outros aparelhos mostram um aviso como “Temporizador pausado por iPhone”.

### Atalhos de teclado (PC)

| Tecla | Ação |
|---|---|
| Espaço | Iniciar / pausar |
| R | Zerar |
| V | Marcar volta |
| T / C | Temporizador / cronômetro |
| ↑ ↓ | +1 / −1 minuto |
| → ← | +10 / −10 segundos |
| E | Modo exibição (só o tempo) |
| F | Tela cheia |
| M | Liga / desliga o som |

## Problemas comuns

**O iPhone ou o iPad não abre o endereço**
- Confira se estão no **mesmo Wi-Fi** do computador (e não no 4G/5G).
- Se o navegador pedir permissão para **acessar a rede local**, toque em **Permitir**. No iPhone/iPad com Chrome: *Ajustes → Chrome → ative Rede Local*.
- **Windows:** se você clicou em Cancelar no aviso do Firewall, abra *Painel de Controle → Sistema e Segurança → Firewall do Windows Defender → Permitir um aplicativo* e marque **Node.js** em **Privada** (e em **Pública**, se a sua rede estiver como pública).
- Tente os outros endereços que a janela do programa mostra.
- Redes de empresas, hotéis e eventos às vezes bloqueiam a comunicação entre aparelhos. Solução: ligue o **Acesso Pessoal** (hotspot) do iPhone e conecte nele o computador e o iPad.

**Aparece “Reconectando…” no topo**: o aparelho perdeu contato com o computador (o Wi-Fi caiu, a janela do programa foi fechada ou o computador entrou em repouso). Ele volta sozinho quando a conexão voltar, com o tempo certo.

**A porta 3000 já está em uso**: o programa escolhe outra sozinho (3001, 3002…) e mostra o endereço certo.

**O arquivo de clique duplo não funciona**: abra o Terminal (Mac) ou o Prompt de Comando (Windows) dentro da pasta `cronometro` e digite:

```
node server.js --abrir
```

Opções: `--porta=8080` escolhe a porta; `--sem-qr` não desenha o QR code na janela.

## Segurança

- Tudo fica no seu computador e na sua rede: nada vai para a internet.
- Qualquer pessoa conectada à **mesma rede** que souber o endereço consegue abrir o cronômetro. Em redes públicas, prefira o hotspot do celular.

## Sem computador?

Abrir `public/index.html` direto no navegador funciona como cronômetro de **um aparelho só**, sem sincronizar (o topo mostra “Sem servidor”).

## Para desenvolvedores

- `server.js` — servidor HTTP sem dependências (só Node.js 16+). Guarda o estado em `estado.json`, envia as mudanças por Server-Sent Events (`GET /api/events`) e recebe comandos por `POST /api/command`.
- `public/core.js` — a lógica do temporizador e do cronômetro, a mesma no servidor e no navegador.
- `public/app.js` — a interface. Cada aparelho acerta o relógio com o do servidor, então todas as telas viram o segundo juntas.
- `public/vendor/qrcode.js` — gerador de QR code [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (licença MIT).
- Testes: `npm test` (Node 18+).
