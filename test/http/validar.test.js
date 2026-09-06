// test/http/validar.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validarCorpo } from '../../src/http/validar.js';

function rodar(mw, req) {
  return new Promise((resolve) => {
    const res = {};
    mw(req, res, (err) => resolve({ err, req }));
  });
}

test('validarCorpo passa e coage', async () => {
  const mw = validarCorpo(z.object({ n: z.coerce.number(), s: z.string() }));
  const { err, req } = await rodar(mw, { body: { n: '3', s: 'x' } });
  assert.equal(err, undefined);
  assert.deepEqual(req.body, { n: 3, s: 'x' });
});

test('validarCorpo rejeita com ErroHttp VALIDACAO + campos', async () => {
  const mw = validarCorpo(z.object({ s: z.string() }));
  const { err } = await rodar(mw, { body: {} });
  assert.equal(err.codigoHttp, 'VALIDACAO');
  assert.ok(Array.isArray(err.campos) && err.campos[0].caminho === 's');
});
