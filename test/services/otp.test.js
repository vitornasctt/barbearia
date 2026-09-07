import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { gerarCodigo, emitir, verificar, MAX_TENTATIVAS } from '../../src/services/otp.js';
import * as otpRepo from '../../src/repos/otp.js';

before(prepararBanco);
beforeEach(prepararBanco);

const CEL = '5511988887777';

test('gerarCodigo devolve 6 dígitos, com zero à esquerda', () => {
  for (let i = 0; i < 200; i++) {
    const c = gerarCodigo();
    assert.match(c, /^\d{6}$/);
  }
});

test('emitir grava linha aberta com expiração ~10min e hash que confere', async () => {
  const { codigo } = await emitir({ celular: CEL, proposito: 'cadastro' });
  const row = await otpRepo.abertoMaisRecente({ celular: CEL, proposito: 'cadastro' });
  assert.ok(row);
  assert.equal(row.verificado, false);
  const dtMs = new Date(row.expira_em).getTime() - Date.now();
  assert.ok(dtMs > 8 * 60_000 && dtMs < 12 * 60_000, 'expira_em fora da janela');
  const r = await verificar({ celular: CEL, proposito: 'cadastro', codigo });
  assert.deepEqual(r, { ok: true });
});

test('emitir de novo invalida o código anterior do mesmo par', async () => {
  const primeiro = await emitir({ celular: CEL, proposito: 'cadastro' });
  await emitir({ celular: CEL, proposito: 'cadastro' });
  const r = await verificar({ celular: CEL, proposito: 'cadastro', codigo: primeiro.codigo });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'OTP_INVALIDO');
});

test('código errado incrementa tentativas e falha', async () => {
  await emitir({ celular: CEL, proposito: 'cadastro' });
  const r = await verificar({ celular: CEL, proposito: 'cadastro', codigo: '000000' });
  assert.equal(r.ok, false);
  const row = await otpRepo.abertoMaisRecente({ celular: CEL, proposito: 'cadastro' });
  assert.equal(row.tentativas, 1);
});

test('estoura MAX_TENTATIVAS e nem o código certo passa', async () => {
  const { codigo } = await emitir({ celular: CEL, proposito: 'cadastro' });
  const errado = codigo === '000000' ? '111111' : '000000';
  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    await verificar({ celular: CEL, proposito: 'cadastro', codigo: errado });
  }
  const r = await verificar({ celular: CEL, proposito: 'cadastro', codigo });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'OTP_INVALIDO');
});

test('código expirado falha', async () => {
  const { codigo } = await emitir({ celular: CEL, proposito: 'cadastro' });
  await query(`UPDATE otp_codigos SET expira_em = now() - interval '1 min' WHERE celular=$1`, [CEL]);
  const r = await verificar({ celular: CEL, proposito: 'cadastro', codigo });
  assert.equal(r.ok, false);
});

test('código já verificado não serve de novo', async () => {
  const { codigo } = await emitir({ celular: CEL, proposito: 'cadastro' });
  await verificar({ celular: CEL, proposito: 'cadastro', codigo });
  const r = await verificar({ celular: CEL, proposito: 'cadastro', codigo });
  assert.equal(r.ok, false);
});

test('proposito não cruza: código de cadastro não verifica reset', async () => {
  const { codigo } = await emitir({ celular: CEL, proposito: 'cadastro' });
  const r = await verificar({ celular: CEL, proposito: 'reset', codigo });
  assert.equal(r.ok, false);
});

test('limparAntigos remove só linhas com mais de 1 dia', async () => {
  await emitir({ celular: CEL, proposito: 'cadastro' });
  await query(`UPDATE otp_codigos SET created_at = now() - interval '2 days' WHERE celular=$1`, [CEL]);
  const n = await otpRepo.limparAntigos({ dias: 1 });
  assert.ok(n >= 1);
  const row = await otpRepo.abertoMaisRecente({ celular: CEL, proposito: 'cadastro' });
  assert.equal(row, undefined);
});
