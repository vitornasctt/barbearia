import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';
import { logarEquipe } from '../helpers/sessao.js';

before(prepararBanco);
beforeEach(async () => { await prepararBanco(); resetRateLimit(); });

test('GET /admin sem sessão redireciona para /admin/login?next', async () => {
  const res = await request(buildApp()).get('/admin');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/admin/login?next=%2Fadmin');
});

test('GET /admin/login sem sessão responde 200', async () => {
  const res = await request(buildApp()).get('/admin/login');
  assert.equal(res.status, 200);
  assert.match(res.text, /senha/i);
});

test('GET /admin com sessão de equipe responde 200 com a barra lateral', async () => {
  const agente = await logarEquipe();
  const res = await agente.get('/admin');
  assert.equal(res.status, 200);
  assert.match(res.text, /class="admin-sidebar"/);
  assert.match(res.text, /Dashboard/);
});

test('GET /admin/login já logado redireciona para /admin', async () => {
  const agente = await logarEquipe();
  const res = await agente.get('/admin/login');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/admin');
});

test('GET /admin/agendamentos: 302 sem sessão, 200 com sessão', async () => {
  const anon = await request(buildApp()).get('/admin/agendamentos');
  assert.equal(anon.status, 302);
  const agente = await logarEquipe();
  const res = await agente.get('/admin/agendamentos');
  assert.equal(res.status, 200);
  assert.match(res.text, /class="admin-sidebar"/);
  assert.match(res.text, /a href="\/admin\/agendamentos" class="ativa"/);
  assert.match(res.text, /src="\/js\/admin\/agendamentos\.js"/);
});
