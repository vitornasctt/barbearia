// test/public/minha-conta-reset.test.js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';

before(prepararBanco);
beforeEach(prepararBanco);

test('GET /minha-conta tem o gatilho de "esqueci minha senha"', async () => {
  const res = await request(buildApp()).get('/minha-conta');
  assert.equal(res.status, 200);
  assert.match(res.text, /modoReset\s*=\s*true|@click="modoReset/);
  assert.match(res.text, /redefinirSenha\(\)/);
});

test('areaCliente expõe estado do reset', async () => {
  const { areaCliente } = await import('../../src/public/js/minha-conta.js');
  const st = areaCliente();
  assert.equal(st.modoReset, false);
  assert.equal(st.passoReset, 1);
  assert.deepEqual(st.reset, { celular: '', codigo: '', senha: '', senha2: '' });
});
