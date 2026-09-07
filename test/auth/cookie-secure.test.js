// test/auth/cookie-secure.test.js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { criarSessaoMiddleware } from '../../src/auth/sessao.js';
import { prepararBanco } from '../helpers/db.js';

before(prepararBanco); // garante o schema `test` migrado (tabela `session`) para o store

function appComSessao() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(criarSessaoMiddleware());
  app.get('/set', (req, res) => { req.session.x = 1; res.end('ok'); });
  return app;
}

test('em ambiente de teste (NODE_ENV=test, sem COOKIE_SECURE) o cookie de sessão NÃO é Secure', async () => {
  const res = await request(appComSessao()).get('/set');
  const cookie = String(res.headers['set-cookie'] ?? '');
  assert.match(cookie, /barbearia\.sid=/);
  assert.doesNotMatch(cookie, /;\s*Secure/i);
});
