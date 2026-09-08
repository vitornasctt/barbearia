import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';
import { query } from '../../src/db/pool.js';
import * as clientes from '../../src/repos/clientes.js';
import { hashSenha } from '../../src/auth/senha.js';

before(prepararBanco);
beforeEach(async () => { await prepararBanco(); resetRateLimit(); });

const ORIGIN = 'http://localhost:3000';
const enviar = (body) => request(buildApp()).post('/api/auth/otp/enviar').set('Origin', ORIGIN).send(body);

test('cadastro: enfileira mensagem codigo_verificacao e responde 200', async () => {
  const r = await enviar({ celular: '5511955554444', proposito: 'cadastro' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { enviado: true });
  const m = await query(`SELECT template_chave, telefone_destino, mensagem_final FROM mensagens_whatsapp`);
  assert.equal(m.rowCount, 1);
  assert.equal(m.rows[0].template_chave, 'codigo_verificacao');
  assert.equal(m.rows[0].telefone_destino, '5511955554444');
  assert.match(m.rows[0].mensagem_final, /\b\d{6}\b/);
  assert.match(m.rows[0].mensagem_final, /Minha Barbearia/);
});

test('reset: número sem cadastro responde 200 e NÃO enfileira', async () => {
  const r = await enviar({ celular: '5511900001111', proposito: 'reset' });
  assert.equal(r.status, 200);
  const m = await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp`);
  assert.equal(m.rows[0].n, 0);
});

test('reset: conta com senha mas celular não verificado → 200 sem enfileirar', async () => {
  await clientes.criar({ nome: 'Ana', celular: '5511900002222', senha_hash: await hashSenha('segredo123'), celular_verificado: false });
  const r = await enviar({ celular: '5511900002222', proposito: 'reset' });
  assert.equal(r.status, 200);
  assert.equal((await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp`)).rows[0].n, 0);
});

test('reset: conta com senha e celular verificado → enfileira', async () => {
  await clientes.criar({ nome: 'Ana', celular: '5511900003333', senha_hash: await hashSenha('segredo123'), celular_verificado: true });
  const r = await enviar({ celular: '5511900003333', proposito: 'reset' });
  assert.equal(r.status, 200);
  assert.equal((await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp`)).rows[0].n, 1);
});

test('celular mal formado responde 200 sem vazar (e sem enfileirar)', async () => {
  const r = await enviar({ celular: 'abc', proposito: 'cadastro' });
  assert.equal(r.status, 200);
  assert.equal((await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp`)).rows[0].n, 0);
});

test('proposito inválido → 400 VALIDACAO', async () => {
  const r = await enviar({ celular: '5511955554444', proposito: 'outro' });
  assert.equal(r.status, 400);
});
