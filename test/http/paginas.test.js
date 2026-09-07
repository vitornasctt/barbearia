import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { paginas } from '../../src/routes/paginas.js';
import { rota } from '../../src/http/async.js';
import { prepararBanco } from '../helpers/db.js';

before(prepararBanco);
beforeEach(prepararBanco);

test('GET / renderiza a landing com nome, serviços e botão de dúvida no WhatsApp', async () => {
  const res = await request(buildApp()).get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /Minha Barbearia/);          // nome semeado em seed.js
  assert.match(res.text, /Rua Exemplo/);              // endereço do INSERT estendido do seed
  assert.match(res.text, /wa\.me\//);
  // o botão flutuante NUNCA leva ao agendamento
  const wa = res.text.match(/<a class="wa-flutuante"[^>]*>/)[0];
  assert.doesNotMatch(wa, /\/agendar/);
  // tem pelo menos um serviço listado
  assert.match(res.text, /class="servico-card"/);
});

test('GET /agendar traz o #dados-pagina com serviços', async () => {
  const res = await request(buildApp()).get('/agendar');
  assert.equal(res.status, 200);
  assert.match(res.text, /id="dados-pagina"/);
  assert.match(res.text, /"servicos"/);
  assert.match(res.text, /src="\/js\/agendar\.js"/);
});

test('GET /minha-conta responde 200 e carrega o módulo', async () => {
  const res = await request(buildApp()).get('/minha-conta');
  assert.equal(res.status, 200);
  assert.match(res.text, /src="\/js\/minha-conta\.js"/);
});

test('GET /privacidade menciona LGPD e o controlador', async () => {
  const res = await request(buildApp()).get('/privacidade');
  assert.equal(res.status, 200);
  assert.match(res.text, /LGPD/);
  assert.match(res.text, /Minha Barbearia/);
});

test('erro numa rota de página vira HTML 500 genérico (sem stack)', async () => {
  // app mínimo: exercita erroPagina como handler de erro logo após a rota que estoura
  const { default: express } = await import('express');
  const { erroPagina } = await import('../../src/routes/paginas.js');
  const { locaisDaRequisicao } = await import('../../src/http/render.js');
  const app = express();
  app.use(locaisDaRequisicao);
  app.get('/estoura', () => { throw new Error('detalhe secreto'); });
  app.use(erroPagina);
  const res = await request(app).get('/estoura');
  assert.equal(res.status, 500);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /Algo deu errado/);
  assert.doesNotMatch(res.text, /detalhe secreto/);
});

test('throw numa rota de página real vira HTML 500 pelo buildApp (sem stack)', async () => {
  // Route handlers must be wrapped with rota() to properly handle async errors in buildApp
  paginas.get('/__erro_e2e__', rota(async () => { throw new Error('detalhe secreto e2e'); }));
  const res = await request(buildApp()).get('/__erro_e2e__');
  assert.equal(res.status, 500);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /Algo deu errado/);
  assert.doesNotMatch(res.text, /detalhe secreto e2e/);
});
