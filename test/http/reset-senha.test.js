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

async function contaVerificada(celular, senha) {
  await clientes.criar({ nome: 'Ana', celular, email: 'a@a.com', senha_hash: await hashSenha(senha), celular_verificado: true });
}
async function codigoReset(app, celular) {
  await request(app).post('/api/auth/otp/enviar').set('Origin', ORIGIN).send({ celular, proposito: 'reset' });
  const m = await query(`SELECT mensagem_final FROM mensagens_whatsapp WHERE telefone_destino=$1 ORDER BY id DESC LIMIT 1`, [celular]);
  return m.rows[0].mensagem_final.match(/\b(\d{6})\b/)[1];
}

test('reset feliz: nova senha passa a valer, antiga não', async () => {
  const app = buildApp();
  const celular = '5511933332222';
  await contaVerificada(celular, 'antiga123');
  const codigo = await codigoReset(app, celular);

  const r = await request(app).post('/api/auth/senha/redefinir').set('Origin', ORIGIN)
    .send({ celular, codigo, nova_senha: 'novasenha1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.cliente.nome, 'Ana');

  const nova = await request(buildApp()).post('/api/auth/cliente/login').set('Origin', ORIGIN)
    .send({ celular, senha: 'novasenha1' });
  assert.equal(nova.status, 200);
  const velha = await request(buildApp()).post('/api/auth/cliente/login').set('Origin', ORIGIN)
    .send({ celular, senha: 'antiga123' });
  assert.equal(velha.status, 401);
});

test('reset registra em logs_acesso', async () => {
  const app = buildApp();
  const celular = '5511933331111';
  await contaVerificada(celular, 'antiga123');
  const codigo = await codigoReset(app, celular);
  await request(app).post('/api/auth/senha/redefinir').set('Origin', ORIGIN).send({ celular, codigo, nova_senha: 'novasenha1' });
  const l = await query(`SELECT acao FROM logs_acesso WHERE acao='senha_redefinida'`);
  assert.equal(l.rowCount, 1);
});

test('código errado → 400 OTP_INVALIDO, senha intacta', async () => {
  const app = buildApp();
  const celular = '5511933330000';
  await contaVerificada(celular, 'antiga123');
  await codigoReset(app, celular);
  const r = await request(app).post('/api/auth/senha/redefinir').set('Origin', ORIGIN)
    .send({ celular, codigo: '000000', nova_senha: 'novasenha1' });
  assert.equal(r.status, 400);
  assert.equal(r.body.erro, 'OTP_INVALIDO');
  const ok = await request(buildApp()).post('/api/auth/cliente/login').set('Origin', ORIGIN).send({ celular, senha: 'antiga123' });
  assert.equal(ok.status, 200);
});

test('celular sem conta verificada: otp/enviar não emite, redefinir falha OTP_INVALIDO', async () => {
  const app = buildApp();
  const celular = '5511933339999';
  await request(app).post('/api/auth/otp/enviar').set('Origin', ORIGIN).send({ celular, proposito: 'reset' });
  const r = await request(app).post('/api/auth/senha/redefinir').set('Origin', ORIGIN)
    .send({ celular, codigo: '123456', nova_senha: 'novasenha1' });
  assert.equal(r.status, 400);
  assert.equal(r.body.erro, 'OTP_INVALIDO');
});

test('código expirado → 400', async () => {
  const app = buildApp();
  const celular = '5511933338888';
  await contaVerificada(celular, 'antiga123');
  const codigo = await codigoReset(app, celular);
  await query(`UPDATE otp_codigos SET expira_em = now() - interval '1 min' WHERE celular=$1`, [celular]);
  const r = await request(app).post('/api/auth/senha/redefinir').set('Origin', ORIGIN)
    .send({ celular, codigo, nova_senha: 'novasenha1' });
  assert.equal(r.status, 400);
});

test('nova_senha curta → 400 VALIDACAO', async () => {
  const app = buildApp();
  const celular = '5511933337777';
  await contaVerificada(celular, 'antiga123');
  const codigo = await codigoReset(app, celular);
  const r = await request(app).post('/api/auth/senha/redefinir').set('Origin', ORIGIN)
    .send({ celular, codigo, nova_senha: 'curta' });
  assert.equal(r.status, 400);
});
