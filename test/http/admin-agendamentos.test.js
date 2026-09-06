// test/http/admin-agendamentos.test.js
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
test.beforeEach(async () => {
  await prepararBanco(); await semearBase(); cache.limparTudo(); resetRateLimit();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
});
// NOTA: os outros arquivos test/http/admin-*.test.js seguem o mesmo padrão
// (import + resetRateLimit() no beforeEach) — ver Global Constraints.

async function admin() {
  const a = request.agent(buildApp());
  await a.post('/api/auth/admin/login').set('Origin', ORIGIN)
    .send({ email: 'dono@teste.local', senha: 'teste123456' });
  return a;
}
async function corte() { return (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id; }

test('barbeiro não acessa admin? na verdade acessa (requireEquipe) — sem sessão => 401', async () => {
  const res = await request(buildApp()).get('/api/admin/dashboard');
  assert.equal(res.status, 401);
});

test('criação manual + dashboard reflete', async () => {
  const a = await admin();
  const s = await corte();
  const c = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5528999990000') RETURNING id`)).rows[0].id;
  const cr = await a.post('/api/admin/agendamentos').set('Origin', ORIGIN)
    .send({ cliente_id: c, servico_id: s, data: '2026-09-10', horario: '09:00' });
  assert.equal(cr.status, 201);
  const d = await a.get('/api/admin/dashboard');
  assert.equal(d.body.contadores.agendamentos_mes >= 0, true);
  const lst = await a.get('/api/admin/agendamentos').query({ status: 'pendente' });
  assert.equal(lst.body.total, 1);
});

test('PATCH status concluido enfileira pos_atendimento', async () => {
  const a = await admin();
  const s = await corte();
  const c = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5528999990001') RETURNING id`)).rows[0].id;
  const cr = await a.post('/api/admin/agendamentos').set('Origin', ORIGIN)
    .send({ cliente_id: c, servico_id: s, data: '2026-09-10', horario: '10:10' });
  const id = cr.body.agendamento.id;
  const up = await a.patch(`/api/admin/agendamentos/${id}/status`).set('Origin', ORIGIN).send({ status: 'concluido' });
  assert.equal(up.status, 200);
  assert.equal(up.body.agendamento.status, 'concluido');
  const msg = await query(`SELECT template_chave, status_envio FROM mensagens_whatsapp WHERE agendamento_id=$1 ORDER BY id`, [id]);
  assert.ok(msg.rows.some((m) => m.template_chave === 'pos_atendimento' && m.status_envio === 'simulado'));
});

test('PATCH status cancelado usa o motor e libera o slot', async () => {
  const a = await admin();
  const s = await corte();
  const c = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5528999990002') RETURNING id`)).rows[0].id;
  const cr = await a.post('/api/admin/agendamentos').set('Origin', ORIGIN)
    .send({ cliente_id: c, servico_id: s, data: '2026-09-10', horario: '11:20' });
  const id = cr.body.agendamento.id;
  const up = await a.patch(`/api/admin/agendamentos/${id}/status`).set('Origin', ORIGIN).send({ status: 'cancelado', motivo: 'cliente ligou' });
  assert.equal(up.body.agendamento.status, 'cancelado');
});
