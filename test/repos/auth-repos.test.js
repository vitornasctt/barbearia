// test/repos/auth-repos.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import * as usuarios from '../../src/repos/usuarios.js';
import * as clientes from '../../src/repos/clientes.js';
import * as logs from '../../src/repos/logs.js';
import { query } from '../../src/db/pool.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

test('usuarios.porEmail acha o admin semeado', async () => {
  const u = await usuarios.porEmail('dono@teste.local');
  assert.equal(u.role, 'admin');
  assert.ok(u.senha_hash);
  assert.equal(await usuarios.porEmail('ninguem@x.com'), null);
});

test('clientes.criar + porCelular', async () => {
  const c = await clientes.criar({ nome: 'Ana', celular: '5528999990000' });
  assert.ok(c.id);
  const achado = await clientes.porCelular('5528999990000');
  assert.equal(achado.nome, 'Ana');
  assert.equal(achado.senha_hash, null);
});

test('logs.registrar insere linha', async () => {
  await logs.registrar({ quem_tipo: 'usuario', quem_id: 1, acao: 'login_ok', ip: '1.2.3.4' });
  const r = await query(`SELECT acao FROM logs_acesso WHERE quem_id=1`);
  assert.equal(r.rows[0].acao, 'login_ok');
});
