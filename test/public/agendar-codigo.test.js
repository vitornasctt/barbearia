// test/public/agendar-codigo.test.js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';

before(prepararBanco);
beforeEach(prepararBanco);

test('GET /agendar traz o input de código e o botão de enviar código', async () => {
  const res = await request(buildApp()).get('/agendar');
  assert.equal(res.status, 200);
  assert.match(res.text, /x-model="form\.codigo"/);
  assert.match(res.text, /@click="enviarCodigo\(\)"/);
});

test('fluxoAgendamento() começa sem código enviado', async () => {
  // fluxoAgendamento lê #dados-pagina do DOM; stub mínimo para rodar sem browser
  globalThis.document = { getElementById: () => ({ textContent: '{}' }) };
  try {
    const { fluxoAgendamento } = await import('../../src/public/js/agendar.js');
    const st = fluxoAgendamento();
    assert.equal(st.codigoEnviado, false);
    assert.equal(st.reenvioEm, 0);
    assert.equal(st.form.codigo, '');
  } finally {
    delete globalThis.document;
  }
});
