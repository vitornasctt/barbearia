import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';

before(prepararBanco);
beforeEach(async () => { await prepararBanco(); resetRateLimit(); });

const ORIGIN = 'http://localhost:3000';

test('4ª chamada de otp/enviar para o mesmo celular em 10 min → 429', async () => {
  const app = buildApp();
  const enviar = () => request(app).post('/api/auth/otp/enviar')
    .set('Origin', ORIGIN)
    .send({ celular: '5511977776666', proposito: 'cadastro' });
  assert.equal((await enviar()).status, 200);
  assert.equal((await enviar()).status, 200);
  assert.equal((await enviar()).status, 200);
  const quarta = await enviar();
  assert.equal(quarta.status, 429);
  assert.equal(quarta.body.erro, 'MUITAS_TENTATIVAS');
});

test('mesmo número em formatos diferentes cai no mesmo bucket → 4ª → 429', async () => {
  const app = buildApp();
  const enviar = (celular) => request(app).post('/api/auth/otp/enviar')
    .set('Origin', ORIGIN)
    .send({ celular, proposito: 'cadastro' });
  assert.equal((await enviar('11999990000')).status, 200);
  assert.equal((await enviar('(11) 99999-0000')).status, 200);
  assert.equal((await enviar('5511999990000')).status, 200);
  const quarta = await enviar('+55 11 99999-0000');
  assert.equal(quarta.status, 429);
  assert.equal(quarta.body.erro, 'MUITAS_TENTATIVAS');
});

test('resetRateLimit zera o storeOtp entre casos', async () => {
  const app = buildApp();
  const r = await request(app).post('/api/auth/otp/enviar')
    .set('Origin', ORIGIN)
    .send({ celular: '5511977776666', proposito: 'cadastro' });
  assert.equal(r.status, 200); // se não zerasse, herdaria o 429 do teste anterior
});
