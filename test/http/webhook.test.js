// test/http/webhook.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';
import { config } from '../../src/config.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); });

test('GET /webhooks/whatsapp: 404 sem verify token configurado', async () => {
  assert.equal(config.WHATSAPP_VERIFY_TOKEN, '');
  const res = await request(buildApp()).get('/webhooks/whatsapp')
    .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '123' });
  assert.equal(res.status, 404);
});

test('POST /webhooks/whatsapp: resposta SIM confirma o agendamento pendente do celular', async () => {
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5528999990000') RETURNING id`)).rows[0].id;
  const ag = (await query(`INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento, horario_inicio, horario_fim, status, valor_total)
    VALUES ($1,$2,$3,'2026-09-10','09:00','09:35','pendente',10) RETURNING id`, [cli, s, b])).rows[0].id;

  const payload = {
    entry: [{ changes: [{ value: { messages: [{ from: '5528999990000', text: { body: 'SIM' } }] } }] }],
  };
  const res = await request(buildApp()).post('/webhooks/whatsapp')
    .set('content-type', 'application/json').send(JSON.stringify(payload));
  assert.equal(res.status, 200);
  const row = await query(`SELECT status FROM agendamentos WHERE id=$1`, [ag]);
  assert.equal(row.rows[0].status, 'confirmado');
});
