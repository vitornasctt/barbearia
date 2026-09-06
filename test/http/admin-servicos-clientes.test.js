// test/http/admin-servicos-clientes.test.js
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
async function barbeiro() {
  const h = await query(`INSERT INTO usuarios (nome, email, senha_hash, role) VALUES ('B','b@x.com','$2b$12$aaaaaaaaaaaaaaaaaaaaaa','barbeiro') RETURNING id`);
  // login como barbeiro: reusa o fluxo — precisamos de senha real; então setamos via seed helper:
  const { hashSenha } = await import('../../src/auth/senha.js');
  await query(`UPDATE usuarios SET senha_hash=$1 WHERE id=$2`, [await hashSenha('barbeiro123'), h.rows[0].id]);
  const a = request.agent(buildApp());
  await a.post('/api/auth/admin/login').set('Origin', ORIGIN).send({ email: 'b@x.com', senha: 'barbeiro123' });
  return a;
}

test('CRUD de serviços; DELETE de serviço novo é hard', async () => {
  const a = await admin();
  const cr = await a.post('/api/admin/servicos').set('Origin', ORIGIN)
    .send({ nome: 'Pezinho', duracao_minutos: 15, preco: 12, comissao_percentual: 30 });
  assert.equal(cr.status, 201);
  const id = cr.body.servico.id;
  const up = await a.patch(`/api/admin/servicos/${id}`).set('Origin', ORIGIN).send({ preco: 14 });
  assert.equal(Number(up.body.servico.preco), 14);
  const del = await a.delete(`/api/admin/servicos/${id}`).set('Origin', ORIGIN);
  assert.deepEqual(del.body, { modo: 'hard' });
});

test('busca de clientes e ficha', async () => {
  const a = await admin();
  await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana Paula','5528999990000'), ('Bruno','5528911112222')`);
  const busca = await a.get('/api/admin/clientes').query({ busca: 'ana' });
  assert.equal(busca.body.total, 1);
  const id = busca.body.itens[0].id;
  const ficha = await a.get(`/api/admin/clientes/${id}`);
  assert.equal(ficha.body.cliente.nome, 'Ana Paula');
  assert.ok(Array.isArray(ficha.body.agendamentos.itens));
});

test('anonimizar exige admin (barbeiro => 403)', async () => {
  const cliId = (await query(`INSERT INTO clientes (nome, celular) VALUES ('X','5528900000000') RETURNING id`)).rows[0].id;
  const b = await barbeiro();
  const neg = await b.post(`/api/admin/clientes/${cliId}/anonimizar`).set('Origin', ORIGIN);
  assert.equal(neg.status, 403);

  const a = await admin();
  const ok = await a.post(`/api/admin/clientes/${cliId}/anonimizar`).set('Origin', ORIGIN);
  assert.equal(ok.status, 200);
  const row = await query(`SELECT nome, celular FROM clientes WHERE id=$1`, [cliId]);
  assert.equal(row.rows[0].nome, 'removido');
  assert.match(row.rows[0].celular, /^ANON-/);
});
