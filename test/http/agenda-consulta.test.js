// test/http/agenda-consulta.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); });

async function servicoCorte() {
  return (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
}

test('GET /api/agenda/servicos lista os 3 ativos', async () => {
  const res = await request(buildApp()).get('/api/agenda/servicos');
  assert.equal(res.status, 200);
  assert.equal(res.body.servicos.length, 3);
});

test('GET /horarios com mês fechado => fechado MES_FECHADO', async () => {
  const res = await request(buildApp())
    .get('/api/agenda/horarios').query({ data: '2026-09-10', servico_id: await servicoCorte() });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { horarios: [], fechado: 'MES_FECHADO' });
});

test('GET /horarios com mês aberto lista a grade', async () => {
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const res = await request(buildApp())
    .get('/api/agenda/horarios').query({ data: '2026-09-10', servico_id: await servicoCorte() });
  assert.equal(res.status, 200);
  assert.equal(res.body.fechado, null);
  assert.equal(res.body.horarios[0], '09:00');
});

test('GET /dias devolve os dias com vaga no mês aberto', async () => {
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const res = await request(buildApp())
    .get('/api/agenda/dias').query({ ano: 2026, mes: 9, servico_id: await servicoCorte() });
  assert.equal(res.status, 200);
  assert.ok(res.body.dias.includes('2026-09-10'));   // quinta
  assert.ok(!res.body.dias.includes('2026-09-13'));  // domingo (expediente fechado)
});
