import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';

before(prepararBanco);
beforeEach(prepararBanco);

test('GET / renderiza a landing com nome, serviços e botão de dúvida no WhatsApp', async () => {
  const res = await request(buildApp()).get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /Minha Barbearia/);          // nome semeado em seed.js
  assert.match(res.text, /wa\.me\//);
  // o botão flutuante NUNCA leva ao agendamento
  const wa = res.text.match(/<a class="wa-flutuante"[^>]*>/)[0];
  assert.doesNotMatch(wa, /\/agendar/);
  // tem pelo menos um serviço listado
  assert.match(res.text, /class="servico-card"/);
});
