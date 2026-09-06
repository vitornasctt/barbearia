// test/realtime/fluxo.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { io as Client } from 'socket.io-client';
import { criarServidor } from '../../src/server.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';
import { EVENTOS } from '../../src/realtime/emitir.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => {
  await prepararBanco(); await semearBase(); cache.limparTudo();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
});

test('confirmar por HTTP dispara agenda_atualizada no socket da data', async () => {
  const { server, io, parar } = criarServidor();
  await new Promise((r) => server.listen(0, r));
  const porta = server.address().port;

  const socket = Client(`http://localhost:${porta}`, { transports: ['websocket'] });
  await new Promise((r) => socket.on('connect', r));
  socket.emit('entrar_agenda', { data: '2026-09-10' });
  await new Promise((r) => setTimeout(r, 60));

  const recebido = new Promise((r) => socket.once(EVENTOS.AGENDA_ATUALIZADA, r));

  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  const agent = request.agent(server);
  await agent.post('/api/agenda/cadastro').set('Origin', ORIGIN).send({ nome: 'Ana', celular: '28999990000', consentimento: true });
  const conf = await agent.post('/api/agenda/confirmar').set('Origin', ORIGIN).send({ servico_id: s, data: '2026-09-10', horario: '09:00' });
  assert.equal(conf.status, 201);

  assert.deepEqual(await recebido, { data: '2026-09-10' });

  socket.close();
  await parar();
});
