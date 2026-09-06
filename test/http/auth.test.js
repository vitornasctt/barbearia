// test/http/auth.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); resetRateLimit(); });

test('admin login ok abre sessão de equipe e grava log', async () => {
  const agent = request.agent(buildApp());
  const res = await agent.post('/api/auth/admin/login').set('Origin', ORIGIN)
    .send({ email: 'dono@teste.local', senha: 'teste123456' });
  assert.equal(res.status, 200);
  assert.equal(res.body.usuario.role, 'admin');
  const log = await query(`SELECT acao FROM logs_acesso ORDER BY id DESC LIMIT 1`);
  assert.equal(log.rows[0].acao, 'login_ok');
});

test('admin login com senha errada => 401 e log de falha', async () => {
  const res = await request(buildApp()).post('/api/auth/admin/login').set('Origin', ORIGIN)
    .send({ email: 'dono@teste.local', senha: 'errada' });
  assert.equal(res.status, 401);
  assert.equal(res.body.erro, 'CREDENCIAIS_INVALIDAS');
  const log = await query(`SELECT acao FROM logs_acesso ORDER BY id DESC LIMIT 1`);
  assert.equal(log.rows[0].acao, 'login_falha');
});

test('rate limit dispara na 6ª tentativa', async () => {
  const app = buildApp();
  for (let i = 0; i < 5; i++) {
    await request(app).post('/api/auth/admin/login').set('Origin', ORIGIN)
      .send({ email: 'dono@teste.local', senha: 'errada' });
  }
  const res = await request(app).post('/api/auth/admin/login').set('Origin', ORIGIN)
    .send({ email: 'dono@teste.local', senha: 'errada' });
  assert.equal(res.status, 429);
  assert.equal(res.body.erro, 'MUITAS_TENTATIVAS');
});

test('POST sem Origin confiável => 403', async () => {
  const res = await request(buildApp()).post('/api/auth/admin/login')
    .send({ email: 'dono@teste.local', senha: 'teste123456' });
  assert.equal(res.status, 403);
});

test('logout apaga a sessão', async () => {
  const agent = request.agent(buildApp());
  await agent.post('/api/auth/admin/login').set('Origin', ORIGIN)
    .send({ email: 'dono@teste.local', senha: 'teste123456' });
  const out = await agent.post('/api/auth/logout').set('Origin', ORIGIN);
  assert.equal(out.status, 204);
});
