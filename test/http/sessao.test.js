// test/http/sessao.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { criarSessaoMiddleware } from '../../src/auth/sessao.js';
import { prepararBanco, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';

test.beforeEach(() => prepararBanco());
test.after(() => fecharBanco());

function appDeTeste() {
  const app = express();
  app.use(express.json());
  app.use(criarSessaoMiddleware());
  app.post('/set', (req, res) => { req.session.n = (req.session.n ?? 0) + 1; res.json({ n: req.session.n }); });
  app.get('/get', (req, res) => res.json({ n: req.session.n ?? 0 }));
  return app;
}

test('sessão persiste entre requests do mesmo agent (store em Postgres)', async () => {
  const agent = request.agent(appDeTeste());
  await agent.post('/set');
  const r2 = await agent.post('/set');
  assert.equal(r2.body.n, 2);
  const g = await agent.get('/get');
  assert.equal(g.body.n, 2);
  const row = await query('SELECT count(*)::int AS n FROM session');
  assert.ok(row.rows[0].n >= 1);
});

test('agents diferentes não compartilham sessão', async () => {
  const app = appDeTeste();
  const a = request.agent(app); const b = request.agent(app);
  await a.post('/set');
  const g = await b.get('/get');
  assert.equal(g.body.n, 0);
});
