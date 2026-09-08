import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';
import { query } from '../../src/db/pool.js';
import * as clientes from '../../src/repos/clientes.js';

before(prepararBanco);
beforeEach(async () => { await prepararBanco(); resetRateLimit(); });

const ORIGIN = 'http://localhost:3000';

async function pedirCodigo(app, celular, proposito = 'cadastro') {
  await request(app).post('/api/auth/otp/enviar').set('Origin', ORIGIN).send({ celular, proposito });
  const m = await query(
    `SELECT mensagem_final FROM mensagens_whatsapp WHERE telefone_destino=$1 ORDER BY id DESC LIMIT 1`,
    [celular],
  );
  return m.rows[0].mensagem_final.match(/\b(\d{6})\b/)[1];
}

test('cadastro com senha + código correto cria conta verificada', async () => {
  const app = buildApp();
  const celular = '5511944443333';
  const codigo = await pedirCodigo(app, celular);
  const r = await request(app).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular, consentimento: true, email: 'a@a.com', senha: 'segredo123', codigo });
  assert.equal(r.status, 201);
  const c = await clientes.porCelular(celular);
  assert.equal(c.celular_verificado, true);
  assert.ok(c.senha_hash);
});

test('cadastro com senha sem código → 400 VALIDACAO e nada criado', async () => {
  const r = await request(buildApp()).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular: '5511944442222', consentimento: true, email: 'a@a.com', senha: 'segredo123' });
  assert.equal(r.status, 400);
  assert.equal(r.body.erro, 'VALIDACAO');
  assert.equal(await clientes.porCelular('5511944442222'), null);
});

test('cadastro com senha + código errado → 400 OTP_INVALIDO, nada criado', async () => {
  const app = buildApp();
  const celular = '5511944441111';
  await pedirCodigo(app, celular);
  const r = await request(app).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular, consentimento: true, email: 'a@a.com', senha: 'segredo123', codigo: '000000' });
  assert.equal(r.status, 400);
  assert.equal(r.body.erro, 'OTP_INVALIDO');
  assert.equal(await clientes.porCelular(celular), null);
});

test('cadastro SEM senha continua sem exigir código (fluxo anônimo)', async () => {
  const r = await request(buildApp()).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular: '5511944440000', consentimento: true });
  assert.equal(r.status, 201);
  const c = await clientes.porCelular('5511944440000');
  assert.equal(c.celular_verificado, false);
});

test('mesmo código não serve para um segundo cadastro', async () => {
  const app = buildApp();
  const celular = '5511944449999';
  const codigo = await pedirCodigo(app, celular);
  await request(app).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular, consentimento: true, email: 'a@a.com', senha: 'segredo123', codigo });
  // segundo cadastro com outro celular mas reaproveitando o código do primeiro
  const r = await request(app).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Bia', celular: '5511944448888', consentimento: true, email: 'b@b.com', senha: 'segredo123', codigo });
  assert.equal(r.status, 400);
  assert.equal(r.body.erro, 'OTP_INVALIDO');
});

test('conta anônima existente (sem senha) vira conta com senha após código', async () => {
  const app = buildApp();
  const celular = '5511944447777';
  await request(app).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular, consentimento: true });        // cria sem senha
  const codigo = await pedirCodigo(app, celular);
  const r = await request(app).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular, consentimento: true, email: 'a@a.com', senha: 'segredo123', codigo });
  assert.equal(r.status, 201);
  const c = await clientes.porCelular(celular);
  assert.ok(c.senha_hash);
  assert.equal(c.celular_verificado, true);
});
