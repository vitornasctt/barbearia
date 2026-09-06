import test from 'node:test';
import assert from 'node:assert/strict';
import { exigirOrigemConfiavel } from '../../src/http/origem.js';
import { config } from '../../src/config.js';

function rodar(req) {
  return new Promise((resolve) => exigirOrigemConfiavel(req, {}, (err) => resolve(err)));
}

test('GET passa sem Origin', async () => {
  assert.equal(await rodar({ method: 'GET', headers: {} }), undefined);
});

test('POST sem Origin é barrado', async () => {
  const err = await rodar({ method: 'POST', headers: {} });
  assert.equal(err.codigoHttp, 'SEM_PERMISSAO');
});

test('POST com Origin = APP_URL passa; origem estranha é barrada', async () => {
  assert.equal(await rodar({ method: 'POST', headers: { origin: config.APP_URL } }), undefined);
  const err = await rodar({ method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(err.codigoHttp, 'SEM_PERMISSAO');
});
