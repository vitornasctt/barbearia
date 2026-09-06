// test/http/admin-agenda-config.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); resetRateLimit(); });

async function admin() {
  const a = request.agent(buildApp());
  await a.post('/api/auth/admin/login').set('Origin', ORIGIN).send({ email: 'dono@teste.local', senha: 'teste123456' });
  return a;
}
async function corte() { return (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id; }

test('abrir mês reflete em GET /api/agenda/dias', async () => {
  const a = await admin();
  const s = await corte();
  let dias = await request(buildApp()).get('/api/agenda/dias').query({ ano: 2026, mes: 9, servico_id: s });
  assert.equal(dias.body.fechado, 'MES_FECHADO');

  const ab = await a.post('/api/admin/disponibilidade').set('Origin', ORIGIN)
    .send({ ano: 2026, mes: 9, status: 'aberto', limite_por_dia: 8 });
  assert.equal(ab.status, 200);

  dias = await request(buildApp()).get('/api/agenda/dias').query({ ano: 2026, mes: 9, servico_id: s });
  assert.equal(dias.body.fechado, null);
  assert.ok(dias.body.dias.length > 0);

  const meses = await a.get('/api/admin/disponibilidade').query({ ano: 2026 });
  assert.equal(meses.body.meses.find((m) => m.mes === 9).limite_por_dia, 8);
});

test('bloqueio de dia inteiro tira o dia da grade', async () => {
  const a = await admin();
  const s = await corte();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const b = await a.post('/api/admin/bloqueios').set('Origin', ORIGIN)
    .send({ data: '2026-09-10', dia_inteiro: true, motivo: 'feriado' });
  assert.equal(b.status, 201);

  const h = await request(buildApp()).get('/api/agenda/horarios').query({ data: '2026-09-10', servico_id: s });
  assert.deepEqual(h.body.horarios, []);

  const lst = await a.get('/api/admin/bloqueios').query({ de: '2026-09-01', ate: '2026-09-30' });
  assert.equal(lst.body.bloqueios.length, 1);
  const del = await a.delete(`/api/admin/bloqueios/${b.body.bloqueio.id}`).set('Origin', ORIGIN);
  assert.equal(del.status, 204);
});
