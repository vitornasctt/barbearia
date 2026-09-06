// test/http/agenda-lock.test.js
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

test('lock cria, segunda sessão recebe 409 SLOT_TRAVADO, liberar solta', async () => {
  const s = await corte();
  const a = request.agent(buildApp());
  const r1 = await a.post('/api/agenda/lock').set('Origin', ORIGIN).send({ data: '2026-09-10', horario: '09:00', servico_id: s });
  assert.equal(r1.status, 200);
  assert.ok(r1.body.expira_em);

  const b = request.agent(buildApp());
  const r2 = await b.post('/api/agenda/lock').set('Origin', ORIGIN).send({ data: '2026-09-10', horario: '09:00', servico_id: s });
  assert.equal(r2.status, 409);
  assert.equal(r2.body.erro, 'SLOT_TRAVADO');

  const r3 = await a.post('/api/agenda/lock/liberar').set('Origin', ORIGIN).send({ data: '2026-09-10', horario: '09:00', servico_id: s });
  assert.equal(r3.status, 200);
  const r4 = await b.post('/api/agenda/lock').set('Origin', ORIGIN).send({ data: '2026-09-10', horario: '09:00', servico_id: s });
  assert.equal(r4.status, 200);
});

test('renovar sem lock => 409 LOCK_EXPIRADO', async () => {
  const s = await corte();
  const res = await request(buildApp()).post('/api/agenda/lock/renovar').set('Origin', ORIGIN)
    .send({ data: '2026-09-10', horario: '10:10', servico_id: s });
  assert.equal(res.status, 409);
  assert.equal(res.body.erro, 'LOCK_EXPIRADO');
});
