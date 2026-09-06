// test/http/saude.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { fecharBanco } from '../helpers/db.js';

test.after(() => fecharBanco());

test('GET /healthz responde ok com db:true', async () => {
  const res = await request(buildApp()).get('/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, db: true });
});

test('rota inexistente => 404 NAO_ENCONTRADO', async () => {
  const res = await request(buildApp()).get('/nao-existe');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { erro: 'NAO_ENCONTRADO' });
});
