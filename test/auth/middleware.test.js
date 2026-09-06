// test/auth/middleware.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireCliente, requireEquipe, requireAdmin } from '../../src/auth/middleware.js';

function rodar(mw, session) {
  return new Promise((resolve) => {
    const req = { session };
    mw(req, {}, (err) => resolve(err?.codigoHttp ?? 'OK'));
  });
}
const daqui1h = () => Date.now() + 3600_000;

test('requireCliente', async () => {
  assert.equal(await rodar(requireCliente, { clienteId: 1 }), 'OK');
  assert.equal(await rodar(requireCliente, {}), 'NAO_AUTENTICADO');
});

test('requireEquipe respeita expiração', async () => {
  assert.equal(await rodar(requireEquipe, { usuarioId: 1, role: 'barbeiro', equipeExpiraEm: daqui1h() }), 'OK');
  assert.equal(await rodar(requireEquipe, { usuarioId: 1, role: 'barbeiro', equipeExpiraEm: 1 }), 'NAO_AUTENTICADO');
  assert.equal(await rodar(requireEquipe, { clienteId: 9 }), 'NAO_AUTENTICADO');
});

test('requireAdmin', async () => {
  assert.equal(await rodar(requireAdmin, { usuarioId: 1, role: 'admin', equipeExpiraEm: daqui1h() }), 'OK');
  assert.equal(await rodar(requireAdmin, { usuarioId: 1, role: 'barbeiro', equipeExpiraEm: daqui1h() }), 'SEM_PERMISSAO');
});
