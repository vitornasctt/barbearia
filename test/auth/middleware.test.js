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

// Page-guard middlewares (redirect, not JSON error)
import { paginaEquipe, paginaCliente } from '../../src/auth/middleware.js';

function resFake() {
  return { code: null, url: null, redirect(c, u) { this.code = c; this.url = u; } };
}

test('paginaEquipe redireciona anônimo para /admin/login com next', () => {
  const res = resFake();
  let passou = false;
  paginaEquipe({ session: {}, originalUrl: '/admin/servicos' }, res, () => { passou = true; });
  assert.equal(passou, false);
  assert.equal(res.code, 302);
  assert.equal(res.url, '/admin/login?next=%2Fadmin%2Fservicos');
});

test('paginaEquipe deixa passar equipe válida', () => {
  const res = resFake();
  let passou = false;
  paginaEquipe(
    { session: { usuarioId: 1, role: 'admin', equipeExpiraEm: Date.now() + 1000 }, originalUrl: '/admin' },
    res, () => { passou = true; });
  assert.equal(passou, true);
});

test('paginaCliente redireciona anônimo para /minha-conta', () => {
  const res = resFake();
  paginaCliente({ session: {}, originalUrl: '/x' }, res, () => {});
  assert.equal(res.url, '/minha-conta');
});
