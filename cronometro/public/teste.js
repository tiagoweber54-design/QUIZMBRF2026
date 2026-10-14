/* Connection check: runs the same operations the app does, in a throwaway room. */
(function () {
  'use strict';

  var Core = window.TimerCore;
  var Cloud = window.Cloud;
  var cfg = window.CRONOMETRO_FIREBASE || {};
  var input = document.getElementById('db');
  var button = document.getElementById('go');
  var list = document.getElementById('steps');
  var summary = document.getElementById('summary');

  function saved(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }

  var fromQuery = /[?&]db=([^&]+)/.exec(location.search);
  input.value = (fromQuery && decodeURIComponent(fromQuery[1])) || cfg.databaseURL || (saved('cronometro-sync.db') ? 'https://' + saved('cronometro-sync.db') : '');

  function step(title) {
    var li = document.createElement('li');
    li.className = 'run';
    li.innerHTML = '<span class="icon">…</span><div><div class="what"></div><div class="detail"></div></div>';
    li.querySelector('.what').textContent = title;
    list.appendChild(li);
    return {
      ok: function (detail) { li.className = 'ok'; li.querySelector('.icon').textContent = '✓'; li.querySelector('.detail').textContent = detail || ''; },
      fail: function (detail) { li.className = 'fail'; li.querySelector('.icon').textContent = '✕'; li.querySelector('.detail').textContent = detail || ''; }
    };
  }

  function finish(good, text) {
    summary.hidden = false;
    summary.className = good ? 'good' : 'bad';
    summary.textContent = text;
    button.disabled = false;
  }

  function waitFor(test, ms) {
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      (function poll() {
        if (test()) return resolve();
        if (Date.now() - started > ms) return reject(new Error('timeout'));
        setTimeout(poll, 50);
      }());
    });
  }

  function run() {
    list.textContent = '';
    summary.hidden = true;
    button.disabled = true;
    var a = null;
    var b = null;
    var room = Cloud.newRoom();

    var s1 = step('Endereço do banco de dados');
    var parsed = Cloud.parseDbUrl(input.value);
    if (!parsed) {
      s1.fail('Não parece um endereço do Realtime Database. Ele termina em firebaseio.com ou firebasedatabase.app (não é o endereço do console).');
      return finish(false, 'Corrija o endereço e teste de novo.');
    }
    s1.ok(parsed.host);

    var s2 = step('Arquivos do Firebase neste aparelho');
    return Cloud.loadSdk().then(function () {
      s2.ok('Carregados.');
    }, function () {
      s2.fail('Não carregaram. Confira se a pasta "vendor" foi enviada junto com o site e se há internet.');
      throw new Error('stop');
    }).then(function () {
      var s3 = step('Conexão com o Firebase');
      var status = { a: '', b: '' };
      var problem = null;
      var state = { b: null, bAt: 0 };
      var offset = 0;
      function make(which) {
        return Cloud.connect({
          firebase: window.firebase, db: parsed.host, emulator: cfg.emulator, room: room,
          client: function () { return { id: 'teste' + which + Math.floor(Math.random() * 1e9), name: 'Teste ' + which }; },
          now: function () { return Date.now() + offset; },
          handlers: {
            onStatus: function (s) { status[which] = s; },
            onOffset: function (ms) { if (which === 'a') offset = ms; },
            onState: function (st) { if (which === 'b') { state.b = st; state.bAt = Date.now(); } },
            onError: function (e) { problem = e; }
          }
        });
      }
      a = make('a');
      b = make('b');
      return waitFor(function () { return (status.a === 'online' && status.b === 'online') || problem; }, 20000).then(function () {
        if (problem && problem.code === 'rules') {
          s3.fail('Conectou, mas as regras de segurança recusaram. Abra a aba Regras do Realtime Database, cole as regras do LEIA-ME e clique em Publicar.');
          throw new Error('stop');
        }
        if (problem) { s3.fail('Erro: ' + (problem.error && problem.error.message || problem.code)); throw new Error('stop'); }
        s3.ok('Conectado.');
      }, function () {
        s3.fail('Não conectou em 20 segundos. Confira a internet. Em redes de empresa, pode ser que *.firebaseio.com / *.firebasedatabase.app esteja bloqueado: peça ao TI para liberar, ou teste em outra rede (ex.: o 4G do celular).');
        throw new Error('stop');
      }).then(function () {
        var s4 = step('Sincronização em tempo real (duas conexões, regras de segurança)');
        var t0 = Date.now();
        return a.send({ type: 'start', target: 'timer' }).then(function () {
          return waitFor(function () { return state.b && state.b.timer.startedAt != null; }, 8000);
        }).then(function () {
          s4.ok('Uma conexão enviou, a outra recebeu em ' + (state.bAt - t0) + ' ms.');
        }, function () {
          s4.fail(problem && problem.code === 'rules'
            ? 'As regras de segurança recusaram a gravação. Cole as regras do LEIA-ME na aba Regras e clique em Publicar.'
            : 'A segunda conexão não recebeu a mudança em 8 segundos. A rede pode estar bloqueando a conexão em tempo real.');
          throw new Error('stop');
        });
      }).then(function () {
        var s5 = step('Relógio deste aparelho');
        var diff = Math.abs(offset) / 1000;
        s5.ok(diff < 2 ? 'Em dia com o servidor (diferença de ' + diff.toFixed(1) + ' s).'
          : 'Diferente do servidor em ' + diff.toFixed(0) + ' s. Sem problema: o programa corrige sozinho.');
        finish(true, 'Tudo certo! Este aparelho e esta rede podem usar o Cronômetro Sync pela internet.');
      });
    }).catch(function (err) {
      if (err && err.message !== 'stop') {
        step('Erro inesperado').fail(String(err.message || err));
      }
      finish(false, 'Algo falhou: veja o item marcado com ✕ acima.');
    }).then(function () {
      // Leave nothing behind: remove the throwaway room and close both connections.
      var cleanup = a && a.db ? a.db.ref('salas/' + room).remove().catch(function () {}) : Promise.resolve();
      return cleanup.then(function () { return Promise.all([a && a.leave(), b && b.leave()]); }).catch(function () {});
    });
  }

  button.addEventListener('click', run);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
}());
