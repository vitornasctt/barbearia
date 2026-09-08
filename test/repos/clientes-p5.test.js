import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco } from '../helpers/db.js';
import * as clientes from '../../src/repos/clientes.js';

before(prepararBanco);
beforeEach(prepararBanco);

test('criar aceita celular_verificado e persiste', async () => {
  const c = await clientes.criar({ nome: 'Zé', celular: '5511911112222', senha_hash: 'h', celular_verificado: true });
  const full = await clientes.porId(c.id);
  assert.equal(full.celular_verificado, true);
  assert.equal(full.senha_hash, 'h');
});

test('criar sem celular_verificado mantém default false', async () => {
  const c = await clientes.criar({ nome: 'Ana', celular: '5511911113333' });
  const full = await clientes.porId(c.id);
  assert.equal(full.celular_verificado, false);
});

test('definirSenha troca o hash', async () => {
  const c = await clientes.criar({ nome: 'Ana', celular: '5511911114444', senha_hash: 'antigo' });
  await clientes.definirSenha(c.id, 'novo');
  assert.equal((await clientes.porId(c.id)).senha_hash, 'novo');
});

test('marcarCelularVerificado liga a flag', async () => {
  const c = await clientes.criar({ nome: 'Ana', celular: '5511911115555' });
  await clientes.marcarCelularVerificado(c.id);
  assert.equal((await clientes.porId(c.id)).celular_verificado, true);
});
