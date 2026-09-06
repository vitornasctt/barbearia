// test/http/admin-relatorios.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); resetRateLimit(); });

async function admin() {
  const a = request.agent(buildApp());
  await a.post('/api/auth/admin/login').set('Origin', ORIGIN).send({ email: 'dono@teste.local', senha: 'teste123456' });
  return a;
}

test('GET /comissoes agrupa concluídos do mês', async () => {
  const a = await admin();
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id, preco, comissao_percentual FROM servicos WHERE nome='Corte'`)).rows[0];
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5511') RETURNING id`)).rows[0].id;
  for (const dia of ['05', '06']) {
    await query(`INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento, horario_inicio, horario_fim, status, valor_total, comissao_valor)
      VALUES ($1,$2,$3,$4,'09:00','09:35','concluido',$5,$6)`, [cli, s.id, b, `2026-09-${dia}`, s.preco, s.preco * s.comissao_percentual / 100]);
  }
  const r = await a.get('/api/admin/comissoes').query({ ano: 2026, mes: 9 });
  assert.equal(r.body.linhas[0].qtd, 2);
  assert.equal(Number(r.body.total.comissao), 45);
});

test('PUT /configuracao muda a grade (intervalo) e exige admin', async () => {
  const a = await admin();
  const cfg = await a.get('/api/admin/configuracao');
  const put = await a.put('/api/admin/configuracao').set('Origin', ORIGIN)
    .send({ intervalo_minutos: 20, expediente: cfg.body.expediente });
  assert.equal(put.status, 200);
  assert.equal(put.body.intervalo_minutos, 20);

  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  const h = await request(buildApp()).get('/api/agenda/horarios').query({ data: '2026-09-10', servico_id: s });
  assert.ok(h.body.horarios.includes('09:20'));
});

test('PUT /templates/:chave e POST /mensagens/enviar => enfileira e worker resolve', async () => {
  const a = await admin();
  const t = await a.put('/api/admin/templates/confirmacao').set('Origin', ORIGIN)
    .send({ titulo: 'Conf', corpo: 'Oi {{nome_cliente}}', ativo: true });
  assert.equal(t.body.template.corpo, 'Oi {{nome_cliente}}');

  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5528999990000') RETURNING id`)).rows[0].id;
  const ag = (await query(`INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento, horario_inicio, horario_fim, status, valor_total)
    VALUES ($1,$2,$3,'2026-09-10','09:00','09:35','confirmado',10) RETURNING id`, [cli, s, b])).rows[0].id;

  const env = await a.post('/api/admin/mensagens/enviar').set('Origin', ORIGIN)
    .send({ agendamento_id: ag, template_chave: 'confirmacao' });
  assert.equal(env.status, 202);
  const lst = await a.get('/api/admin/mensagens').query({ agendamento_id: ag });
  assert.equal(lst.body.itens[0].status_envio, 'simulado');
  assert.match(lst.body.itens[0].mensagem_final, /Ana/);
});
