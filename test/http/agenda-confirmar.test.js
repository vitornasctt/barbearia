// test/http/agenda-confirmar.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => {
  await prepararBanco(); await semearBase(); cache.limparTudo();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
});
async function corte() { return (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id; }

test('cadastro simples + confirmar cria agendamento e enfileira msg processada', async () => {
  const s = await corte();
  const a = request.agent(buildApp());
  const cad = await a.post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular: '(28) 99999-0000', consentimento: true });
  assert.equal(cad.status, 201);

  const conf = await a.post('/api/agenda/confirmar').set('Origin', ORIGIN)
    .send({ servico_id: s, data: '2026-09-10', horario: '15:25' });
  assert.equal(conf.status, 201);
  assert.equal(conf.body.agendamento.status, 'pendente');

  const msg = await query(`SELECT status_envio FROM mensagens_whatsapp WHERE agendamento_id=$1`, [conf.body.agendamento.id]);
  assert.equal(msg.rows[0].status_envio, 'simulado');
});

test('confirmar sem sessão de cliente => 401', async () => {
  const s = await corte();
  const res = await request(buildApp()).post('/api/agenda/confirmar').set('Origin', ORIGIN)
    .send({ servico_id: s, data: '2026-09-10', horario: '15:25' });
  assert.equal(res.status, 401);
});

test('segundo confirmar no mesmo slot => 409 HORARIO_INDISPONIVEL', async () => {
  const s = await corte();
  const a = request.agent(buildApp()); const b = request.agent(buildApp());
  for (const [ag, cel] of [[a, '(28) 90000-0001'], [b, '(28) 90000-0002']]) {
    await ag.post('/api/agenda/cadastro').set('Origin', ORIGIN).send({ nome: 'X', celular: cel, consentimento: true });
  }
  const r1 = await a.post('/api/agenda/confirmar').set('Origin', ORIGIN).send({ servico_id: s, data: '2026-09-10', horario: '16:00' });
  assert.equal(r1.status, 201);
  const r2 = await b.post('/api/agenda/confirmar').set('Origin', ORIGIN).send({ servico_id: s, data: '2026-09-10', horario: '16:00' });
  assert.equal(r2.status, 409);
  assert.equal(r2.body.erro, 'HORARIO_INDISPONIVEL');
});

test('cadastro com celular já usado com senha => 409 CELULAR_EM_USO', async () => {
  await query(`INSERT INTO clientes (nome, celular, email, senha_hash) VALUES ('J','5528911112222','j@x.com','$2b$12$abcdefghijklmnopqrstuv')`);
  const res = await request(buildApp()).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'J2', celular: '28911112222', consentimento: true });
  assert.equal(res.status, 409);
  assert.equal(res.body.erro, 'CELULAR_EM_USO');
});
